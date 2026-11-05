import { ProjectId, type ProjectScript } from "@aprende/contracts";

import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

export interface ProjectSetupScriptRunnerResultNoScript {
  readonly status: "no-script";
}

export interface ProjectSetupScriptRunnerResultStarted {
  readonly status: "started";
  readonly scriptId: string;
  readonly scriptName: string;
  readonly scriptCommand: string;
  readonly terminalId: string;
  readonly cwd: string;
  readonly async: boolean;
  /** Null exit code means the terminal exited or closed before the sentinel. */
  readonly completion?: Effect.Effect<ProjectSetupScriptCompletion>;
}

export interface ProjectSetupScriptCompletion {
  readonly exitCode: number | null;
  readonly durationMs: number;
}

export interface ProjectSetupScriptOutputLine {
  readonly line: string;
}

/**
 * A thread a link below full access started does not run this project's setup
 * script: the script is the user's own code, and such a link only grants T3's
 * tools (see `mcp/linkOrigin.ts`).
 */
export interface ProjectSetupScriptRunnerResultSkippedForLink {
  readonly status: "skipped-for-link";
}

export type ProjectSetupScriptRunnerResult =
  | ProjectSetupScriptRunnerResultNoScript
  | ProjectSetupScriptRunnerResultSkippedForLink
  | ProjectSetupScriptRunnerResultStarted;

export interface ProjectSetupScriptRunnerInput {
  readonly threadId: string;
  readonly projectId?: string;
  readonly projectCwd?: string;
  readonly worktreePath: string;
  readonly trigger?: "setup" | "settle";
  readonly project?: {
    readonly id: ProjectId;
    readonly workspaceRoot: string;
    readonly scripts: ReadonlyArray<ProjectScript>;
  };
  readonly observeCompletion?: {
    readonly onOutputLine?: (line: string) => Effect.Effect<void>;
  };
}

export class ProjectSetupScriptOperationError extends Schema.TaggedError<ProjectSetupScriptOperationError>()(
  "ProjectSetupScriptOperationError",
  {
    threadId: Schema.String,
    projectId: Schema.optional(Schema.String),
    projectCwd: Schema.optional(Schema.String),
    worktreePath: Schema.String,
    operation: Schema.Literals(["readThread", "resolveProject", "readSettings", "openTerminal"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Project setup script operation '${this.operation}' failed for thread '${this.threadId}' in '${this.worktreePath}'.`;
  }
}

export class ProjectSetupScriptProjectNotFoundError extends Schema.TaggedError<ProjectSetupScriptProjectNotFoundError>()(
  "ProjectSetupScriptProjectNotFoundError",
  {
    threadId: Schema.String,
    projectId: Schema.optional(Schema.String),
    projectCwd: Schema.optional(Schema.String),
    worktreePath: Schema.String,
  },
) {
  override get message(): string {
    return `Project was not found for setup script execution for thread '${this.threadId}' in '${this.worktreePath}'.`;
  }
}

export class ProjectSetupScriptUnsupportedShellError extends Schema.TaggedError<ProjectSetupScriptUnsupportedShellError>()(
  "ProjectSetupScriptUnsupportedShellError",
  { shell: Schema.String },
) {
  override get message(): string {
    return "Project script completion is not supported in cmd.exe. Install PowerShell and retry.";
  }
}

export const ProjectSetupScriptRunnerError = Schema.Union([
  ProjectSetupScriptOperationError,
  ProjectSetupScriptProjectNotFoundError,
  ProjectSetupScriptUnsupportedShellError,
]);
export type ProjectSetupScriptRunnerError = typeof ProjectSetupScriptRunnerError.Type;

export class ProjectSetupScriptRunner extends Context.Service<
  ProjectSetupScriptRunner,
  {
    readonly runForThread: (
      input: ProjectSetupScriptRunnerInput,
    ) => Effect.Effect<ProjectSetupScriptRunnerResult, ProjectSetupScriptRunnerError>;
  }
>()("aprende/project/ProjectSetupScriptRunner") {}

// Scripts ran in the terminal manager, which is gone; none runs until worktree launches go too.
export const layer = Layer.succeed(
  ProjectSetupScriptRunner,
  ProjectSetupScriptRunner.of({
    runForThread: Effect.fn("ProjectSetupScriptRunner.runForThread")(() =>
      Effect.succeed({ status: "no-script" } as const),
    ),
  }),
);
