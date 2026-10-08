# Escreva-me sync

Sends the Markdown notes in an Obsidian vault to [Escreva-me](https://escreva-me.com), and writes daily reflections you chose to export back into the vault.

## What leaves the vault

When this plugin is configured, it sends the path and contents of `.md` files to Escreva-me at `https://app.escreva-me.com/api`. Escreva-me stores those notes on your account.

The plugin token is a credential for that account. Escreva-me stores only a hash of the token. Creating a new token in Escreva-me invalidates the previous one.

Files under `Escreva-me/Reflections/` are not sent. That folder is where exported reflections are written.

## Install

In Obsidian, open **Settings → Community plugins**, turn off restricted mode, browse for **Escreva-me sync**, install it, and enable it.

## Connect

1. In Escreva-me, open Conexões and connect Obsidian while signed in with a registered account.
2. Copy the plugin token. It is shown once.
3. In Obsidian, open **Settings → Escreva-me sync** and paste the token.

The plugin already knows the Escreva-me address. The first time the token is saved, it sends the Markdown already in the vault. After that, it sends notes you create, edit, rename, or delete. About once a minute it checks for reflections to write under `Escreva-me/Reflections/`.

## License

[MIT](LICENSE)
