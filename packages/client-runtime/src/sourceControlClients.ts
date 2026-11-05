import { builtInSourceControlDefinitions } from "@aprende/source-control-definitions/registry";
import {
  type SourceControlAppSignIn,
  type SourceControlDefinition,
} from "@aprende/source-control-core/shared/definition";
import type { SourceControlAppAccessInput } from "@aprende/contracts";
import { parseGitRemoteRepository } from "@aprende/shared/git";

export {
  type ChangeRequestLink,
  type ChangeRequestTerminology,
  type HostAccountChoice,
  type HostCredentialSettings,
  type ParsedChangeRequestUrl,
  type ReferenceAutolink,
  type SourceControlAppSignIn,
  type SourceControlDefinition,
  type SourceControlHostCredentials,
  type SourceControlIcon,
} from "@aprende/source-control-core/shared/definition";

export const sourceControlClients = builtInSourceControlDefinitions;

/** A host's change request term where it opens a sentence: "Merge request merged". */
export function capitalizeTerm(term: string): string {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

/** The repository a remote names, when its host has an app sign-in that could reach it. */
export function appSignInTargetForRemote(remoteUrl: string): {
  readonly definition: SourceControlDefinition;
  readonly appSignIn: SourceControlAppSignIn;
  readonly input: SourceControlAppAccessInput;
} | null {
  const parsed = parseGitRemoteRepository(remoteUrl);
  const provider = sourceControlClients.recognizeRemote(remoteUrl);
  const definition = provider ? sourceControlClients.find(provider.kind) : undefined;
  const appSignIn = definition?.credentials?.appSignIn;
  if (parsed === null || definition === undefined || appSignIn === undefined) return null;
  if (!appSignIn.hosts.includes(parsed.host)) return null;
  // The parser lowercases; keep the remote's own casing for display when it names the same path.
  const asWritten = remoteUrl
    .trim()
    .replace(/\.git\/?$/i, "")
    .split(/[/:]/)
    .slice(-2)
    .join("/");
  const repository = asWritten.toLowerCase() === parsed.path ? asWritten : parsed.path;
  return {
    definition,
    appSignIn,
    input: { provider: definition.kind, host: parsed.host, repository },
  };
}
