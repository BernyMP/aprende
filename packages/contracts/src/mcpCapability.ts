import { Schema } from "effect";

import { EnvironmentId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderInstanceId } from "./providerInstance.ts";

export class McpCapabilityUnavailableError extends Schema.TaggedError<McpCapabilityUnavailableError>()(
  "McpCapabilityUnavailableError",
  {
    capability: TrimmedNonEmptyString,
    environmentId: EnvironmentId,
    threadId: Schema.optional(ThreadId),
    providerSessionId: Schema.optional(TrimmedNonEmptyString),
    providerInstanceId: Schema.optional(ProviderInstanceId),
  },
) {
  override get message(): string {
    return `MCP credential does not grant the ${this.capability} capability.`;
  }
}
