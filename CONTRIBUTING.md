# Contributing to aprende

Thanks for helping people learn hard things.

- **Bugs:** open an issue with what you did, what you expected, and what happened. Include your OS, the aprende version, and whether you use Claude or Codex.
- **Ideas:** open an issue describing the learning problem first, before a pull request.
- **Pull requests:** solve one problem per PR, use a conventional commit title in plain language (`fix(web): question cards keep the learner's thinking`), and describe how you verified the change. Run `vp run check:changed` before pushing. UI changes need before/after screenshots.
- **Tutor behaviour:** changes to the tutor prompt or the `learn` tool descriptions change how people are taught. Explain the teaching problem they fix and show a transcript before and after.

- **Upstream:** aprende is a fork of [T3 Code](https://github.com/pingdotgg/t3code) (MIT, by T3 Tools Inc.). Fixes from T3 Code are ported by hand; keep its copyright notice in `LICENSE`. Credit it by name and link only, without T3 logos, branding or endpoints. Report bugs in aprende here, not to T3 Code.

See [AGENTS.md](AGENTS.md) for how the codebase works and the testing rules.
