import * as HostProcess from "@aprende/shared/HostProcess";
import * as Effect from "effect/Effect";

import * as ProcessRunner from "../processRunner.ts";

/**
 * Append after inherited entries without changing argv or the user's config.
 * Windows env keys ignore case: read the last spelling of the count so command overrides win,
 * then update every spelling because Node may keep any one.
 * Leave invalid counts untouched so Git reports them.
 */
const gitConfigEnv = (
  env: NodeJS.ProcessEnv,
  key: string,
  value: string,
  platform: NodeJS.Platform,
): NodeJS.ProcessEnv => {
  const countKeys = Object.keys(env).filter((name) =>
    platform === "win32" ? name.toUpperCase() === "GIT_CONFIG_COUNT" : name === "GIT_CONFIG_COUNT",
  );
  const countKey = countKeys.at(-1) ?? "GIT_CONFIG_COUNT";
  const inherited = env[countKey];
  if (
    inherited !== undefined &&
    inherited !== "" &&
    // Match Git's strtoul count syntax, including whitespace, signs and non-negative -0.
    /^[ \t\r\n\v\f]*(?:\+?\d+|-0+)/.exec(inherited)?.[0] !== inherited
  ) {
    return {};
  }
  const count = inherited === undefined || inherited === "" ? 0 : Number.parseInt(inherited, 10);
  return {
    ...Object.fromEntries([...countKeys, countKey].map((name) => [name, String(count + 1)])),
    [`GIT_CONFIG_KEY_${count}`]: key,
    [`GIT_CONFIG_VALUE_${count}`]: value,
  };
};

/**
 * A project can contain a fake bare repository whose config runs commands such as `core.fsmonitor`.
 * Require `--git-dir` or `GIT_DIR` to open bare repositories; Git before 2.38 ignores this setting.
 */
export const explicitBareRepositoryEnv = (env: NodeJS.ProcessEnv, platform: NodeJS.Platform) =>
  gitConfigEnv(env, "safe.bareRepository", "explicit", platform);

/**
 * Runs a read-only git query, such as which files .gitignore hides. Undefined when git is missing,
 * fails to start or times out: folders that are not repositories simply have no ignored files.
 */
export const runGitQuery = Effect.fn("WorkspaceEntries.runGitQuery")(function* (input: {
  readonly args: ReadonlyArray<string>;
  readonly cwd: string;
  readonly stdin?: string;
  readonly timeoutMs: number;
  readonly maxOutputBytes: number;
}) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const platform = yield* HostProcess.Platform;
  const result = yield* runner
    .run({
      command: "git",
      args: input.args,
      cwd: input.cwd,
      ...(input.stdin === undefined ? {} : { stdin: input.stdin }),
      env: explicitBareRepositoryEnv(process.env, platform),
      timeout: input.timeoutMs,
      maxOutputBytes: input.maxOutputBytes,
      outputMode: "truncate",
      truncatedMarker: "",
      timeoutBehavior: "error",
    })
    .pipe(Effect.orElseSucceed(() => undefined));
  return result === undefined || result.code === null
    ? undefined
    : { exitCode: Number(result.code), stdout: result.stdout };
});
