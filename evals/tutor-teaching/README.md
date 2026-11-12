# Tutor teaching

Plays short learning sessions against the tutor prompt and the `learn` tools, and checks how the
tutor teaches: worked examples first for a novice, a problem first for an experienced learner,
checks and hints kept whatever the learner profile says, no learning-styles talk, the first-session
profile questions, review problems that name the due propositions, notebook outline suggestions
made after measuring and only inside a notebook, a notebook's first session ending at its outline,
a starting point written in short levelled phrases, a new notebook set up one question at a time
before the tutor names it, coding practice: Python posed without talk of installing, and a
language the computer lacks explained instead of posed blind, and a reply around each card that
neither points at the card nor asks its question again.

Each sample runs your own `claude` CLI, with your login, once per tutor turn, resuming the same
session. The system prompt is the tutor prompt plus the learner profile's section, composed by the
same code the adapters use. A stub MCP server (`stub-mcp.ts`) offers the real `learn` tool
descriptions and schemas from this checkout and returns the real tool result text. A scripted
learner (`learnerReply` in `grade.ts`) answers each card the way the case's persona says, through
aprende's own answer formatting, so runs differ only by what the tutor does.

Built-in tools are off, as are your settings and CLAUDE.md. Codex gets the same text as developer
instructions but is not covered here.

## Run

```sh
cd evals
pnpm tutor-teaching --case novice-worked-example-first --samples 1 --out runs/check
pnpm tutor-teaching --out runs/haiku
pnpm tutor-teaching --model claude-opus-5-5 --out runs/opus
```

- Flags: `--model` (default `claude-haiku-5-5`), `--judge-model` (default `claude-haiku-5-5`),
  `--case <id>` (repeatable), `--samples <n>` (default 3; a case fails when half or more fail),
  `--concurrency <n>` (default 4).
- Baseline on older text: `git show main:apps/server/src/learning/tutorPrompt.ts >
  runs/old/tutorPrompt.ts`, then add `--prompt-module runs/old/tutorPrompt.ts`, and
  `--no-profile-section` when the old app had no profile. The tools stay this checkout's.
- Cost: runs count against your Claude plan, not an API key. A full Haiku run is about 25 samples
  and 150 CLI turns, and takes about 10 minutes at the default concurrency.

## Add a case

Cases are in `cases.ts`. Each has a persona (the scripted learner), the saved profile, a turn cap,
and a check: a rule over the tool calls, or a question for the judge model in `grade.ts`. `run.test.ts`
covers the grader and the scripted learner; extend it when you add a check.

| Model            | Notes                         |
| ---------------- | ----------------------------- |
| claude-haiku-5-5 | Default; cheapest tutor model |
| claude-opus-5-5  | One full run before merging   |
