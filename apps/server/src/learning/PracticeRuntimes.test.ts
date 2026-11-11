import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as HostProcess from "@aprende/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Hex from "effect/encoding/Hex";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/http";
import { ChildProcessSpawner } from "effect/process";

import { ServerConfig } from "../config.ts";
import * as ProcessRunner from "../processRunner.ts";
import * as PracticeRuntimes from "./PracticeRuntimes.ts";

interface Spawned {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly options: { readonly env?: NodeJS.ProcessEnv };
}

const exited = (code: number) =>
  ChildProcessSpawner.makeHandle({
    pid: ChildProcessSpawner.ProcessId(1),
    exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(code)),
    isRunning: Effect.succeed(false),
    kill: () => Effect.void,
    unref: Effect.succeed(Effect.void),
    stdin: Sink.drain,
    stdout: Stream.empty,
    stderr: Stream.empty,
    all: Stream.empty,
    getInputFd: () => Sink.drain,
    getOutputFd: () => Stream.empty,
  });

const archiveBytes = new TextEncoder().encode("a uv archive");

const sha256 = (bytes: Uint8Array) =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", bytes)).pipe(
    Effect.map((digest) => Hex.encode(new Uint8Array(digest))),
  );

const host = (env: NodeJS.ProcessEnv, executable = "/opt/aprende/aprende", standalone = false) =>
  Layer.mergeAll(
    Layer.succeed(HostProcess.IsExecutable)(standalone),
    Layer.succeed(HostProcess.Platform)("linux"),
    Layer.succeed(HostProcess.Architecture)("x64"),
    Layer.succeed(HostProcess.Environment)(env),
    Layer.succeed(HostProcess.ExecutablePath)(executable),
  );

it.effect("downloads uv once behind its checksum and installs Python with it", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "aprende-runtimes-" });
    const bin = path.join(baseDir, "runtimes", "bin");
    const offline = yield* Ref.make(true);
    const requests = yield* Ref.make<ReadonlyArray<string>>([]);
    const spawned = yield* Ref.make<ReadonlyArray<Spawned>>([]);
    const layerWith = (sha: string) =>
      PracticeRuntimes.layerFor({
        "linux-x64": { file: "uv-test.tar.gz", sha256: sha },
      }).pipe(
        Layer.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make((request) =>
              Effect.gen(function* () {
                yield* Ref.update(requests, (all) => [...all, request.url]);
                return HttpClientResponse.fromWeb(
                  request,
                  (yield* Ref.get(offline))
                    ? new Response(null, { status: 503 })
                    : new Response(archiveBytes),
                );
              }),
            ),
          ),
        ),
        Layer.provide(
          ProcessRunner.layer.pipe(
            Layer.provide(
              Layer.succeed(
                ChildProcessSpawner.ChildProcessSpawner,
                ChildProcessSpawner.make((command) =>
                  Effect.gen(function* () {
                    const run = command as unknown as Spawned;
                    yield* Ref.update(spawned, (all) => [...all, run]);
                    // The real uv links python3 into the bin folder.
                    if (path.basename(run.command) === "uv") {
                      yield* fileSystem.makeDirectory(bin, { recursive: true });
                      yield* fileSystem.writeFileString(path.join(bin, "python3"), "");
                    }
                    return exited(0);
                  }).pipe(Effect.orDie),
                ),
              ),
            ),
          ),
        ),
        Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
        Layer.provide(host({ PATH: "/usr/bin" })),
      );
    const good = yield* sha256(archiveBytes);

    yield* Effect.gen(function* () {
      const runtimes = yield* PracticeRuntimes.PracticeRuntimes;
      assert.equal((yield* Effect.flip(runtimes.python)).step, "download");

      // A failed download is not remembered, and overlapping waits share the next one.
      yield* Ref.set(offline, false);
      yield* Effect.all([runtimes.python, runtimes.python], { concurrency: "unbounded" });
      assert.equal((yield* Ref.get(requests)).length, 2);
      const [unpack, install] = yield* Ref.get(spawned);
      assert.equal(unpack!.command, "tar");
      assert.equal(path.dirname(install!.command), path.join(baseDir, "runtimes", "uv-0.13.7"));
      assert.deepEqual(install!.args.slice(0, 4), ["python", "install", "3.14", "--default"]);
      assert.equal(install!.options.env?.["UV_PYTHON_BIN_DIR"], bin);
      assert.equal((yield* Ref.get(spawned)).length, 2);

      // A learner who deletes the folder gets it back on the next use, without a restart.
      yield* fileSystem.remove(path.join(baseDir, "runtimes"), { recursive: true });
      yield* runtimes.python;
      assert.equal((yield* Ref.get(requests)).length, 3);
    }).pipe(Effect.provide(layerWith(good)));

    // A restarted server finds the finished install and downloads nothing.
    yield* Effect.gen(function* () {
      yield* (yield* PracticeRuntimes.PracticeRuntimes).python;
      assert.equal((yield* Ref.get(requests)).length, 3);
      assert.equal((yield* Ref.get(spawned)).length, 4);
    }).pipe(Effect.provide(layerWith(good)));

    // An archive that does not match its pinned checksum is never unpacked or run.
    yield* fileSystem.remove(path.join(baseDir, "runtimes"), { recursive: true });
    yield* Effect.gen(function* () {
      const failure = yield* Effect.flip((yield* PracticeRuntimes.PracticeRuntimes).python);
      assert.equal(failure.step, "verify");
      assert.equal((yield* Ref.get(spawned)).length, 4);
    }).pipe(Effect.provide(layerWith("0".repeat(64))));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.live("puts a node on PATH that runs the server's own runtime as Node", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const processRunner = yield* ProcessRunner.ProcessRunner;
    // Stands in for the app's executable, at a path a shell would split or misquote.
    const appDir = path.join(
      yield* fileSystem.makeTempDirectoryScoped({ prefix: "aprende-app-" }),
      "it's here",
    );
    const executable = path.join(appDir, "aprende");
    yield* fileSystem.makeDirectory(appDir);
    yield* fileSystem.writeFileString(
      executable,
      '#!/bin/sh\necho "node=$ELECTRON_RUN_AS_NODE args=$*"\n',
    );
    yield* fileSystem.chmod(executable, 0o755);

    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "aprende-runtimes-" });
    const shim = path.join(baseDir, "runtimes", "bin", "node");
    const run = (standalone: boolean, hostEnv: NodeJS.ProcessEnv = { PATH: "/bin" }) =>
      Effect.gen(function* () {
        const runtimes = yield* PracticeRuntimes.PracticeRuntimes;
        assert.equal((yield* runtimes.env)["PATH"], `${path.dirname(shim)}:/bin`);
        // The desktop app learns the login shell's PATH after the server has started.
        hostEnv["PATH"] = "/usr/bin:/bin";
        const env = yield* runtimes.env;
        assert.equal(env["PATH"], `${path.dirname(shim)}:/usr/bin:/bin`);
        const result = yield* processRunner.run({
          command: "/bin/sh",
          // By path, so a node the machine has cannot answer for a shim that was not written.
          args: ["-c", '"$0" --test "a b"', shim],
          env: { ELECTRON_RUN_AS_NODE: "", ...env },
        });
        return result.stdout;
      }).pipe(
        Effect.provide(
          PracticeRuntimes.layer.pipe(
            Layer.provide(
              Layer.succeed(
                HttpClient.HttpClient,
                HttpClient.make(() => Effect.die("no request")),
              ),
            ),
            Layer.provide(ServerConfig.layerTest(process.cwd(), baseDir)),
            Layer.provide(host(hostEnv, executable, standalone)),
          ),
        ),
      );

    assert.equal(yield* run(false), "node=1 args=--test a b\n");
    // A standalone executable would run aprende's CLI with the script's arguments, so no shim stays.
    assert.equal(yield* run(true), "");
    assert.isFalse(yield* fileSystem.exists(shim));
  }).pipe(Effect.provide(Layer.provideMerge(ProcessRunner.layer, NodeServices.layer))),
);

it.live("reports a program missing only when neither aprende nor the learner has it", () =>
  Effect.gen(function* () {
    const runtimes = yield* PracticeRuntimes.PracticeRuntimes;
    assert.isTrue(yield* runtimes.isMissing("aprende-no-such-program"));
    assert.isFalse(yield* runtimes.isMissing("sh"));
    assert.isFalse(yield* runtimes.isMissing("node"));
    // Not downloaded yet, and still not missing: aprende brings it before the check runs.
    assert.isFalse(yield* runtimes.isMissing("python3"));
  }).pipe(
    Effect.provide(
      PracticeRuntimes.layer.pipe(
        Layer.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("no request")),
          ),
        ),
        Layer.provide(ProcessRunner.layer),
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "aprende-runtimes-" })),
        // A PATH without Python, as on a computer where nothing is installed.
        Layer.provide(host({ PATH: "/bin" })),
        Layer.provide(NodeServices.layer),
      ),
    ),
  ),
);

it.effect("leaves Windows on what the learner has installed", () =>
  Effect.gen(function* () {
    const runtimes = yield* PracticeRuntimes.PracticeRuntimes;
    assert.deepEqual(yield* runtimes.env, {});
    yield* runtimes.python;
  }).pipe(
    Effect.provide(
      PracticeRuntimes.layer.pipe(
        Layer.provide(Layer.succeed(HostProcess.Platform)("win32")),
        Layer.provide(
          Layer.succeed(
            HttpClient.HttpClient,
            HttpClient.make(() => Effect.die("no request")),
          ),
        ),
        Layer.provide(ProcessRunner.layer),
        Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "aprende-runtimes-" })),
        Layer.provide(NodeServices.layer),
      ),
    ),
  ),
);
