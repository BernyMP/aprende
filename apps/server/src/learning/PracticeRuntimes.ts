import * as HostProcess from "@aprende/shared/HostProcess";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";

const UV_VERSION = "0.13.7";
const PYTHON_VERSION = "3.14";
const DOWNLOAD_TIMEOUT = Duration.minutes(10);
const INSTALL_TIMEOUT = Duration.minutes(10);

interface UvArchive {
  readonly file: string;
  readonly sha256: string;
}

/** Keyed by Node's platform and architecture. Each sha256 is from the `.sha256` file uv publishes beside the archive. */
export type UvArchives = Readonly<Record<string, UvArchive>>;

// The musl builds are static, so one archive runs on every Linux.
const UV_ARCHIVES: UvArchives = {
  "darwin-arm64": {
    file: "uv-aarch64-apple-darwin.tar.gz",
    sha256: "81b811b57e4624df7ed3aac148e0359100d9962f3d9dce00aec533dc2e086731",
  },
  "darwin-x64": {
    file: "uv-x86_64-apple-darwin.tar.gz",
    sha256: "20c47e4c1f630b8abaff8c291fa9b9aa300fef92c4fbff95adf198b55287cda7",
  },
  "linux-x64": {
    file: "uv-x86_64-unknown-linux-musl.tar.gz",
    sha256: "287491da03f2a785c70fa75b13e1f849918c2f2b5415fe84876b8214eeb792f9",
  },
  "linux-arm64": {
    file: "uv-aarch64-unknown-linux-musl.tar.gz",
    sha256: "2d3ec076a0c4c0e8250bb6418c44080828b544f1a3be0b6e46adf9fb6923de45",
  },
};

export class PracticeRuntimeError extends Schema.TaggedError<PracticeRuntimeError>()(
  "PracticeRuntimeError",
  {
    step: Schema.Literals(["download", "verify", "unpack", "install"]),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `aprende could not set up Python (the ${this.step} step failed). Check your internet connection, then try again.`;
  }
}

/** The languages aprende brings, so practice needs nothing installed. Windows uses what the learner has. */
export class PracticeRuntimes extends Context.Service<
  PracticeRuntimes,
  {
    /** Variables that put aprende's `node` and `python3` first on a practice process's PATH. */
    readonly env: Effect.Effect<NodeJS.ProcessEnv>;
    /** Waits for Python, downloading it the first time. Overlapping calls share one download. */
    readonly python: Effect.Effect<void, PracticeRuntimeError>;
    /** Starts the Python download without waiting for it. */
    readonly warmPython: Effect.Effect<void>;
    /** Whether a practice process would not find this program: aprende does not bring it and it is not installed. */
    readonly isMissing: (program: string) => Effect.Effect<boolean>;
  }
>()("aprende/learning/PracticeRuntimes") {}

const shellWord = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

const make = Effect.fn("PracticeRuntimes.make")(function* (archives: UvArchives) {
  const platform = yield* HostProcess.Platform;
  if (platform === "win32")
    return PracticeRuntimes.of({
      env: Effect.succeed({}),
      python: Effect.void,
      warmPython: Effect.void,
      isMissing: Effect.fn("PracticeRuntimes.isMissing")(() => Effect.succeed(false)),
    });

  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;
  const processRunner = yield* ProcessRunner.ProcessRunner;
  const { baseDir } = yield* ServerConfig;
  const hostEnv = yield* HostProcess.Environment;
  const executable = yield* HostProcess.ExecutablePath;
  const standalone = yield* HostProcess.IsExecutable;
  const archive = archives[`${platform}-${yield* HostProcess.Architecture}`];
  const scope = yield* Effect.scope;
  const root = path.join(baseDir, "runtimes");
  const bin = path.join(root, "bin");
  const uvDir = path.join(root, `uv-${UV_VERSION}`);
  const readyMarker = path.join(root, "python-ready");
  const readyText = `uv ${UV_VERSION}, python ${PYTHON_VERSION}`;

  const writeNodeShim = Effect.gen(function* () {
    const shim = path.join(bin, "node");
    // A standalone aprende executable runs its own CLI, not scripts, so it cannot stand in for node.
    if (standalone) return yield* fileSystem.remove(shim, { force: true });
    const text = [
      "#!/bin/sh",
      // The desktop app runs this server on Electron, which acts as Node only with this set.
      "export ELECTRON_RUN_AS_NODE=1",
      `exec ${shellWord(executable)} "$@"`,
      "",
    ].join("\n");
    const current = yield* fileSystem.readFileString(shim).pipe(Effect.orElseSucceed(() => ""));
    if (current === text) return;
    yield* fileSystem.makeDirectory(bin, { recursive: true });
    // Renamed into place, so a shell never runs a half-written shim.
    const staged = `${shim}.new`;
    yield* fileSystem.writeFileString(staged, text);
    yield* fileSystem.chmod(staged, 0o755);
    yield* fileSystem.rename(staged, shim);
  }).pipe(Effect.ignore({ log: true, message: "Could not write the practice node shim." }));
  // Read on every use: the desktop app fills in the login shell's PATH after the server starts.
  const env = writeNodeShim.pipe(
    Effect.map((): NodeJS.ProcessEnv => ({ PATH: `${bin}:${hostEnv["PATH"] || "/usr/bin:/bin"}` })),
  );

  const installUv = Effect.fn("PracticeRuntimes.installUv")(function* (archive: UvArchive) {
    const uv = path.join(uvDir, "uv");
    if (yield* fileSystem.exists(uv).pipe(Effect.orElseSucceed(() => false))) return uv;
    const response = yield* http
      .execute(
        HttpClientRequest.get(
          `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${archive.file}`,
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap((ok) => ok.arrayBuffer),
        Effect.timeout(DOWNLOAD_TIMEOUT),
        Effect.mapError((cause) => new PracticeRuntimeError({ step: "download", cause })),
      );
    const bytes = new Uint8Array(response);
    const digest = yield* Effect.tryPromise({
      try: () => crypto.subtle.digest("SHA-256", bytes),
      catch: (cause) => new PracticeRuntimeError({ step: "verify", cause }),
    });
    if (Hex.encode(new Uint8Array(digest)) !== archive.sha256)
      return yield* new PracticeRuntimeError({ step: "verify" });
    yield* Effect.gen(function* () {
      yield* fileSystem.makeDirectory(root, { recursive: true });
      const staging = yield* fileSystem.makeTempDirectory({ directory: root, prefix: ".uv-" });
      yield* Effect.gen(function* () {
        const archivePath = path.join(staging, archive.file);
        yield* fileSystem.writeFile(archivePath, bytes);
        // The archive holds one folder; stripping it leaves the executable at <staging>/uv.
        const unpacked = yield* processRunner.run({
          command: "tar",
          args: ["-xzf", archivePath, "-C", staging, "--strip-components=1"],
          timeout: INSTALL_TIMEOUT,
        });
        if (unpacked.code !== 0) return yield* new PracticeRuntimeError({ step: "unpack" });
        yield* fileSystem.remove(archivePath);
        yield* fileSystem.remove(uvDir, { recursive: true, force: true });
        yield* fileSystem.rename(staging, uvDir);
      }).pipe(
        Effect.onError(() =>
          fileSystem.remove(staging, { recursive: true, force: true }).pipe(Effect.ignore),
        ),
      );
    }).pipe(
      Effect.mapError((cause) =>
        cause._tag === "PracticeRuntimeError"
          ? cause
          : new PracticeRuntimeError({ step: "unpack", cause }),
      ),
    );
    return uv;
  });

  const installPython = Effect.fn("PracticeRuntimes.installPython")(function* (archive: UvArchive) {
    const python = path.join(bin, "python3");
    const marked = yield* fileSystem
      .readFileString(readyMarker)
      .pipe(Effect.orElseSucceed(() => ""));
    if (
      marked === readyText &&
      (yield* fileSystem.exists(python).pipe(Effect.orElseSucceed(() => false)))
    )
      return;
    const uv = yield* installUv(archive);
    // uv picks the build for this machine, checks its checksum, and links python and python3 into bin.
    const installed = yield* processRunner
      .run({
        command: uv,
        args: [
          "python",
          "install",
          PYTHON_VERSION,
          "--default",
          "--preview-features",
          "python-install-default",
        ],
        env: {
          UV_PYTHON_INSTALL_DIR: path.join(root, "python"),
          UV_PYTHON_BIN_DIR: bin,
          UV_CACHE_DIR: path.join(root, "uv-cache"),
          UV_NO_CONFIG: "1",
          UV_NO_PROGRESS: "1",
        },
        timeout: INSTALL_TIMEOUT,
      })
      .pipe(Effect.mapError((cause) => new PracticeRuntimeError({ step: "install", cause })));
    if (installed.code !== 0) return yield* new PracticeRuntimeError({ step: "install" });
    yield* fileSystem
      .writeFileString(readyMarker, readyText)
      .pipe(Effect.mapError((cause) => new PracticeRuntimeError({ step: "install", cause })));
  });

  // One install at a time; a caller that waited finds the marker and returns.
  const installing = Semaphore.makeUnsafe(1);
  const python =
    archive === undefined ? Effect.void : Semaphore.withPermit(installing, installPython(archive));
  const warmPython = python.pipe(
    Effect.ignore({ log: true, message: "Could not set up Python for practice." }),
    Effect.forkIn(scope),
    Effect.asVoid,
  );

  const isMissing = Effect.fn("PracticeRuntimes.isMissing")(function* (program: string) {
    // Python may still be downloading, so its absence from PATH says nothing yet.
    if (archive !== undefined && /^python3?$/.test(program)) return false;
    const lookup = yield* processRunner
      .run({
        command: "/bin/sh",
        args: ["-c", 'command -v "$1"', "sh", program],
        env: yield* env,
        timeout: "5 seconds",
      })
      .pipe(Effect.result);
    // A lookup that could not run proves nothing, so only a clean "not found" counts.
    return lookup._tag === "Success" && lookup.success.code !== 0;
  });

  return PracticeRuntimes.of({ env, python, warmPython, isMissing });
});

/** For tests, which cannot match the pinned checksums. */
export const layerFor = (archives: UvArchives) => Layer.effect(PracticeRuntimes, make(archives));

export const layer = layerFor(UV_ARCHIVES);
