import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { resolveAttachmentRelativePath } from "../attachmentPaths.ts";
import { parseAttachmentFileExtension, resolveAttachmentPathById } from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";

export class ResourceCleanupError extends Schema.TaggedError<ResourceCleanupError>()(
  "ResourceCleanupError",
  {
    operation: Schema.Literals(["attachment"]),
    attachmentId: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {}

export class ResourceCleanupService extends Context.Reference<{
  readonly cleanupAttachments: (
    attachmentIds: ReadonlyArray<string>,
  ) => Effect.Effect<void, ResourceCleanupError>;
}>("aprende/orchestration-v2/ResourceCleanupService", {
  defaultValue: () => ({
    cleanupAttachments: () => Effect.void,
  }),
}) {}

export const layer = Layer.effect(
  ResourceCleanupService,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    return {
      cleanupAttachments: Effect.fn("ResourceCleanupService.cleanupAttachments")(function (
        attachmentIds: ReadonlyArray<string>,
      ) {
        return Effect.forEach(
          attachmentIds,
          (attachmentId) => {
            const extension = parseAttachmentFileExtension(attachmentId);
            const path =
              resolveAttachmentPathById({
                attachmentsDir: config.attachmentsDir,
                attachmentId,
              }) ??
              (extension
                ? resolveAttachmentRelativePath({
                    attachmentsDir: config.attachmentsDir,
                    relativePath: `${attachmentId}.${extension}`,
                  })
                : null);
            return path === null
              ? Effect.void
              : fileSystem.remove(path, { force: true }).pipe(
                  Effect.andThen(fileSystem.remove(`${path}.txt`, { force: true })),
                  Effect.mapError(
                    (cause) =>
                      new ResourceCleanupError({ operation: "attachment", attachmentId, cause }),
                  ),
                );
          },
          { discard: true, concurrency: 4 },
        );
      }),
    };
  }),
);
