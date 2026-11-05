import { assert, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { CommandId, ProjectId, ThreadId } from "@aprende/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";

import * as ServerConfig from "../config.ts";
import * as RuntimeLayer from "../orchestration-v2/runtimeLayer.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as WorkspacePaths from "../workspace/WorkspacePaths.ts";
import * as ProjectEnrichmentService from "./ProjectEnrichmentService.ts";
import * as ProjectFaviconResolver from "./ProjectFaviconResolver.ts";
import * as ProjectService from "./ProjectService.ts";
import * as RepositoryIdentityResolver from "./RepositoryIdentityResolver.ts";
import * as ManagedProjectFolders from "./ManagedProjectFolders.ts";

const layerEnrichment = ProjectEnrichmentService.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
        resolve: () => Effect.succeed(null),
      }),
      Layer.succeed(ProjectFaviconResolver.ProjectFaviconResolver, {
        invalidate: () => Effect.void,
        resolvePath: () => Effect.succeed(null),
      }),
    ),
  ),
);

interface HarnessOptions {
  readonly fileSystem?: (real: FileSystem.FileSystem) => FileSystem.FileSystem;
  readonly projects?: (
    real: ProjectService.ProjectService["Service"],
  ) => ProjectService.ProjectService["Service"];
}

const layer = (baseDir: string, options?: HarnessOptions) =>
  ManagedProjectFolders.layer.pipe(
    Layer.provide(
      options?.projects === undefined
        ? Layer.empty
        : Layer.effect(
            ProjectService.ProjectService,
            ProjectService.ProjectService.pipe(Effect.map(options.projects)),
          ),
    ),
    Layer.provide(
      options?.fileSystem === undefined
        ? Layer.empty
        : Layer.effect(
            FileSystem.FileSystem,
            FileSystem.FileSystem.pipe(Effect.map(options.fileSystem)),
          ),
    ),
    Layer.provideMerge(RuntimeLayer.layerProjectService),
    Layer.provideMerge(layerEnrichment),
    Layer.provideMerge(WorkspacePaths.layer),
    Layer.provideMerge(SqlitePersistence.layerMemory),
    Layer.provideMerge(ServerSettings.layerTest()),
    Layer.provideMerge(ServerConfig.layerTest(baseDir, baseDir)),
    Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
  );

const withScratch = <A, E>(
  body: (input: {
    readonly baseDir: string;
  }) => Effect.Effect<
    A,
    E,
    | ManagedProjectFolders.ManagedProjectFolders
    | ProjectService.ProjectService
    | NodeServices.NodeServices
    | Scope.Scope
  >,
  options?: HarnessOptions,
) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const baseDir = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-managed-folders-" });
    return yield* body({ baseDir }).pipe(Effect.provide(layer(baseDir, options)));
  }).pipe(Effect.scoped, Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

const requireRoot = Effect.gen(function* () {
  const scratch = yield* ManagedProjectFolders.ManagedProjectFolders;
  return Option.getOrThrow(yield* scratch.scratchRoot);
});

it.effect("creates one Scratch project, even for concurrent first requests", () =>
  withScratch(() =>
    Effect.gen(function* () {
      const scratch = yield* ManagedProjectFolders.ManagedProjectFolders;
      const projects = yield* ProjectService.ProjectService;
      const racers = yield* Effect.all(
        Array.from({ length: 8 }, () => scratch.ensureScratchProject),
        { concurrency: "unbounded" },
      );
      const again = yield* scratch.ensureScratchProject;
      assert.deepEqual(
        new Set(racers.map((result) => result.projectId)),
        new Set([again.projectId]),
      );

      const snapshot = yield* projects.snapshot;
      const root = yield* requireRoot;
      const scratchProjects = snapshot.projects.filter((project) => project.workspaceRoot === root);
      assert.lengthOf(scratchProjects, 1);
      assert.equal(scratchProjects[0]?.title, "No project");
      assert.deepEqual(scratchProjects[0]?.projectIcon, {
        kind: "lucide",
        name: "message-square-dashed",
        color: "gray",
      });
    }),
  ),
);

it.effect("recreates the Scratch folder after it is deleted", () =>
  withScratch(() =>
    Effect.gen(function* () {
      const scratch = yield* ManagedProjectFolders.ManagedProjectFolders;
      const fileSystem = yield* FileSystem.FileSystem;
      const { projectId } = yield* scratch.ensureScratchProject;
      const root = yield* requireRoot;
      yield* fileSystem.remove(root, { recursive: true });

      assert.equal((yield* scratch.ensureScratchProject).projectId, projectId);
      assert.isTrue(yield* fileSystem.exists(root));

      yield* fileSystem.remove(root, { recursive: true });
      const folder = yield* scratch.folderForThread({
        projectId,
        threadId: ThreadId.make("thread-after-delete"),
        text: "Still works",
      });
      assert.isTrue(yield* fileSystem.exists(Option.getOrThrow(folder)));
    }),
  ),
);

it.effect("gives each Scratch thread its own folder, named from its message", () =>
  withScratch(() =>
    Effect.gen(function* () {
      const scratch = yield* ManagedProjectFolders.ManagedProjectFolders;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { projectId } = yield* scratch.ensureScratchProject;
      const root = yield* requireRoot;
      const text = "Convert these PNGs to WebP, please!";
      const first = Option.getOrThrow(
        yield* scratch.folderForThread({
          projectId,
          threadId: ThreadId.make("thread:a:0123456789abcdef"),
          text,
        }),
      );
      const second = Option.getOrThrow(
        yield* scratch.folderForThread({
          projectId,
          threadId: ThreadId.make("thread:b:0123456789abcdef"),
          text,
        }),
      );

      const third = Option.getOrThrow(
        yield* scratch.folderForThread({
          projectId,
          threadId: ThreadId.make("thread:b0123456789abcdef"),
          text,
        }),
      );

      assert.equal(new Set([first, second, third]).size, 3);
      for (const folder of [first, second, third]) {
        assert.equal(path.dirname(folder), root);
        assert.match(path.basename(folder), /^\d{4}-\d{2}-\d{2}-convert-these-pngs-to-webp-/);
        assert.isTrue(yield* fileSystem.exists(folder));
      }

      const pasted = Option.getOrThrow(
        yield* scratch.folderForThread({
          projectId,
          threadId: ThreadId.make("thread-pasted"),
          text: `${"word ".repeat(10_000)}../../etc`,
        }),
      );
      assert.equal(path.dirname(pasted), root);
      assert.isAtMost(path.basename(pasted).length, 80);
    }),
  ),
);

it.effect("leaves threads in other projects alone", () =>
  withScratch(({ baseDir }) =>
    Effect.gen(function* () {
      const scratch = yield* ManagedProjectFolders.ManagedProjectFolders;
      const projects = yield* ProjectService.ProjectService;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const { projectId: scratchId } = yield* scratch.ensureScratchProject;
      const other = yield* projects.create({
        commandId: CommandId.make("command:other"),
        projectId: ProjectId.make("project:other"),
        title: "Other",
        workspaceRoot: path.join(baseDir, "other"),
        createWorkspaceRootIfMissing: true,
      });

      const folder = yield* scratch.folderForThread({
        projectId: other.id,
        threadId: ThreadId.make("thread-other"),
        text: "Hello",
      });
      assert.isTrue(Option.isNone(folder));
      assert.deepEqual(yield* fileSystem.readDirectory(yield* requireRoot), []);
      assert.isTrue(yield* scratch.isScratchProject(scratchId));
      assert.isFalse(yield* scratch.isScratchProject(other.id));
    }),
  ),
);

it.effect("starts a named project as a plain folder, and suffixes a taken name", () =>
  withScratch(({ baseDir }) =>
    Effect.gen(function* () {
      const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
      const projects = yield* ProjectService.ProjectService;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = path.resolve(baseDir, "projects");
      assert.equal(folders.namedProjectsRoot, root);

      const first = yield* folders.createNamedProject({ name: "Pinball Stats" });
      const second = yield* folders.createNamedProject({ name: "pinball stats" });

      assert.equal(first.workspaceRoot, path.join(root, "pinball-stats"));
      assert.equal(second.workspaceRoot, path.join(root, "pinball-stats-2"));
      const project = Option.getOrThrow(yield* projects.getById(first.projectId));
      assert.equal(project.title, "Pinball Stats");
      assert.equal(project.workspaceRoot, first.workspaceRoot);

      const readme = yield* fileSystem.readFileString(path.join(first.workspaceRoot, "README.md"));
      assert.include(readme, "# Pinball Stats");
      assert.include(readme, `src="assets/icon.svg"`);
      const icon = yield* fileSystem.readFileString(
        path.join(first.workspaceRoot, "assets", "icon.svg"),
      );
      assert.include(icon, ">PS</text>");
      assert.isFalse(yield* fileSystem.exists(path.join(first.workspaceRoot, ".git")));
    }),
  ),
);

it.effect("gives concurrent named projects with the same name distinct folders", () =>
  withScratch(() =>
    Effect.gen(function* () {
      const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
      const projects = yield* ProjectService.ProjectService;
      const created = yield* Effect.all(
        Array.from({ length: 4 }, () => folders.createNamedProject({ name: "Race" })),
        { concurrency: "unbounded" },
      );

      assert.equal(new Set(created.map((result) => result.workspaceRoot)).size, 4);
      assert.equal(new Set(created.map((result) => result.projectId)).size, 4);
      const snapshot = yield* projects.snapshot;
      for (const result of created) {
        assert.isTrue(
          snapshot.projects.some((project) => project.workspaceRoot === result.workspaceRoot),
        );
      }
    }),
  ),
);

it.effect("keeps a folder that another project owns when the create conflicts", () =>
  withScratch(({ baseDir }) =>
    Effect.gen(function* () {
      const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
      const projects = yield* ProjectService.ProjectService;
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const taken = path.join(folders.namedProjectsRoot, "taken");
      yield* projects.create({
        commandId: CommandId.make("command:owner"),
        projectId: ProjectId.make("project:owner"),
        title: "Owner",
        workspaceRoot: taken,
        createWorkspaceRootIfMissing: true,
      });
      yield* fileSystem.remove(taken, { recursive: true });

      const failure = yield* Effect.flip(folders.createNamedProject({ name: "Taken" }));

      assert.equal(failure._tag, "NamedProjectCreateError");
      assert.equal(failure.message, "Failed to create the project.");
      assert.isTrue(yield* fileSystem.exists(path.join(taken, "README.md")));
      const owner = yield* projects.getByWorkspaceRoot(taken);
      assert.equal(Option.getOrThrow(owner).id, ProjectId.make("project:owner"));
      assert.deepEqual(yield* fileSystem.readDirectory(path.resolve(baseDir, "projects")), [
        "taken",
      ]);
    }),
  ),
);

it.effect("removes the folder when the project create is rejected for another reason", () =>
  withScratch(
    ({ baseDir }) =>
      Effect.gen(function* () {
        const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        const failure = yield* Effect.flip(folders.createNamedProject({ name: "Rejected" }));

        assert.equal(failure._tag, "NamedProjectCreateError");
        assert.deepEqual(yield* fileSystem.readDirectory(path.resolve(baseDir, "projects")), []);
      }),
    {
      projects: (real) =>
        ProjectService.ProjectService.of({
          ...real,
          create: (input) =>
            Effect.fail(
              new ProjectService.ProjectOperationError({
                operation: "dispatch-project-command",
                projectId: input.projectId,
                cause: "store unavailable",
              }),
            ),
        }),
    },
  ),
);

it.effect("removes the folder when the create is cancelled before the project exists", () =>
  Effect.gen(function* () {
    const scaffolding = yield* Deferred.make<void>();
    yield* withScratch(
      ({ baseDir }) =>
        Effect.gen(function* () {
          const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
          const projects = yield* ProjectService.ProjectService;
          const fileSystem = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;

          const fiber = yield* folders
            .createNamedProject({ name: "Cancelled" })
            .pipe(Effect.forkChild);
          yield* Deferred.await(scaffolding);
          assert.deepEqual(yield* fileSystem.readDirectory(path.resolve(baseDir, "projects")), [
            "cancelled",
          ]);
          yield* Fiber.interrupt(fiber);

          assert.deepEqual(yield* fileSystem.readDirectory(path.resolve(baseDir, "projects")), []);
          assert.deepEqual((yield* projects.snapshot).projects, []);
        }),
      {
        fileSystem: (real) => ({
          ...real,
          writeFileString: (target, ...rest) =>
            target.endsWith("README.md")
              ? Deferred.succeed(scaffolding, undefined).pipe(Effect.andThen(Effect.never))
              : real.writeFileString(target, ...rest),
        }),
      },
    );
  }),
);
