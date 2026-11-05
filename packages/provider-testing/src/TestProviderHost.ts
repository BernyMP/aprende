import { DEFAULT_SERVER_SETTINGS, type ServerSettings } from "@aprende/contracts";
import * as ProviderHost from "@aprende/provider-core/server/ProviderHost";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

export interface TestProviderHostOptions {
  readonly cwd?: string;
  readonly settings?: ServerSettings;
  readonly runBackgroundWork?: boolean;
}

export class TestProviderHostSettings extends Context.Service<
  TestProviderHostSettings,
  { readonly set: (settings: ServerSettings) => Effect.Effect<void> }
>()("@aprende/provider-testing/TestProviderHost/TestProviderHostSettings") {}

export const layer = (
  options: TestProviderHostOptions = {},
): Layer.Layer<
  ProviderHost.ProviderHost | TestProviderHostSettings,
  never,
  FileSystem.FileSystem | Path.Path
> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fileSystem
        .makeTempDirectoryScoped({ prefix: "t3-provider-host-" })
        .pipe(Effect.orDie);
      const stateDir = path.join(baseDir, "userdata");
      const providerStatusCacheDir = path.join(baseDir, "caches");
      const attachmentsDir = path.join(stateDir, "attachments");
      for (const directory of [stateDir, providerStatusCacheDir, attachmentsDir]) {
        yield* fileSystem.makeDirectory(directory, { recursive: true }).pipe(Effect.orDie);
      }
      const settings = yield* Ref.make(options.settings ?? DEFAULT_SERVER_SETTINGS);
      const host = ProviderHost.ProviderHost.of({
        paths: {
          cwd: options.cwd ?? process.cwd(),
          baseDir,
          stateDir,
          providerStatusCacheDir,
          attachmentsDir,
        },
        settings: {
          get: Ref.get(settings),
          withSnapshot: (use) => Ref.get(settings).pipe(Effect.flatMap(use)),
          changes: Stream.empty,
          subscribe: Effect.succeed(Stream.empty),
        },
        shouldRunBackgroundWork: Effect.fn("ProviderHost.shouldRunBackgroundWork")(function () {
          return Effect.succeed(options.runBackgroundWork ?? true);
        }),
        resolveAttachmentPath: (attachment) => path.join(attachmentsDir, attachment.id),
      });
      return Context.make(ProviderHost.ProviderHost, host).pipe(
        Context.add(TestProviderHostSettings, {
          set: (next) => Ref.set(settings, next),
        }),
      );
    }),
  );
