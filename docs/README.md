# aprende docs

aprende is a fork of [T3 Code](https://github.com/pingdotgg/t3code) (MIT), and is not affiliated
with T3 Tools Inc. Many internal notes below describe architecture inherited from T3 Code.

## Using aprende

- [Install aprende](./user/install.md)
- [FAQ](./user/faq.md)
- [Learning sessions](./user/learning.md)
- [Messages and context](./user/composer.md)
- [Working with threads](./user/thread-sidebar.md)
- [Permission modes](./user/permission-modes.md)
- [Project settings](./user/project-settings.md)
- [Appearance](./user/appearance.md)
- [Keyboard shortcuts](./user/keybindings.md)
- [SnapShots](./user/snap-shot.md)
- [Visual replies](./user/html-renders.md)
- [Usage and limits](./user/usage.md)
- [Telemetry](./user/telemetry.md)
- [Remote access](./user/remote-access.md)
- [Outside agents (MCP)](./user/outside-agents.md)
- [Running in the background](./user/background-service.md)
- [Updating aprende](./user/updating.md)
- Provider guides: [Codex](./user/providers-codex.md) · [Claude](./user/providers-claude.md)

---

## Working on aprende

Start with the [development runbook](./operations/development.md) and
[contributing guide](../CONTRIBUTING.md).

Internal notes preserve architectural decisions, constraints, and implementation traps that the
source alone does not explain. Most code changes do not need an internal documentation update. Follow the
[documentation rules](../AGENTS.md#documentation) before adding one.

- [Architecture overview](./internals/overview.md)
- [Glossary](./internals/glossary.md)
- [Connection runtime](./internals/connection-runtime.md)
- [Providers](./internals/providers.md)
- [Adding a provider](./internals/adding-a-provider.md)
- [Model classification](./internals/model-manifest.md)
- [Remote environments](./internals/remote.md)
- [Server updates](./internals/server-updates.md)
- [Resource telemetry](./internals/resource-telemetry.md)
- [Environment auth](./internals/environment-auth.md)
- [Assistant citations](./internals/assistant-citations.md)

### Runbooks

- [Development and local builds](./operations/development.md)
- [Observability](./operations/observability.md)
- [Desktop auto-deploy](./operations/desktop-autodeploy.md)
