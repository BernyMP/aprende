# aprende

aprende is an open-source desktop app for learning difficult things.

You tell it what you want to understand. A tutor finds where your understanding ends, shows you a
map from there to your goal, and teaches one reasoning step at a time: you predict, it explains,
then you check yourself. Confusions get repaired before anything is built on them.

aprende runs the AI coding CLI you already have, `claude` (Claude Code) or `codex` (Codex CLI),
with your own login. It never asks for or stores API keys or account credentials. Your learning
data stays on your machine.

> Early development. There are no releases yet; build it from source.

## Build from source

See [Install aprende](./docs/user/install.md) for the desktop app, and the
[development runbook](./docs/operations/development.md) to work on aprende.

### Install `vp`

aprende uses [Vite+](https://viteplus.dev/guide/), so you need its global `vp` command:

```bash
curl -fsSL https://vite.plus | bash
```

Then run `vp i` in the repository to install dependencies. `vp` provides the Node version
aprende pins, so you do not need to install Node separately.

## Credits

aprende is a fork of [T3 Code](https://github.com/pingdotgg/t3code) (MIT). It keeps T3 Code's
provider runtime and desktop shell, and replaces the coding features with a learning loop.
aprende is not affiliated with T3 Tools Inc.

## License

MIT. See [LICENSE](./LICENSE).
