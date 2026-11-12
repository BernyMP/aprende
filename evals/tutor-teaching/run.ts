#!/usr/bin/env node
// An eval script, not server code: it runs the learner's own `claude` CLI and writes files.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { TUTOR_MCP_TOOL_NAMES } from "@aprende/contracts";
import { Tool } from "effect/ai";

import { learnerProfileSection } from "../../apps/server/src/learning/learnerProfile.ts";
import { missingProgramMessage } from "../../apps/server/src/learning/learningLogic.ts";
import { advertisedJsonSchema } from "../../apps/server/src/mcp/advertisedJsonSchema.ts";
import { HtmlToolkit } from "../../apps/server/src/mcp/toolkits/html/tools.ts";
import { LEARN_TOOL_MESSAGES } from "../../apps/server/src/mcp/toolkits/learn/handlers.ts";
import { LearnToolkit } from "../../apps/server/src/mcp/toolkits/learn/tools.ts";
import { cases, type TutorCase } from "./cases.ts";
import {
  isDone,
  judgePrompt,
  judgeVerdict,
  learnerReply,
  ruleVerdict,
  type Turn,
  type TurnEvent,
} from "./grade.ts";
import type { StubConfig } from "./stub-mcp.ts";

const { values } = NodeUtil.parseArgs({
  options: {
    out: { type: "string" },
    model: { type: "string", default: "claude-haiku-5-5" },
    "judge-model": { type: "string", default: "claude-haiku-5-5" },
    case: { type: "string", multiple: true },
    samples: { type: "string", default: "3" },
    concurrency: { type: "string", default: "4" },
    "prompt-module": { type: "string" },
    "no-profile-section": { type: "boolean", default: false },
  },
});
if (!values.out) throw new Error("Use --out <directory> [--model <id>] [--case <id>].");
const outDirectory = NodePath.resolve(values.out);
NodeFS.mkdirSync(outDirectory, { recursive: true });
const model = values.model;
const judgeModel = values["judge-model"];
const samples = Number(values.samples);
const selected = values.case ? cases.filter((entry) => values.case!.includes(entry.id)) : cases;
if (selected.length === 0) throw new Error("No case matches --case.");

// A baseline passes an older tutorPrompt.ts (for example from `git show`) as --prompt-module.
const { DEFAULT_TUTOR_PROMPT: tutorPrompt } = (await import(
  values["prompt-module"] === undefined
    ? "../../apps/server/src/learning/tutorPrompt.ts"
    : NodePath.resolve(values["prompt-module"])
)) as { readonly DEFAULT_TUTOR_PROMPT: string };

/** What the adapters run the tutor on, as readTutorInstructions composes it. */
const instructionsFor = (entry: TutorCase) => {
  const section = values["no-profile-section"] ? "" : learnerProfileSection(entry.profile);
  return section.length === 0 ? tutorPrompt : `${tutorPrompt}\n\n${section}`;
};

const tools = [
  ...Object.values(LearnToolkit.tools),
  ...Object.values(HtmlToolkit.tools).filter((tool) => TUTOR_MCP_TOOL_NAMES.includes(tool.name)),
].map((tool: Tool.Any) => ({
  name: tool.name,
  description: Tool.getDescription(tool) ?? "",
  inputSchema: advertisedJsonSchema(tool),
}));

const outlineOf = (entry: TutorCase) =>
  entry.mocks?.get_outline ?? {
    inNotebook: false,
    notebook: null,
    topics: [],
    lessonTopicId: null,
    pendingProposal: false,
    needsName: false,
    needsOutline: false,
  };

// The handlers nudge a session that sets its notebook up; the stub replays the same text.
const outlineResult = (entry: TutorCase) => {
  const outline = outlineOf(entry);
  if (outline.needsName) return { ...outline, message: LEARN_TOOL_MESSAGES.get_outline_needs_name };
  return outline.needsOutline
    ? { ...outline, message: LEARN_TOOL_MESSAGES.get_outline_needs_outline }
    : outline;
};

const stubConfig = (entry: TutorCase): StubConfig => ({
  tools,
  results: {
    ...LEARN_TOOL_MESSAGES,
    graph_search: entry.mocks?.graph_search ?? { propositions: [], chains: [] },
    graph_record: { propositions: [] },
    review_due: entry.mocks?.review_due ?? { total: 0, propositions: [] },
    get_outline: outlineResult(entry),
    ...(outlineOf(entry).needsOutline
      ? {
          finish_measuring: LEARN_TOOL_MESSAGES.finish_measuring_needs_outline,
          propose_outline: LEARN_TOOL_MESSAGES.propose_outline_first,
        }
      : {}),
    set_profile: { profile: {}, message: LEARN_TOOL_MESSAGES.set_profile },
    html_render: { message: "The learner sees the render now." },
    html_preview: { message: "Previewed." },
  },
  missingPrograms: Object.fromEntries(
    (entry.mocks?.missingPrograms ?? []).map((program) => [
      program,
      missingProgramMessage(program),
    ]),
  ),
});

interface CliResult {
  readonly events: ReadonlyArray<TurnEvent>;
  readonly costUsd: number;
}

const PREFIX = "mcp__aprende__";

/** One tutor turn through `claude -p`, parsed from its stream-json output. */
const runClaude = (input: {
  readonly cwd: string;
  readonly args: ReadonlyArray<string>;
}): Promise<CliResult> =>
  new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn("claude", input.args, {
      cwd: input.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", (code) => {
      const events: Array<TurnEvent> = [];
      const pending = new Map<string, { name: string; input: Record<string, unknown> }>();
      let costUsd = 0;
      for (const line of stdout.split("\n")) {
        if (!line.startsWith("{")) continue;
        const message = JSON.parse(line) as {
          type: string;
          total_cost_usd?: number;
          is_error?: boolean;
          result?: string;
          message?: { content?: ReadonlyArray<Record<string, unknown>> };
        };
        if (message.type === "result") {
          costUsd = message.total_cost_usd ?? 0;
          if (message.is_error === true) return reject(new Error(`claude: ${message.result}`));
        }
        for (const block of message.message?.content ?? []) {
          if (block.type === "text" && typeof block.text === "string" && block.text.trim())
            events.push({ kind: "text", text: block.text });
          if (block.type === "tool_use" && typeof block.name === "string")
            pending.set(String(block.id), {
              name: block.name.replace(PREFIX, ""),
              input: (block.input ?? {}) as Record<string, unknown>,
            });
          if (block.type === "tool_result") {
            const call = pending.get(String(block.tool_use_id));
            if (call === undefined) continue;
            // A failed call's content arrives as one string, not as parts.
            const content =
              typeof block.content === "string"
                ? [{ text: block.content }]
                : Array.isArray(block.content)
                  ? block.content
                  : [];
            const raw = content
              .map((part: { text?: string }) => part.text ?? "")
              .join("")
              .trim();
            let result: Record<string, unknown> = {};
            try {
              result = JSON.parse(raw) as Record<string, unknown>;
            } catch {
              result = { text: raw };
            }
            events.push({ kind: "call", ...call, result, isError: block.is_error === true });
          }
        }
      }
      if (code !== 0 && events.length === 0)
        return reject(new Error(`claude exited ${code}: ${stderr.slice(-500)}`));
      resolve({ events, costUsd });
    });
  });

const judge = async (cwd: string, prompt: string) => {
  const result = await new Promise<{ text: string; costUsd: number }>((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      "claude",
      [
        "-p",
        prompt,
        "--model",
        judgeModel,
        "--system-prompt",
        "You grade transcripts of a tutor for an evaluation. Be strict and literal.",
        "--setting-sources",
        "",
        "--tools",
        "",
        "--strict-mcp-config",
        "--no-session-persistence",
        "--output-format",
        "json",
      ],
      { cwd, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.on("error", reject);
    child.on("close", () => {
      try {
        const parsed = JSON.parse(stdout) as { result?: string; total_cost_usd?: number };
        resolve({ text: parsed.result ?? "", costUsd: parsed.total_cost_usd ?? 0 });
      } catch {
        reject(new Error(`judge output: ${stdout.slice(0, 300)}`));
      }
    });
  });
  return result;
};

interface SampleResult {
  readonly case: string;
  readonly kind: TutorCase["kind"];
  readonly sample: number;
  readonly model: string;
  readonly pass: boolean;
  readonly reason: string;
  readonly turns: ReadonlyArray<Turn>;
  readonly costUsd: number;
  readonly error?: string;
}

const runSample = async (entry: TutorCase, sample: number): Promise<SampleResult> => {
  const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "aprende-tutor-eval-"));
  const configFile = NodePath.join(directory, "stub.json");
  NodeFS.writeFileSync(configFile, JSON.stringify(stubConfig(entry)));
  const mcpConfig = JSON.stringify({
    mcpServers: {
      aprende: {
        type: "stdio",
        command: process.execPath,
        args: [NodePath.join(import.meta.dirname, "stub-mcp.ts")],
        env: { STUB_CONFIG: configFile, STUB_LOG: NodePath.join(directory, "calls.jsonl") },
      },
    },
  });
  const sessionId = NodeCrypto.randomUUID();
  const turns: Array<Turn> = [];
  let costUsd = 0;
  try {
    let message = entry.persona.opening;
    while (turns.length < entry.maxTurns) {
      const result = await runClaude({
        cwd: directory,
        args: [
          "-p",
          message,
          "--model",
          model,
          "--system-prompt",
          instructionsFor(entry),
          "--mcp-config",
          mcpConfig,
          "--strict-mcp-config",
          "--setting-sources",
          "",
          "--tools",
          "",
          "--allowedTools",
          "mcp__aprende",
          "--output-format",
          "stream-json",
          "--verbose",
          ...(turns.length === 0 ? ["--session-id", sessionId] : ["--resume", sessionId]),
        ],
      });
      costUsd += result.costUsd;
      turns.push({ user: message, events: result.events });
      if (isDone(entry.check, turns)) break;
      message = learnerReply(entry.persona, turns);
    }
    const rule = ruleVerdict(entry.check, turns);
    let verdict = rule;
    if (verdict === undefined) {
      const prompt = judgePrompt(entry.check, turns)!;
      const judged = await judge(directory, prompt);
      costUsd += judged.costUsd;
      verdict = judgeVerdict(entry.check, judged.text);
    }
    // A sample that never reached what the check grades counts as an error, not a fail.
    if ("inconclusive" in verdict && verdict.inconclusive === true)
      return {
        case: entry.id,
        kind: entry.kind,
        sample,
        model,
        pass: false,
        reason: verdict.reason,
        turns,
        costUsd,
        error: verdict.reason,
      };
    return { case: entry.id, kind: entry.kind, sample, model, ...verdict, turns, costUsd };
  } catch (error) {
    return {
      case: entry.id,
      kind: entry.kind,
      sample,
      model,
      pass: false,
      reason: "error",
      turns,
      costUsd,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    NodeFS.rmSync(directory, { recursive: true, force: true });
  }
};

const jobs = selected.flatMap((entry) =>
  Array.from({ length: samples }, (_, sample) => ({ entry, sample })),
);
const results: Array<SampleResult> = [];
const resultsFile = NodePath.join(outDirectory, "results.jsonl");
NodeFS.writeFileSync(resultsFile, "");
let next = 0;
await Promise.all(
  Array.from({ length: Number(values.concurrency) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++]!;
      const result = await runSample(job.entry, job.sample);
      results.push(result);
      NodeFS.appendFileSync(resultsFile, `${JSON.stringify(result)}\n`);
      process.stdout.write(
        `${result.pass ? "pass" : "FAIL"} ${result.case} #${result.sample}: ${result.error ?? result.reason}\n`,
      );
    }
  }),
);

const lines = [`# Tutor teaching: ${model}`, ""];
lines.push("| Case | Kind | Passed | Result |", "| --- | --- | --- | --- |");
for (const entry of selected) {
  const rows = results.filter((result) => result.case === entry.id && result.error === undefined);
  const passed = rows.filter((result) => result.pass).length;
  // A case fails when half or more of its samples fail.
  const verdict = rows.length === 0 ? "error" : passed * 2 > rows.length ? "pass" : "FAIL";
  lines.push(`| ${entry.id} | ${entry.kind} | ${passed}/${rows.length} | ${verdict} |`);
}
const cost = results.reduce((total, result) => total + result.costUsd, 0);
const errors = results.filter((result) => result.error !== undefined);
lines.push("", `List-price cost: $${cost.toFixed(2)}. Errors: ${errors.length}.`);
NodeFS.writeFileSync(NodePath.join(outDirectory, "summary.md"), `${lines.join("\n")}\n`);
process.stdout.write(`\n${lines.join("\n")}\n`);
