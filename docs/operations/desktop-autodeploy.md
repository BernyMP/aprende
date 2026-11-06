# Desktop auto-deploy

Every commit that lands on `main` is built and installed as the maintainer's desktop app on their
Mac. A launchd agent checks `origin/main` every five minutes. When the commit is new, it builds the
macOS app with `dist:desktop:dmg:<arch>` and replaces `/Applications/aprende (Beta).app`.

The builds are unsigned and never leave the machine, which is why this runs locally instead of
publishing a release: macOS auto-update needs a signed app.

## Set up

From a checkout of this repository, with Rust installed (`~/.cargo/env`) and dependencies installed:

```sh
scripts/desktop-autodeploy.sh install [checkout]
```

`checkout` is a dedicated clean worktree the agent moves to each new `main` commit. It defaults to
`~/.aprende-autodeploy/checkout`, created as a worktree of this repository. Never point it at a
checkout you work in. The agent runs a copy of the script from `~/.aprende-autodeploy`, so rerun
`install` after changing the script.

`install` records your current `PATH` for launchd, so run it from a shell where `node`, `git` and
`cargo` resolve.

## What to expect

- If aprende is open when a build finishes, you get a notification and the install waits until you
  quit the app. The running session is never interrupted.
- A failed build notifies you once and is not retried until `main` moves.
- `scripts/desktop-autodeploy.sh status` shows the installed, staged and failed commits, plus the
  last log lines. The full log is `~/.aprende-autodeploy/autodeploy.log`.
- `scripts/desktop-autodeploy.sh uninstall` stops the agent and leaves the installed app in place.

The installed app uses your real aprende home (`~/.aprende`), like any other install.
