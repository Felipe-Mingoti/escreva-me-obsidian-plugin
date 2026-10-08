const { Notice, Plugin, PluginSettingTab, Setting, TFile, requestUrl } = require("obsidian");

const API_BASE_URL = "https://app.escreva-me.com/api";
const EXPORT_PREFIX = "Escreva-me/Reflections/";
const DEBOUNCE_MS = 2000;

function apiUrl(path) {
    return `${API_BASE_URL}${path}`;
}

function normalizePath(path) {
    return path.replace(/\\/g, "/").replace(/^\/+/, "");
}

function isReservedExportPath(path) {
    const normalized = normalizePath(path);
    return normalized === "Escreva-me/Reflections" || normalized.startsWith(EXPORT_PREFIX);
}

class EscrevaMeSyncPlugin extends Plugin {
    settings = { pluginToken: "" };
    timers = new Map();
    initialSyncComplete = false;
    syncingExisting = false;

    async onload() {
        const stored = await this.loadData();
        this.settings = {
            pluginToken: stored?.pluginToken ?? "",
        };
        this.initialSyncComplete = stored?.initialSyncComplete === true;

        this.addSettingTab(new EscrevaMeSettingTab(this.app, this));
        this.registerEvent(this.app.vault.on("create", (file) => this.queue(file, "upsert")));
        this.registerEvent(this.app.vault.on("modify", (file) => this.queue(file, "upsert")));
        this.registerEvent(this.app.vault.on("delete", (file) => this.queue(file, "delete")));
        this.registerEvent(this.app.vault.on("rename", (file, oldPath) => this.queue(file, "rename", oldPath)));
        this.registerInterval(window.setInterval(() => this.pullOutbox(), 60_000));
        this.syncExistingNotes().catch((error) => {
            console.error("[escreva-me]", error);
            new Notice("Escreva-me sync failed");
        });
    }

    scheduleInitialSync() {
        if (this.initialTimer) {
            window.clearTimeout(this.initialTimer);
        }
        this.initialTimer = window.setTimeout(() => {
            this.syncExistingNotes().catch((error) => {
                console.error("[escreva-me]", error);
                new Notice("Escreva-me sync failed");
            });
        }, 1000);
    }

    async syncExistingNotes() {
        if (this.initialSyncComplete) {
            return;
        }
        if (!this.settings.pluginToken) {
            return;
        }
        if (this.syncingExisting) {
            this.syncAgain = true;
            return;
        }
        this.syncingExisting = true;
        this.syncAgain = false;
        try {
            const files = this.app.vault.getMarkdownFiles()
                .filter((file) => !isReservedExportPath(file.path));
            for (let index = 0; index < files.length; index += 50) {
                const changes = [];
                for (const file of files.slice(index, index + 50)) {
                    changes.push({
                        path: file.path,
                        content: await this.app.vault.read(file),
                    });
                }
                if (changes.length === 0) {
                    continue;
                }
                await requestUrl({
                    url: apiUrl("/integrations/obsidian/changes"),
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${this.settings.pluginToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ changes }),
                });
            }
            this.initialSyncComplete = true;
            await this.saveData({
                ...this.settings,
                initialSyncComplete: true,
            });
        } finally {
            this.syncingExisting = false;
            if (this.syncAgain && !this.initialSyncComplete) {
                this.scheduleInitialSync();
            }
        }
    }

    queue(file, kind, previousPath) {
        if (!(file instanceof TFile) || file.extension !== "md") {
            return;
        }
        if (isReservedExportPath(file.path) || (previousPath && isReservedExportPath(previousPath))) {
            return;
        }
        const key = file.path;
        const existing = this.timers.get(key);
        if (existing) {
            window.clearTimeout(existing);
        }
        this.timers.set(key, window.setTimeout(() => {
            this.timers.delete(key);
            this.pushFile(file, kind, previousPath).catch((error) => {
                console.error("[escreva-me]", error);
                new Notice("Escreva-me sync failed");
            });
        }, DEBOUNCE_MS));
    }

    async pushFile(file, kind, previousPath) {
        if (!this.settings.pluginToken) {
            return;
        }
        const change = {
            path: file.path,
            previousPath,
            deleted: kind === "delete",
        };
        if (kind !== "delete") {
            change.content = await this.app.vault.read(file);
        }
        await requestUrl({
            url: apiUrl("/integrations/obsidian/changes"),
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.settings.pluginToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ changes: [change] }),
        });
    }

    async pullOutbox() {
        if (!this.settings.pluginToken) {
            return;
        }
        const response = await requestUrl({
            url: apiUrl("/integrations/obsidian/outbox"),
            method: "GET",
            headers: { Authorization: `Bearer ${this.settings.pluginToken}` },
        });
        const items = response.json?.items ?? [];
        for (const item of items) {
            const path = item.suggestedPath || `${EXPORT_PREFIX}note.md`;
            const folder = path.split("/").slice(0, -1).join("/");
            if (folder) {
                const parts = folder.split("/");
                let current = "";
                for (const part of parts) {
                    current = current ? `${current}/${part}` : part;
                    if (!this.app.vault.getAbstractFileByPath(current)) {
                        await this.app.vault.createFolder(current);
                    }
                }
            }
            const markdown = `# ${item.title}\n\n${item.body}\n`;
            const existing = this.app.vault.getAbstractFileByPath(path);
            if (existing instanceof TFile) {
                await this.app.vault.modify(existing, markdown);
            } else {
                await this.app.vault.create(path, markdown);
            }
            await requestUrl({
                url: apiUrl(`/integrations/obsidian/outbox/${item.id}/ack`),
                method: "POST",
                headers: {
                    Authorization: `Bearer ${this.settings.pluginToken}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ remotePath: path }),
            });
        }
    }
}

class EscrevaMeSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        new Setting(containerEl)
            .setName("Plugin token")
            .setDesc("Shown once when you connect Obsidian in Escreva-me.")
            .addText((text) => text
                .setValue(this.plugin.settings.pluginToken)
                .onChange(async (value) => {
                    this.plugin.settings.pluginToken = value.trim();
                    await this.plugin.saveData({
                        ...this.plugin.settings,
                        initialSyncComplete: this.plugin.initialSyncComplete,
                    });
                    this.plugin.scheduleInitialSync();
                }));
    }
}

module.exports = EscrevaMeSyncPlugin;
