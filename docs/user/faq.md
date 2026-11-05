# FAQ

## Where does aprende come from?

aprende is a fork of [T3 Code](https://github.com/pingdotgg/t3code), an open-source app for driving
coding agents, made by T3 Tools Inc. and released under the MIT license. aprende keeps T3 Code's
server, provider runtime, desktop shell and web client, and adds a tutor on top. The coding features
it inherited are being removed. aprende is not affiliated with T3 Tools Inc. Questions about aprende belong in
[aprende's issues](https://github.com/BernyMP/aprende/issues), not T3 Code's.

## What do I need to use aprende?

The `claude` (Claude Code) or `codex` (Codex CLI) command, installed and logged in on your machine.
aprende runs it with your own login and never asks for or stores API keys or account credentials.
[Provider setup](./install.md#providers)

## How much does aprende cost?

Nothing. aprende is free and open source (MIT). Tutor sessions use your Claude or Codex plan the
same way the CLI does.

## Where does my learning data go?

It stays on your machine, in `~/.aprende`. Your messages go from your machine to your provider
(Anthropic or OpenAI), as they do when you use the CLI yourself.

## Can I add a bunch of accounts for one provider?

aprende is not the place to manage a pool of accounts. A separate work account is fine. Setup for
two: [Codex](./providers-codex.md#use-multiple-accounts) ·
[Claude](./providers-claude.md#separate-accounts-or-configurations).

## Why is my provider not showing up?

Almost always, the CLI is not installed or not on the `PATH` of the machine that runs aprende. Log
in first, with `claude auth login` or `codex login`. Still missing? Point **Binary path** at it in
provider settings. Version managers often cause this. [Provider setup](./install.md#providers)
