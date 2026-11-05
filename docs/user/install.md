# Install aprende

aprende is a desktop app. There are no published releases yet, so you build it from source.

## Requirements

- macOS on Apple silicon. Other platforms may build but are not tested yet.
- `claude` (Claude Code) or `codex` (Codex CLI), installed and logged in. You can install aprende
  first and set up a provider afterwards. See [Providers](#providers).

## Build the desktop app

1. Install `vp` by following the [root README](https://github.com/BernyMP/aprende#install-vp).
2. Install [Rust](https://rustup.rs) and the Xcode command line tools (`xcode-select --install`).
3. Build:

   ```bash
   git clone https://github.com/BernyMP/aprende
   cd aprende
   vp i
   vp run dist:desktop:dmg:arm64
   ```

4. Open the `.dmg` in `release/` and drag aprende to Applications.

The build is not signed. The first time you open it, macOS refuses because it cannot check the
developer. Open **System Settings → Privacy & Security** and select **Open Anyway** next to the
message about aprende.

aprende keeps its data in `~/.aprende`.

## Providers

Open **Settings → Providers** and enable the provider you want.

| Provider | Install and authenticate                                                                     |
| -------- | -------------------------------------------------------------------------------------------- |
| Claude   | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`. |
| Codex    | Install [Codex CLI](https://developers.openai.com/codex/cli), then run `codex login`.        |

aprende runs the CLI with your own login. It never asks for, stores or passes on API keys or
account credentials. A provider's **Environment variables** are for CLI settings such as
`CLAUDE_CONFIG_DIR` or a base URL; aprende refuses variables named like a credential.

Provider CLIs must be on your `PATH`. If aprende cannot find one, set its **Binary path** in
provider settings, especially when you use a version manager.

aprende warns when a provider version has known compatibility problems. Check
**Settings → Providers** for the recommended version.

For provider-specific setup and accounts, see [Codex](./providers-codex.md) and
[Claude](./providers-claude.md).

## Next steps

- [Learning sessions](./learning.md): start learning something.
