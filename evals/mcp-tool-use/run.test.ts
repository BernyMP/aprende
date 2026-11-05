// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as Schema from "effect/Schema";
import { assert, expect, it } from "@effect/vitest";

import {
  buildBase,
  buildMessages,
  failedEarly,
  executeCodex,
  gradeSample,
  makeSample,
  ranCalls,
  McpToolUseCase,
  mockOutput,
  normalizeToolInput,
  normalizeToolName,
  type SampleRun,
  shellOutput,
  namedPathsLine,
  shellRequest,
  shellResponsesRequest,
  summarize,
  t3Default,
  t3SystemAppend,
  t3SubagentContext,
} from "./run.ts";
import { taskPrompt } from "../../apps/server/src/mcp/delegatedTaskModes.ts";

it("grades Codex shell and subagent calls with the shared rules", () => {
  const calls = [
    { name: "exec_command", input: { cmd: "sleep 60" } },
    { name: "collaboration.spawn_agent", input: { task: "review" } },
    { name: "mcp__t3_code__delegate_task", input: {} },
    { name: "request_user_input", input: { questions: [{ question: "What's the PIN?" }] } },
    { name: "request_user_input_async", input: { questions: [] } },
  ].map(({ name, input }) => ({
    step: 0,
    tool: normalizeToolName(name),
    input: normalizeToolInput(name, input),
  }));
  assert.deepEqual(
    calls.map((c) => c.tool),
    ["Bash", "Agent", "delegate_task", "AskUserQuestion", "AskUserQuestion"],
  );
  assert.deepEqual(
    failed(
      {
        calls: [{ tool: "Bash", args: { command: "~sleep" } }],
        notCalls: ["Agent"],
        shellMustNot: ["sleep"],
      },
      { calls, text: "", stopReason: "end_turn" },
    ),
    ["notCalls Agent", "shellMustNot /sleep/"],
  );
});

it("matches shellMust, not shellMustNot, against a command's argv lists as a command line", () => {
  const calls = [
    {
      step: 0,
      tool: "Bash",
      input: {
        command: `python3 -c "import subprocess; subprocess.run(['pnpm', 'exec',\n  'playwright', 'test'])"`,
      },
    },
  ];
  const run = { calls, text: "", stopReason: "end_turn" };
  assert.deepEqual(failed({ shellMust: ["\\bplaywright\\s+test\\b"] }, run), []);
  assert.deepEqual(failed({ shellMustNot: ["\\bplaywright\\s+test\\b"] }, run), []);
});

it("accepts any tool listed as an alternative", () => {
  const expect = { calls: [{ tool: "delegate_task|t3_thread_launch" }] };
  const run = (tool: string): SampleRun => ({
    calls: [{ step: 0, tool, input: {} }],
    text: "",
    stopReason: "end_turn",
  });
  assert.deepEqual(failed(expect, run("t3_thread_launch")), []);
  assert.deepEqual(failed(expect, run("task_status")), ["calls delegate_task|t3_thread_launch"]);
});

it("counts the new threads an agent asks for, one brief per thread, over both creation tools", () => {
  const expect = { newThreads: ["~reconnect", "~csv", "~admin"] };
  const run = (...calls: Array<{ tool: string; input: unknown; failed?: boolean }>): SampleRun => ({
    calls: calls.map((call, step) => ({ step, ...call })),
    text: "",
    stopReason: "end_turn",
  });
  const batch = (...prompts: Array<string>) => ({
    tool: "create_threads",
    input: { threads: prompts.map((prompt) => ({ prompt })) },
  });
  const launch = (message: string, failed = false) => ({
    tool: "t3_thread_launch",
    input: { message },
    failed,
  });
  const label = 'newThreads ["~reconnect","~csv","~admin"]';
  assert.deepEqual(failed(expect, run(batch("Fix reconnect", "Fix CSV dates", "Fix admin"))), []);
  assert.deepEqual(
    failed(expect, run(launch("Fix reconnect"), batch("Fix CSV dates", "Fix admin"))),
    [],
  );
  assert.deepEqual(
    failed(expect, run(launch("Fix reconnect", true), batch("Fix reconnect", "csv", "admin"))),
    [],
  );
  assert.deepEqual(failed(expect, run(batch("reconnect", "csv"), launch("csv and admin"))), []);
  assert.deepEqual(failed(expect, run(batch("Fix reconnect, csv and admin"))), [label]);
  assert.deepEqual(failed(expect, run(batch("reconnect, csv, admin", "csv", "csv"))), [label]);
  assert.deepEqual(failed(expect, run(batch("reconnect", "csv", "admin", "docs"))), [label]);
  for (const call of [
    { tool: "t3_thread_launch", input: { prompt: "csv" } },
    { tool: "create_threads", input: { threads: [{ message: "csv" }] } },
  ]) {
    assert.deepEqual(failed(expect, run(launch("reconnect"), launch("admin"), call)), [label]);
  }
  assert.deepEqual(
    failed(
      expect,
      run(launch("reconnect"), launch("admin"), {
        tool: "t3_thread_launch",
        input: { title: "CSV", message: "Fix reconnect" },
      }),
    ),
    [label],
  );
});

it("runs code-mode calls without exposing host capabilities, including after await", async () => {
  const catalog = [{ name: "mock", description: "mock" }];
  const result = await executeCodex(
    "text((await tools.mock({n: 2})).n); text([typeof process, typeof require, typeof fetch]);",
    catalog,
    async (_, input) => input,
  );
  assert.include(result, "2\n");
  assert.include(result, '["undefined","undefined","undefined"]');
  assert.include(
    await executeCodex('text.constructor("return process")()', catalog, async () => null),
    "Code generation from strings disallowed",
  );
  await expect(
    executeCodex("await tools.mock({}); while (true) {}", catalog, async () => null),
  ).rejects.toThrow("Script execution timed out");
});

it("answers a code-mode call the cell does not await", async () => {
  const answered: Array<unknown> = [];
  const catalog = [{ name: "mock", description: "mock" }];
  await executeCodex('tools.mock({n: 1}); text("done");', catalog, async (_, input) => {
    answered.push(input);
    return null;
  });
  assert.deepEqual(answered, [{ n: 1 }]);
});

const failed = (expect: Parameters<typeof gradeSample>[0], run: SampleRun) =>
  gradeSample(expect, run)
    .filter((check) => !check.pass)
    .map((check) => check.check);

it("passes a good run and names every rule a bad run breaks", () => {
  const expect = {
    calls: [{ tool: "delegate_task", args: { task: "~FINDING", "target.options": "~max" } }],
    callsMustNot: [{ tool: "delegate_task", args: { runtimeMode: "approval-required" } }],
    notCalls: ["t3_thread_send"],
    order: ["orchestrator_capabilities", "delegate_task"],
    minCalls: { orchestrator_capabilities: 1 },
    maxCalls: { task_status: 0 },
    endsTurnAfter: "delegate_task",
    shellMustNot: ["\\bsleep\\b"],
    textMust: ["t3-thread://v2/"],
    textMustNot: ["Paste .*token"],
  };
  const good: SampleRun = {
    calls: [
      { step: 0, tool: "orchestrator_capabilities", input: {} },
      {
        step: 1,
        tool: "delegate_task",
        input: { task: "Prior findings: ...", target: { options: { reasoningEffort: "max" } } },
      },
    ],
    text: "Started <t3-thread://v2/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee/11111111-1111-4111-8111-111111111111>. Do not paste a token.",
    stopReason: "end_turn",
  };
  assert.deepEqual(failed(expect, good), []);

  const bad: SampleRun = {
    calls: [
      {
        step: 0,
        tool: "delegate_task",
        input: { task: "Review again", runtimeMode: "approval-required" },
      },
      { step: 1, tool: "t3_thread_send", input: {} },
      { step: 2, tool: "Monitor", input: { command: "sleep 60" } },
      { step: 3, tool: "task_status", input: { taskId: "task-1" } },
    ],
    text: "Paste your token here.",
    stopReason: "max_steps",
  };
  assert.deepEqual(failed(expect, bad), [
    'calls delegate_task {"task":"~FINDING","target.options":"~max"}',
    'callsMustNot delegate_task {"runtimeMode":"approval-required"}',
    "notCalls t3_thread_send",
    "order orchestrator_capabilities > delegate_task",
    "minCalls orchestrator_capabilities >= 1",
    "maxCalls task_status <= 0",
    "endsTurnAfter delegate_task",
    "shellMustNot /\\bsleep\\b/",
    "textMust /t3-thread://v2//",
    "textMustNot /Paste .*token/",
  ]);
});

it("bounds numbers and reads target.options in either schema form", () => {
  const expect = {
    calls: [
      { tool: "t3_thread_read", args: { limit: "<=20" } },
      { tool: "delegate_task", args: { "target.options.effort": "max", timeoutMs: ">=60000" } },
    ],
  };
  const run = (limit: unknown, options: unknown, timeoutMs: number): SampleRun => ({
    calls: [
      { step: 0, tool: "t3_thread_read", input: { limit } },
      { step: 0, tool: "delegate_task", input: { target: { options }, timeoutMs } },
    ],
    text: "",
    stopReason: "end_turn",
  });
  assert.deepEqual(failed(expect, run(20, [{ id: "effort", value: "max" }], 60_000)), []);
  assert.deepEqual(failed(expect, run(5, { effort: "max" }, 90_000)), []);
  assert.lengthOf(failed(expect, run(21, [{ id: "effort", value: "high" }], 59_999)), 2);
  assert.lengthOf(failed(expect, run("10", {}, 60_000)), 2);
});

const template = {
  system: [
    { type: "text", text: "x-anthropic-billing-header: cc_version=1;" },
    { type: "text", text: "You are Claude Code." },
  ],
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "<system-reminder>\n# currentDate\n</system-reminder>" },
        { type: "text", text: "<system-reminder>\n# gitStatus\nmain\n</system-reminder>" },
        {
          type: "text",
          text: "<system-reminder>\nCodebase and user instructions are shown below.\n</system-reminder>",
        },
        { type: "text", text: "The captured prompt." },
      ],
    },
    {
      role: "system",
      content:
        "Main prompt.\n - Primary working directory: /home/alice/app\n\n<runtime_info>old</runtime_info>\n\n## aprende orchestration\nold text",
    },
    {
      role: "system",
      content:
        "You are powered by the model named Opus 5.5. The exact model ID is claude-opus-5-5.\n\nThe following deferred tools are now available via ToolSearch. Load them first:\nMonitor\nmcp__aprende__retired_tool\n\nAfter the list.",
    },
    { role: "assistant", content: [{ type: "text", text: "A later turn." }] },
  ],
  tools: [
    { name: "mcp__host__term_Bash", input_schema: { type: "object" } },
    { name: "mcp__host__clown_ToolSearch", input_schema: { type: "object" } },
    { name: "mcp__aprende__retired_tool", input_schema: { type: "object" }, defer_loading: true },
  ],
};

const childCase: McpToolUseCase = {
  id: "child-links-its-pr",
  area: "orchestration",
  kind: "guard",
  pattern: "delegated child reports back",
  experience: "A delegated child must open its PR and report back, not start more threads.",
  setup: {
    role: "delegated-child",
    delegateRole: "implementation",
    world: { branch: "fix/date-format", files: { "src/date.ts": "export const format = 1;\n" } },
    priorTurns: [
      {
        role: "assistant",
        toolCalls: [{ tool: "Bash", input: { command: "git push" }, result: "pushed" }],
      },
    ],
    shellMocks: [{ match: "^gh pr create", output: "https://github.com/acme/app/pull/124" }],
  },
  prompt: "Push the fix, open a PR against main, and report the PR URL.",
  expect: { notCalls: ["t3_thread_launch"] },
};

it("rebuilds the template from this checkout and sends a child T3's task prompt", () => {
  const base = buildBase(template, { model: "claude-sonnet-5-5", keepUserInstructions: false });
  const system = base.system.map((block) => String(block.text));
  assert.deepEqual(system.slice(0, 2), [
    "You are Claude Code.",
    `Main prompt.\n - Primary working directory: /home/user/app\n\n${t3SystemAppend("claude-sonnet-5-5")}`,
  ]);
  assert.equal(base.environment.cwd, "/home/user/app");
  assert.include(system[2], "model named Sonnet 5.5. The exact model ID is claude-sonnet-5-5.");
  const deferred = system[2]?.split("Load them first:\n")[1]?.split("\n\n")[0]?.split("\n") ?? [];
  assert.includeMembers(deferred, ["Monitor", "mcp__aprende__delegate_task"]);
  assert.notInclude(deferred, "mcp__aprende__retired_tool");
  const reminders = buildMessages(makeSample(childCase, base))[0]?.content.map((b) => b.text);
  assert.equal(reminders?.[0], "<system-reminder>\n# currentDate\n</system-reminder>");
  assert.include(reminders?.[1], "Current branch: fix/date-format");
  assert.notInclude(reminders?.join(), "Codebase and user instructions");

  const prompt = buildMessages(makeSample(childCase, base)).at(-1)?.content.at(-1);
  assert.equal(prompt?.text, taskPrompt({ task: childCase.prompt, role: "implementation" }));
  assert.notEqual(prompt?.text, childCase.prompt);
});

it("replays earlier capability results with the model under test as the caller", () => {
  const base = buildBase(template, { model: "claude-opus-5-5", keepUserInstructions: false });
  const capabilities = {
    inheritedProviderInstanceId: "claudeAgent",
    inheritedModel: "claude-sonnet-5-5",
  };
  const testCase: McpToolUseCase = {
    ...childCase,
    setup: {
      role: "top",
      priorTurns: [
        {
          role: "assistant",
          toolCalls: [{ tool: "orchestrator_capabilities", input: {}, result: capabilities }],
        },
      ],
    },
  };
  const replayed = buildMessages(makeSample(testCase, base))
    .flatMap((message) => message.content)
    .find((block) => block.type === "tool_result" && String(block.content).includes("inherited"));
  assert.include(String(replayed?.content), '"inheritedModel":"claude-opus-5-5"');
  const resumed = buildMessages(makeSample({ ...testCase, prompt: "" }, base));
  assert.equal(resumed.at(-1)?.role, "user");
  assert.equal(resumed.at(-1)?.content.at(-1)?.type, "tool_result");
  for (const setup of [
    {
      ...testCase.setup,
      sideChat: { parentThreadId: "thread-parent", digest: ["The permissions fix is committed."] },
    },
    { ...testCase.setup, role: "native-subagent" as const },
    { ...testCase.setup, role: "delegated-child" as const },
  ]) {
    assert.throws(
      () =>
        buildMessages(
          makeSample(
            { ...testCase, prompt: "", setup },
            { ...base, subagentContext: "Hook context" },
          ),
        ),
      /Empty-prompt replay/,
    );
  }
});

it("gives each launched thread its own id, and reading it back shows that thread's brief", () => {
  const base = buildBase(template, { model: "claude-sonnet-5-5", keepUserInstructions: false });
  const sample = makeSample(childCase, base);
  const one = t3Default(sample, "t3_thread_launch", {
    title: "Reconnect",
    message: "Fix reconnect",
  });
  const batch = t3Default(sample, "create_threads", {
    threads: [
      { title: "CSV", prompt: "Fix CSV dates" },
      { prompt: "Fix admin expiry", target: { providerInstanceId: "muse", model: "muse-wonder" } },
    ],
  });
  const created = (batch as { threads: Array<{ providerInstanceId: string; model: string }> })
    .threads;
  assert.deepEqual(
    created.map((thread) => [thread.providerInstanceId, thread.model]),
    [
      ["claudeAgent", "claude-sonnet-5-5"],
      ["muse", "muse-wonder"],
    ],
  );
  const ids = [one, ...(batch as { threads: Array<unknown> }).threads].map(
    (thread) => (thread as { threadId: string }).threadId,
  );
  assert.equal(new Set(ids).size, 3);
  const read = (threadId: unknown) =>
    t3Default(sample, "t3_thread_read", { threadId }) as {
      thread: { title: string; status: string; createdBy?: string };
      items: Array<{ text: string; createdBy: string; creationSource: string }>;
    };
  const idle = t3Default(sample, "create_threads", { threads: [{ title: "Later" }] }) as {
    threads: Array<{ threadId: string; status: string; runId?: string }>;
  };
  assert.equal(idle.threads[0]?.status, "idle");
  assert.isUndefined(idle.threads[0]?.runId);
  assert.equal(read(idle.threads[0]?.threadId).thread.status, "idle");
  assert.deepEqual(read(idle.threads[0]?.threadId).items, []);
  assert.equal(read(ids[1]).thread.title, "CSV");
  assert.equal(read(ids[2]).items[0]?.text, "Fix admin expiry");
  assert.equal(read(ids[2]).thread.createdBy, "agent");
  assert.deepEqual(
    [read(ids[2]).items[0]?.createdBy, read(ids[2]).items[0]?.creationSource],
    ["agent", "mcp"],
  );
  assert.equal(
    read("11111111-1111-4111-8111-111111111111").thread.title,
    "Fix the flaky reconnect test",
  );
});

it("does not record a deferred tool called before it was loaded", () => {
  const base = buildBase(template, { model: "claude-sonnet-5-5", keepUserInstructions: false });
  const sample = makeSample(childCase, base);
  const use = (name: string) => ({ type: "tool_use" as const, id: name, name, input: {} });
  const ran = ranCalls(sample, 0, [
    use("mcp__aprende__delegate_task"),
    use("mcp__host__term_Bash"),
  ]);
  assert.deepEqual(
    ran.map((call) => call.tool),
    ["Bash"],
  );
});

it("answers simple mocked commands itself and gives the simulator the sample's history", () => {
  const sample = makeSample(
    childCase,
    buildBase(template, { model: "claude-sonnet-5-5", keepUserInstructions: false }),
  );
  assert.equal(mockOutput(sample, "gh pr create --fill"), "https://github.com/acme/app/pull/124");
  assert.isUndefined(mockOutput(sample, "git push && gh pr create --fill"));
  assert.isUndefined(mockOutput(sample, "git status"));

  const call = { tool: "Bash", input: { command: "git push && gh pr create --fill" } };
  const [machine, history] =
    shellRequest(sample, call, "claude-haiku-5-5").messages[0]?.content ?? [];
  assert.include(machine?.text, "Working directory: /home/user/app");
  assert.include(machine?.text, '"src/date.ts":"export const format = 1;\\n"');
  assert.include(machine?.text, "^gh pr create");
  assert.include(machine?.text, childCase.prompt);
  assert.equal(
    history?.text,
    '<call>Bash {"command":"git push"}</call>\n<output>\npushed\n</output>\n\nNew call:\n<call>Bash {"command":"git push && gh pr create --fill"}</call>',
  );
});

it("tells the simulator that paths the case names exist, whatever the template's cwd", () => {
  const testCase = McpToolUseCase.make({
    id: "named-paths",
    area: "test",
    kind: "control",
    pattern: "p",
    experience: "e",
    setup: {
      role: "top",
      context: "Work in /home/user/acme/app. /tmp/acmeqa/run.mjs runs a Playwright script.",
      world: { files: { "/tmp/acmeqa/login.mjs": "export {}", "src/a.ts": "" } },
    },
    prompt: "Check it.",
    expect: {},
  });
  const [line] = namedPathsLine(testCase);
  assert.include(line, "/home/user/acme/app,");
  assert.include(line, "/tmp/acmeqa/run.mjs");
  assert.include(line, "/tmp/acmeqa/login.mjs");
  assert.notInclude(line, "src/a.ts");
  assert.deepEqual(
    namedPathsLine({ ...testCase, setup: { role: "top", context: "No paths here." } }),
    [],
  );
});

it("sends a GPT shell model the same simulator request, with a strict JSON reply", () => {
  const sample = makeSample(
    McpToolUseCase.make({
      id: "shell-gpt",
      area: "test",
      kind: "control",
      pattern: "p",
      experience: "e",
      setup: { role: "top" },
      prompt: "Check the branch.",
      expect: {},
    }),
    buildBase(template, { model: "gpt-6.1-sol", keepUserInstructions: false }),
  );
  const body = shellRequest(
    sample,
    { tool: "Bash", input: { command: "git status" } },
    "gpt-6-luna",
  );
  const request = shellResponsesRequest(body);
  assert.equal(request.model, "gpt-6-luna");
  assert.equal(request.instructions, body.system);
  assert.isTrue(request.text.format.strict);
  assert.deepEqual(
    request.input[0]?.content.map((part) => part.text),
    body.messages[0]?.content.map((block) => block.text),
  );
});

it("reads the tool output from the simulator's JSON reply", () => {
  const reply = (value: string) => [{ type: "thinking" }, { type: "text", text: value }];
  assert.equal(
    shellOutput(reply('{"facts":"PR 124 is new","output":"https://x/pull/124\\n"}')),
    "https://x/pull/124",
  );
  assert.equal(shellOutput(reply("plain output\n")), "plain output");
});

it("stops a sample only once a must-not check has failed", () => {
  const run = (tool: string, text = ""): SampleRun => ({
    calls: [{ step: 0, tool, input: {} }],
    text,
    stopReason: "tool_use",
  });
  const expect = { calls: [{ tool: "delegate_task" }], notCalls: ["t3_thread_launch"] };
  assert.isFalse(failedEarly(expect, run("Bash")));
  assert.isTrue(failedEarly(expect, run("t3_thread_launch")));
  assert.isTrue(failedEarly({ textMustNot: ["paste"] }, run("Bash", "paste it here")));
});

const decodeCase = Schema.decodeSync(Schema.fromJsonString(McpToolUseCase));
const casesIn = (file: string) =>
  NodeFS.readFileSync(new URL(`./cases/${file}.ndjson`, import.meta.url), "utf8")
    .trim()
    .split("\n")
    .map((line) => decodeCase(line));

it("gives native children hook context while excluding the parent's T3 append and history", async () => {
  const testCase = casesIn("orchestration").find(
    (c) => c.id === "native-subagent-delegates-further",
  )!;
  assert.isEmpty(testCase.setup.priorTurns ?? []);
  const child = buildBase(template, {
    model: "claude-sonnet-5-5",
    keepUserInstructions: false,
    nativeSubagent: true,
  });
  assert.notInclude(
    child.system.map((block) => block.text).join("\n"),
    t3SystemAppend("claude-sonnet-5-5"),
  );
  const subagentContext = await t3SubagentContext("claude-sonnet-5-5");
  const messages = buildMessages(makeSample(testCase, { ...child, subagentContext }));
  const shown = messages
    .flatMap((message) => message.content)
    .map((block) => block.text ?? "")
    .join("\n");
  if (subagentContext) assert.include(shown, subagentContext);
  else assert.notInclude(shown, "SubagentStart hook additional context:");
  assert.include(shown, testCase.prompt);
});

it("leaves errored samples out of pass rates and lists them in the summary", () => {
  const usage = { input: 10, output: 0, cacheWrite: 0, cacheRead: 0 };
  const row = (id: string, pass: boolean, error?: string) => ({
    id,
    kind: "bad" as const,
    pattern: "device",
    role: "top",
    pass,
    usage,
    shellUsage: usage,
    ...(error === undefined ? {} : { error }),
  });
  const summary = summarize(
    [row("A", true), row("A", false, "Model API 429"), row("B", false, "Model API 429")],
    { header: "run", shellModel: "claude-haiku-5-5", model: "claude-sonnet-5-5" },
    new Map([["A", 0.5]]),
  );
  assert.include(summary, "- Pass: 100% of 1 samples.");
  assert.include(summary, "- Errored: A ×1, B ×1.");
  assert.include(summary, "| A | 100% of 1, 1 errored | 50% | 50 pts |");
  assert.include(summary, "| B | - of 0, 1 errored | new | |");
  // Errored samples' tokens still count: 3 rows of 10 input tokens each.
  assert.include(summary, "input 30");
});
