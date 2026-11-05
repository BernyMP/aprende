# MCP tool use

Replays small fake threads on Claude and Codex models and checks how they use T3's MCP tools: delegation, previews, and more. Each case reproduces a real mistake an agent made in aprende.

The model sees what it sees in aprende. A trimmed capture of a real harness turn supplies the harness prompt and native tools. T3's instructions, tool descriptions, and schemas come from this checkout. A cheap model plays the shell, so nothing runs on your machine.

## Run

```sh
cd evals
pnpm mcp-tool-use --case review-round-uses-thread-send --samples 1 --out runs/check
pnpm mcp-tool-use --model claude-opus-5-5 --out runs/opus
```

- `ANTHROPIC_API_KEY` in the repo root `.env` pays for Claude models and the Haiku shell simulator.
- Codex models (`gpt-*` in `MODELS` in `run.ts`) go through a CLIProxyAPI server, set up as the `vibeproxy` model provider in `~/.codex/config.toml`. Keep the proxy under about 12 samples in flight across all runs.
- `--shell-model` picks the model that plays the shell: `claude-haiku-5-5` by default, or `gpt-6.1-terra` / `gpt-6-luna` through the same proxy, so Codex runs need no Anthropic key. Prefer Terra: Luna often contradicts the case's world (it calls named checkouts missing or files empty). Compare runs only when they used the same shell model.
- Flags: `--case <ids>`, `--cases <file.ndjson>`, `--samples <n>` (default 2, and a 3rd when the first 2 disagree), `--concurrency <n>` (samples in flight, default 8), `--max-steps <n>`, `--effort <level>`, `--dry-run` (prints request bodies, no model calls), and `--context` (prints the size of T3's text and schemas, no key needed).
- `--baseline <results.jsonl> --stop-on-regression` stops as soon as a case that passed every baseline sample fails. Use it to test one copy change against a baseline run.
- Cost: the suite costs about $9 on Sonnet and $17 on Opus. Dry runs cost $0. Results record token costs for the agent and shell simulator. Codex proxy charges are outside that total; only its shell simulator is priced here.
- A rate limit or overload (429, 529 or another 5xx) is retried with backoff for up to about 4 minutes. A sample that still fails gets an `error` in `results.jsonl`, is left out of every pass rate, and is listed in the summary; the tokens it spent still count toward the cost.

## Add a case

Cases are JSON lines in `cases/`, one file per area. The case schema in `run.ts` (`McpToolUseCase`) documents every field.

- `kind`: `bad` reproduces a mistake, `guard` protects correct behavior, `control` is ordinary work.
- `experience`: the real mistake, in a sentence. `source`: where it happened.
- `setup`: the fake thread, its `world` (repo, branch, files, PRs, pages), `priorTurns`, and `mocks` for tool results.
- `setup.priorTurns[].toolCalls[].resultFile`: load a repository-relative file as the tool result instead of copying its contents into the case. An empty `prompt` resumes a top-level thread after its last prior tool result without adding a user message. Side-chat and subagent setups require a nonempty prompt.
- `expect`: the checks, such as `calls`, `callsMustNot`, `maxCalls`, `order`, `shellMust`, `textMust`, `finalTextMust` (the last text, once the turn ended), and `linked`. A call's `args` match partially: `~text` is a case-insensitive substring, `"<=N"` / `">=N"` bound a number, `null` matches a missing key, and keys may be dotted paths.

Check that the case builds with `--dry-run --case <id>`. Then run it on the text before your fix, where it must fail, and on the text after, where it must pass.

## Threads vs tasks cases

`cases/threads-vs-tasks.ndjson` covers explicit thread requests, delegated and background work, lifecycle operations, child permissions, and ordinary code requests using words like "thread" and "task". The native-subagent case is Claude-only. All scenarios use authored Acme data.

`expect.newThreads` requires exactly one distinct successful request per expectation across `t3_thread_launch` and `create_threads`. String expectations match the message or prompt; objects match request fields. Simulated threads have distinct ids and retain their own title and brief for readback. Threads without a prompt stay idle.

From `evals/`:

```sh
pnpm mcp-tool-use --cases mcp-tool-use/cases/threads-vs-tasks.ndjson --samples 3 --out runs/threads-vs-tasks
```

These cases measure routing decisions with simulated tools, not delivered child work. The original PR's paid baseline found Sonnet starting a background native Agent for `tt-background-agent`; the routing fix is stacked separately in #27139. Historical model results and the unresolved top-level reviewer re-check wording are recorded in #27138.

## Where T3's text lives

- `packages/provider-core/src/server/runtimeInstructions.ts`
- `packages/provider-core/src/server/orchestrationInstructions.ts`
- `apps/server/src/provider/CodexDeveloperInstructions.ts`
- `apps/server/src/mcp/toolkits/*/tools.ts` (tool descriptions)
- `packages/contracts/src/*Mcp.ts` (parameter descriptions and result text)

## Templates

`templates/` holds one trimmed capture per harness. Refresh them when a harness changes its prompt or native tools:

1. Capture one aprende turn through CLIProxyAPI, with T3's MCP server connected.
2. From `evals/`, run `pnpm mcp-tool-use:trim-capture <claude|codex> <capture.json> mcp-tool-use/templates/<claude|codex>.json.gz`. It keeps only what `run.ts` reads, and removes user instructions, the user's own skills and agents, account ids, and home paths.
3. Read the output for user data before you commit it: `zcat <file> | less`.
4. Run the full eval on the old and new templates, and compare.
