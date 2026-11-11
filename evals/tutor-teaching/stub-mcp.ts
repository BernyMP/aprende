#!/usr/bin/env node
// A stdio MCP server that plays aprende's tutor tools for one eval sample. run.ts writes the tool
// list and canned results to the file in STUB_CONFIG; each call is answered from it and appended
// to STUB_LOG, whose length numbers the cards across the sample's CLI runs.
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeReadline from "node:readline";

export interface StubConfig {
  readonly tools: ReadonlyArray<{
    readonly name: string;
    readonly description: string;
    readonly inputSchema: unknown;
  }>;
  /** Results keyed by tool name. A string is the `message` field; `{ id }` names the card. */
  readonly results: Readonly<Record<string, unknown>>;
  /** Programs the learner's computer lacks, each with the failure pose_problem gives for it. */
  readonly missingPrograms?: Readonly<Record<string, string>>;
}

export interface StubCall {
  readonly name: string;
  readonly input: unknown;
  readonly result: unknown;
}

const config = JSON.parse(NodeFS.readFileSync(process.env.STUB_CONFIG!, "utf8")) as StubConfig;
const logFile = process.env.STUB_LOG!;

const callCount = () =>
  NodeFS.existsSync(logFile)
    ? NodeFS.readFileSync(logFile, "utf8").split("\n").filter(Boolean).length
    : 0;

const resultFor = (name: string): unknown => {
  const number = callCount() + 1;
  if (name === "ask_question") return { questionId: `q-${number}`, message: config.results[name] };
  if (name === "pose_problem")
    return { problemId: `prob-${number}`, message: config.results[name] };
  if (name === "set_plan") return { version: 1, message: config.results[name] };
  const canned = config.results[name];
  return typeof canned === "string" ? { message: canned } : (canned ?? { message: "Done." });
};

/** The failure for a problem whose check starts with a missing program, as the server refuses it. */
const refusalFor = (name: string, input: unknown): string | undefined => {
  if (name !== "pose_problem") return undefined;
  const command = (input as { workspace?: { checkCommand?: unknown } }).workspace?.checkCommand;
  const program = typeof command === "string" ? command.trim().split(/\s+/)[0] : undefined;
  return program === undefined ? undefined : config.missingPrograms?.[program];
};

const send = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);

NodeReadline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (line.trim().length === 0) return;
  const request = JSON.parse(line) as {
    id?: number | string;
    method: string;
    params?: { name?: string; arguments?: unknown; protocolVersion?: string };
  };
  if (request.id === undefined) return;
  switch (request.method) {
    case "initialize":
      return send({
        jsonrpc: "2.0",
        id: request.id,
        result: {
          protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "aprende", version: "eval" },
        },
      });
    case "tools/list":
      return send({ jsonrpc: "2.0", id: request.id, result: { tools: config.tools } });
    case "tools/call": {
      const name = request.params?.name ?? "";
      const refusal = refusalFor(name, request.params?.arguments ?? {});
      // A refused call shows no card, so it is not logged and takes no card number.
      if (refusal !== undefined)
        return send({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            isError: true,
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  _tag: "OrchestratorMcpFailure",
                  code: "invalid_request",
                  message: refusal,
                }),
              },
            ],
          },
        });
      const result = resultFor(name);
      const call: StubCall = { name, input: request.params?.arguments ?? {}, result };
      NodeFS.appendFileSync(logFile, `${JSON.stringify(call)}\n`);
      return send({
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      });
    }
    default:
      return send({ jsonrpc: "2.0", id: request.id, result: {} });
  }
});
