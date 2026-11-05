import {
  AcpRegistryDriver,
  type AcpRegistryDriverEnv,
} from "@aprende/provider-acp-registry/server";
import { ClaudeDriver, type ClaudeDriverEnv } from "./Drivers/ClaudeDriver.ts";
import { CodexDriver, type CodexDriverEnv } from "./Drivers/CodexDriver.ts";
import type {
  AnyProviderDriver,
  ProviderUsageReaderEnv,
} from "@aprende/provider-core/server/driver";

export type BuiltInDriversEnv = AcpRegistryDriverEnv | ClaudeDriverEnv | CodexDriverEnv;

export const BUILT_IN_DRIVERS: ReadonlyArray<AnyProviderDriver<BuiltInDriversEnv>> = [
  CodexDriver,
  ClaudeDriver,
  AcpRegistryDriver,
];

export type BuiltInUsageReadersEnv =
  | ProviderUsageReaderEnv<typeof ClaudeDriver>
  | ProviderUsageReaderEnv<typeof CodexDriver>;

/** Order matters: aggregation keeps the first duplicate record. */
export const BUILT_IN_USAGE_DRIVERS: ReadonlyArray<
  AnyProviderDriver<BuiltInDriversEnv, BuiltInUsageReadersEnv>
> = [ClaudeDriver, CodexDriver];
