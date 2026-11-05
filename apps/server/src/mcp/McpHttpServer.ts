import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Sink from "effect/Sink";
import * as Stream from "effect/Stream";
import type * as Types from "effect/Types";
import { AiError, McpProtocol, McpSchema, McpServer, Tool, Toolkit } from "effect/ai";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { OrchestratorMcpFailure, ProviderInteractionMode, RuntimeMode } from "@aprende/contracts";

import packageJson from "../../package.json" with { type: "json" };
import { parseBearerToken } from "../auth/EnvironmentAuth.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as HtmlRender from "../htmlRender/HtmlRender.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import { advertisedJsonSchema } from "./advertisedJsonSchema.ts";
import * as McpInvocationContext from "./McpInvocationContext.ts";
import * as McpToolAccess from "./McpToolAccess.ts";
import * as OrchestratorMcpService from "./OrchestratorMcpService.ts";
import { ProjectToolkit } from "./toolkits/project/tools.ts";
import * as ProjectHandlers from "./toolkits/project/handlers.ts";
import { AttachmentToolkit } from "./toolkits/attachment/tools.ts";
import * as AttachmentHandlers from "./toolkits/attachment/handlers.ts";
import { ThreadToolkit } from "./toolkits/thread/tools.ts";
import * as ThreadHandlers from "./toolkits/thread/handlers.ts";
import * as ThreadMetadataMcpService from "./ThreadMetadataMcpService.ts";
import * as McpSessionRegistry from "./McpSessionRegistry.ts";
import * as OrchestratorHandlers from "./toolkits/orchestrator/handlers.ts";
import { OrchestratorToolkit } from "./toolkits/orchestrator/tools.ts";
import * as HtmlHandlers from "./toolkits/html/handlers.ts";
import { HtmlPreviewTool, HtmlPreviewToolkit, HtmlRenderToolkit } from "./toolkits/html/tools.ts";
import * as ThreadCommandExecutor from "../orchestration-v2/ThreadCommandExecutor.ts";
import { EnvironmentToolkit } from "./toolkits/environment/tools.ts";
import * as EnvironmentHandlers from "./toolkits/environment/handlers.ts";
import * as LearnHandlers from "./toolkits/learn/handlers.ts";
import { LearnToolkit } from "./toolkits/learn/tools.ts";
import { requestUrl } from "../requestUrl.ts";

const mcpResourceMetadataUrl = (request: HttpServerRequest.HttpServerRequest) =>
  requestUrl(request).pipe(
    Option.map((url) => `${url.origin}/.well-known/oauth-protected-resource/mcp`),
  );

/** Launched agents cannot open OAuth browsers; OAuth would mint credentials outliving their session. */
const unauthorized = (input: {
  readonly request: HttpServerRequest.HttpServerRequest;
  readonly presentedToken: boolean;
  readonly offerOAuth: boolean;
}) => {
  const metadataUrl = input.offerOAuth
    ? Option.getOrUndefined(mcpResourceMetadataUrl(input.request))
    : undefined;
  const challenge = [
    "Bearer",
    [
      ...(metadataUrl === undefined ? [] : [`resource_metadata="${metadataUrl}"`]),
      ...(input.presentedToken ? ['error="invalid_token"'] : []),
    ].join(", "),
  ]
    .filter((part) => part.length > 0)
    .join(" ");
  return HttpServerResponse.jsonUnsafe(
    {
      error: "invalid_mcp_credential",
      message: "A valid aprende MCP credential is required.",
    },
    {
      status: 401,
      headers: {
        "cache-control": "no-store",
        "www-authenticate": challenge,
      },
    },
  );
};

export class McpClientAuthenticator extends Context.Service<
  McpClientAuthenticator,
  {
    readonly authenticate: (
      request: HttpServerRequest.HttpServerRequest,
    ) => Effect.Effect<McpInvocationContext.McpInvocationScope | undefined>;
  }
>()("aprende/mcp/McpHttpServer/McpClientAuthenticator") {}

type AuthenticatedHttpEffect = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  McpInvocationContext.McpInvocationContext
>;

type McpAuthMiddleware = (
  httpEffect: AuthenticatedHttpEffect,
) => Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  Types.unhandled,
  HttpServerRequest.HttpServerRequest
>;

const normalizeMcpHttpResponse = (
  response: HttpServerResponse.HttpServerResponse,
): HttpServerResponse.HttpServerResponse => {
  const bodyIsEmpty =
    response.body._tag === "Empty" ||
    (response.body._tag === "Uint8Array" && response.body.contentLength === 0) ||
    (response.body._tag === "Raw" && response.body.contentLength === 0);
  return response.status === 200 && bodyIsEmpty
    ? HttpServerResponse.setStatus(response, 202)
    : response;
};

// Session tokens are `<payload>.<signature>`; registry tokens are a bare base64url secret.
const looksLikeProviderToken = (token: string) => token.length > 0 && !token.includes(".");

const decodeModeLimit = Schema.decodeUnknownOption(
  Schema.Struct({ runtimeMode: RuntimeMode, interactionMode: ProviderInteractionMode }),
);
const parseModeLimit = (value: string) => {
  const [runtimeMode, interactionMode, ...rest] = value.trim().split("/");
  return rest.length === 0 ? decodeModeLimit({ runtimeMode, interactionMode }) : Option.none();
};

const invalidModeLimit = HttpServerResponse.jsonUnsafe(
  {
    error: "invalid_mode_limit",
    message: "T3-Mode-Limit must be <runtimeMode>/<interactionMode>, e.g. auto/default.",
  },
  { status: 400, headers: { "cache-control": "no-store" } },
);

/** Applies a client's requested mode limit; undefined when the header is malformed. */
const withModeLimit = (
  invocation: McpInvocationContext.McpInvocationScope,
  request: HttpServerRequest.HttpServerRequest,
): McpInvocationContext.McpInvocationScope | undefined => {
  const header = request.headers[McpInvocationContext.MODE_LIMIT_HEADER];
  if (header === undefined || invocation.client === undefined) return invocation;
  const limit = parseModeLimit(header);
  return Option.isNone(limit)
    ? undefined
    : { ...invocation, client: { ...invocation.client, narrowedTo: limit.value } };
};

const makeMcpAuthMiddleware = Effect.gen(function* () {
  const registry = yield* McpSessionRegistry.McpSessionRegistry;
  const clients = yield* Effect.serviceOption(McpClientAuthenticator);
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const runtimeModeCeiling = serverSettings.managedPolicy?.limits?.maxRuntimeMode;
  return Effect.fn("McpHttpServer.authenticateRequest")(function* (httpEffect) {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const authorization = request.headers.authorization;
    const token = parseBearerToken(request) ?? "";
    const invocation =
      (yield* registry.resolve(token)) ??
      (Option.isSome(clients) && token.length > 0
        ? yield* clients.value.authenticate(request)
        : undefined);
    if (!invocation) {
      yield* Effect.logWarning("rejected MCP request with an unusable credential", {
        reason:
          authorization === undefined
            ? "missing_authorization_header"
            : authorization.split(" ", 1)[0]?.toLowerCase() !== "bearer"
              ? "unsupported_scheme"
              : token.length === 0
                ? "missing_bearer_token"
                : "unknown_or_expired_token",
      });
      return unauthorized({
        request,
        presentedToken: token.length > 0,
        offerOAuth: Option.isSome(clients) && !looksLikeProviderToken(token),
      });
    }
    const asked = withModeLimit(invocation, request);
    if (asked === undefined) return invalidModeLimit;
    const limited = McpInvocationContext.withRuntimeModeCeiling(asked, runtimeModeCeiling);
    return yield* httpEffect.pipe(
      Effect.provideService(McpInvocationContext.McpInvocationContext, limited),
      Effect.map(normalizeMcpHttpResponse),
    );
  }) satisfies McpAuthMiddleware;
}).pipe(Effect.withSpan("McpHttpServer.makeAuthMiddleware"));

const layerMcpAuthMiddleware = HttpRouter.middleware<{
  provides: McpInvocationContext.McpInvocationContext;
}>()(makeMcpAuthMiddleware).layer;

/** Decode with the advertised JSON codec, which permits null for optional fields that the raw schema rejects. */
const decodeAsAdvertised = <Tools extends Record<string, Tool.Any>>(
  toolkit: Toolkit.Toolkit<Tools>,
): Toolkit.Toolkit<Tools> =>
  Toolkit.make(
    ...Object.values(toolkit.tools).map((tool) =>
      tool.setParameters(Schema.toCodecJson(tool.parametersSchema)),
    ),
  ) as unknown as Toolkit.Toolkit<Tools>;

interface ImageToolResult {
  readonly screenshot: {
    readonly mimeType: "image/png";
    readonly data: string;
    readonly width: number;
    readonly height: number;
  };
  readonly [key: string]: unknown;
}

/** Expose only undescribed failures' tags; remote messages may contain renderer or device output. */
const imageToolFailure =
  <E>(toolName: string, operation: string, failureText: string | ((error: E) => string)) =>
  (cause: Cause.Cause<E>) => {
    if (Cause.hasInterrupts(cause) || cause.reasons.some(Cause.isDieReason)) {
      return Effect.failCause(cause).pipe(Effect.orDie);
    }
    const failures = cause.reasons.filter(Cause.isFailReason);
    const firstFailure = failures[0]?.error;
    const errorTag =
      typeof firstFailure === "object" &&
      firstFailure !== null &&
      "_tag" in firstFailure &&
      typeof firstFailure._tag === "string"
        ? firstFailure._tag
        : `${toolName}Error`;
    const message =
      typeof failureText === "string" || failures[0] === undefined
        ? undefined
        : failureText(failures[0].error);
    const result = new McpSchema.CallToolResult({
      isError: true,
      structuredContent: {
        error: {
          _tag: errorTag,
          operation,
          failureCount: failures.length,
          ...(message === undefined ? {} : { message }),
        },
      },
      // Some clients show only the text content and others only structuredContent, so both carry it.
      content: [
        {
          type: "text",
          text: typeof failureText === "string" ? failureText : (message ?? `${toolName} failed.`),
        },
      ],
    });
    return Effect.logWarning(`${toolName} failed`, {
      operation,
      errorTag,
      failureCount: failures.length,
    }).pipe(Effect.as(result));
  };

/**
 * `McpServer.toolkit` serializes every result as JSON text, which is the wrong
 * shape for a screenshot: the model needs image content.
 */
const registerImageTool = Effect.fn("McpHttpServer.registerImageTool")(function* <
  T extends Tool.Any,
  E,
  R,
>(
  tool: T,
  handle: (payload: Tool.Parameters<T>) => Effect.Effect<{ readonly encodedResult: unknown }, E, R>,
  provide: (
    effect: Effect.Effect<{ readonly encodedResult: unknown }, E, R>,
  ) => Effect.Effect<
    { readonly encodedResult: unknown },
    E,
    McpInvocationContext.McpInvocationContext
  >,
  operation: string,
  failureText: string | ((error: E) => string),
) {
  const server = yield* McpServer.McpServer;
  yield* server.addTool({
    tool: new McpSchema.Tool({
      name: tool.name,
      description: Tool.getDescription(tool),
      inputSchema: advertisedJsonSchema(tool),
      annotations: {
        ...Context.getOption(tool.annotations, Tool.Title).pipe(
          Option.map((title) => ({ title })),
          Option.getOrUndefined,
        ),
        readOnlyHint: Context.get(tool.annotations, Tool.Readonly),
        destructiveHint: Context.get(tool.annotations, Tool.Destructive),
        idempotentHint: Context.get(tool.annotations, Tool.Idempotent),
        openWorldHint: Context.get(tool.annotations, Tool.OpenWorld),
      },
    }),
    annotations: tool.annotations,
    handle: (payload) =>
      Effect.withFiber((fiber) => {
        const invocation = Context.getUnsafe(
          fiber.context,
          McpInvocationContext.McpInvocationContext,
        );
        return provide(handle(payload as Tool.Parameters<T>)).pipe(
          Effect.provideService(McpInvocationContext.McpInvocationContext, invocation),
          Effect.matchCauseEffect({
            onFailure: imageToolFailure(tool.name, operation, failureText),
            onSuccess: ({ encodedResult }) => {
              const { screenshot, ...rest } = encodedResult as ImageToolResult;
              const includeImage =
                (payload as { readonly includeImage?: boolean } | undefined)?.includeImage !==
                false;
              const metadata = {
                ...rest,
                screenshot: {
                  mimeType: screenshot.mimeType,
                  width: screenshot.width,
                  height: screenshot.height,
                },
              };
              return Effect.succeed(
                new McpSchema.CallToolResult({
                  isError: false,
                  structuredContent: metadata,
                  content: [
                    { type: "text", text: JSON.stringify(metadata) },
                    ...(includeImage
                      ? [
                          {
                            type: "image" as const,
                            data: new Uint8Array(Buffer.from(screenshot.data, "base64")),
                            mimeType: screenshot.mimeType,
                          },
                        ]
                      : []),
                  ],
                }),
              );
            },
          }),
        );
      }),
  });
});

const isOrchestratorMcpFailure = Schema.is(OrchestratorMcpFailure);

const registerHtmlPreview = Effect.fn("McpHttpServer.registerHtmlPreview")(function* () {
  const htmlRender = yield* HtmlRender.HtmlRender;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const built = yield* decodeAsAdvertised(HtmlPreviewToolkit);
  yield* registerImageTool(
    HtmlPreviewTool,
    (payload) =>
      built
        .handle("html_preview", payload)
        .pipe(Stream.unwrap, Stream.run(Sink.last()), Effect.flatMap(Effect.fromOption)),
    (effect) =>
      effect.pipe(
        Effect.provideService(HtmlRender.HtmlRender, htmlRender),
        Effect.provideService(ThreadManagementService.ThreadManagementService, threads),
      ),
    "preview",

    (error) =>
      isOrchestratorMcpFailure(error) || AiError.isAiError(error)
        ? error.message
        : "HTML preview failed.",
  );
});

/** `McpServer.registerToolkit` advertises the full codec schema; agents get the compact one. */
const withAdvertisedSchemas = Effect.fn("McpHttpServer.withAdvertisedSchemas")(function* <
  Tools extends Record<string, Tool.Any>,
  A,
  E,
  R,
>(toolkit: Toolkit.Toolkit<Tools>, registration: Effect.Effect<A, E, R>) {
  const server = yield* McpServer.McpServer;
  const tools: Record<string, Tool.Any> = toolkit.tools;
  const advertisingServer = McpServer.McpServer.of({
    ...server,
    addTool: Effect.fn("McpServer.addTool")(function (options) {
      const tool = tools[options.tool.name];
      return server.addTool(
        tool === undefined
          ? options
          : {
              ...options,
              tool: new McpSchema.Tool({
                ...options.tool,
                inputSchema: advertisedJsonSchema(tool),
              }),
            },
      );
    }),
  });
  return yield* registration.pipe(Effect.provideService(McpServer.McpServer, advertisingServer));
});

/** Hands each call the services its registration was built with; the request's own still win. */
const provideRegistrationServices = <Services>() =>
  McpServer.middleware<{ provides: Services }>()(
    Effect.map(
      Effect.context<Services>(),
      (services) => (effect) =>
        Effect.updateContext(effect, (request: Context.Context<never>) =>
          Context.merge(services, request),
        ),
    ),
  );

/**
 * Tools declare their handler services as request-level dependencies. Those
 * built with the server are provided here; `McpInvocationContext` is left to
 * the transport, whose auth middleware resolves it per request.
 */
export const toolkitRegistration = <Tools extends Record<string, Tool.Any>, EX, RX>(
  toolkit: Toolkit.Toolkit<Tools>,
  handlers: McpToolAccess.HandlersLayer<Tools, EX, RX>,
) =>
  Layer.effectDiscard(
    withAdvertisedSchemas(toolkit, McpServer.registerToolkit(decodeAsAdvertised(toolkit))),
  ).pipe(
    Layer.provide(
      provideRegistrationServices<
        Exclude<Tool.Requirements<Tools[keyof Tools]>, McpInvocationContext.McpInvocationContext>
      >().layer,
    ),
    Layer.provide(McpServer.McpServer.layer),
    Layer.provide(McpToolAccess.HandlersLayer.layer(handlers)),
  );

const imageToolRegistration = <Tools extends Record<string, Tool.Any>, A, E, R, EX, RX>(
  register: Effect.Effect<A, E, R>,
  handlers: McpToolAccess.HandlersLayer<Tools, EX, RX>,
) => Layer.effectDiscard(register).pipe(Layer.provide(McpToolAccess.HandlersLayer.layer(handlers)));

export const layerHtmlToolkit = Layer.mergeAll(
  toolkitRegistration(HtmlRenderToolkit, HtmlHandlers.layerRender),
  imageToolRegistration(registerHtmlPreview(), HtmlHandlers.layerPreview),
).pipe(Layer.provide(HtmlRender.layer));

export const layerOrchestratorToolkit = toolkitRegistration(
  OrchestratorToolkit,
  OrchestratorHandlers.layer,
).pipe(Layer.provide(OrchestratorMcpService.layer), Layer.provide(ThreadMetadataMcpService.layer));

export const layerThreadToolkit = toolkitRegistration(ThreadToolkit, ThreadHandlers.layer);

const layerEnvironmentToolkit = toolkitRegistration(
  EnvironmentToolkit,
  EnvironmentHandlers.layer,
).pipe(Layer.provide(ThreadCommandExecutor.layer));

const layerProjectRegistration = toolkitRegistration(ProjectToolkit, ProjectHandlers.layer);

export const layerAttachmentToolkit = toolkitRegistration(
  AttachmentToolkit,
  AttachmentHandlers.layer,
);

/**
 * `McpServer` for in-process calls, which provide `McpInvocationContext`
 * around `callTool` as the auth middleware does for each /mcp request.
 */
export const layerInProcessMcpServer = McpServer.middleware<{
  provides: McpInvocationContext.McpInvocationContext;
}>()(
  (effect) =>
    Effect.flatMap(
      Effect.serviceOption(McpInvocationContext.McpInvocationContext),
      Option.match({
        onNone: () => Effect.die("Provide McpInvocationContext around the in-process MCP call."),
        onSome: (scope) =>
          Effect.provideService(effect, McpInvocationContext.McpInvocationContext, scope),
      }),
    ),
  { global: true },
).pipe(Layer.provideMerge(McpServer.McpServer.layer));

export const layerMcpTransport = <RA, RE, RR>(registrations: Layer.Layer<RA, RE, RR>) =>
  McpServer.layerHttp({
    name: "aprende",
    version: packageJson.version,
    path: "/mcp",
    protocols: [McpProtocol.v2025_06_18],
    allowSessionTermination: true,
    registrations,
  }).pipe(Layer.provide(layerMcpAuthMiddleware));

const layerLearnToolkit = toolkitRegistration(LearnToolkit, LearnHandlers.layer);

/**
 * Every tool the MCP server advertises. The CLI and outside agents use all of them; tutor
 * sessions see only TUTOR_MCP_TOOL_NAMES. AgentContextBudget.test.ts measures that subset.
 */
export const layerTools = Layer.mergeAll(
  layerOrchestratorToolkit,
  layerThreadToolkit,
  layerAttachmentToolkit,
  layerProjectRegistration,
  layerEnvironmentToolkit,
  layerHtmlToolkit,
  layerLearnToolkit,
);

export const layer = layerMcpTransport(layerTools);
