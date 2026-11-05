import { scopeProjectRef } from "@aprende/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@aprende/client-runtime/state/runtime";
import { sourceControlClients } from "@aprende/client-runtime/source-control-clients";
import { promptLinkAppPath } from "@aprende/shared/promptLinks";
import { readPairingAppLink, resolveRemotePairingTarget } from "@aprende/shared/remote";
import { useRouter } from "@tanstack/react-router";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/reactivity";
import * as Stream from "effect/Stream";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { requestConfirmDialog } from "../../confirmDialog";
import { openExternalLink } from "../../lib/openExternalLink";
import { connectPairing } from "../../connection/onboarding";
import { isLocalEnvironmentDisabled } from "../../localEnvironment";
import { useClientSettings } from "../../hooks/useSettings";
import { useOpenChangeRequestLink } from "../../lib/openPullRequestLink";
import { appAtomRegistry } from "../../rpc/atomRegistry";
import { resolveThreadRouteTarget } from "../../threadRoutes";
import { readProject, readThreadShell } from "../../state/entities";
import { usePrimaryEnvironment } from "../../state/environments";
import { allReachableShellsLiveAtom } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { stackedThreadToast, toastManager } from "../ui/toast";

/** A link handed over by the OS is a plain click: nothing about it asks for the browser. */
const externalClick = {
  preventDefault() {},
  stopPropagation() {},
  metaKey: false,
  ctrlKey: false,
};

/** Resolves once every reachable environment has reported its projects or settled offline. */
const projectsSettled = (): Promise<void> =>
  Effect.runPromise(
    AtomRegistry.toStream(appAtomRegistry, allReachableShellsLiveAtom).pipe(
      Stream.filter((settled) => settled),
      Stream.runHead,
      Effect.asVoid,
    ),
  );

export function DesktopWebLinkCoordinator() {
  const router = useRouter();
  const primaryEnvironment = usePrimaryEnvironment();
  const openPullRequestsInApp = useClientSettings((settings) => settings.pullRequestLinksOpenInApp);
  const openChangeRequest = useOpenChangeRequestLink();
  const connectPairingEnvironment = useAtomCommand(connectPairing, { reportFailure: false });
  const queueRef = useRef(Promise.resolve());
  const pairedUrlsRef = useRef(new Set<string>());
  const webLinks = window.desktopBridge?.webLinks;
  // A sync IPC read; the setting only changes across a relaunch.
  const [localEnvironmentDisabled] = useState(isLocalEnvironmentDisabled);
  // With Local environment disabled there is no primary to wait for, so links run against the
  // saved remote environments instead of waiting forever.
  const ready =
    webLinks !== undefined &&
    (localEnvironmentDisabled ||
      (primaryEnvironment?.connection.phase === "connected" &&
        primaryEnvironment.serverConfig !== null));

  const reportFailure = (url: string, description = url) =>
    toastManager.add(
      stackedThreadToast({ type: "error", title: "Could not open the link", description }),
    );

  const reportPairingFailure = (error: unknown) =>
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not add backend",
        description: error instanceof Error ? error.message : "Failed to add backend.",
      }),
    );

  // Any page can open a pairing link, so the user confirms the host before its one-time token is spent.
  const pairFromLink = async (pairingUrl: string) => {
    // A repeated click would only ask again and then fail on the spent one-time token.
    if (pairedUrlsRef.current.has(pairingUrl)) return;
    // The origin keeps the scheme visible, so a plain HTTP backend is not mistaken for HTTPS.
    let origin: string;
    try {
      origin = new URL(resolveRemotePairingTarget({ pairingUrl }).httpBaseUrl).origin;
    } catch (error) {
      reportPairingFailure(error);
      return;
    }
    const confirmed = (await requestConfirmDialog(`Add the backend at ${origin}?`)) ?? false;
    if (!confirmed) return;
    const result = await connectPairingEnvironment({ pairingUrl });
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) reportPairingFailure(squashAtomCommandFailure(result));
      return;
    }
    pairedUrlsRef.current.add(pairingUrl);
    toastManager.add({
      type: "success",
      title: "Backend added",
      description: "The environment is saved and will reconnect on app startup.",
    });
  };

  const openInBrowser = async (url: string) => {
    await openExternalLink(url).catch(() => reportFailure(url));
  };

  const openLink = useEffectEvent(async (url: string) => {
    const pairingUrl = readPairingAppLink(url);
    if (pairingUrl !== null) {
      await pairFromLink(pairingUrl);
      return;
    }
    const appPath = promptLinkAppPath(url);
    if (appPath !== null) {
      await router.navigate({ href: appPath });
      return;
    }
    const routeParams = router.state.matches.at(-1)?.params ?? {};
    const routeTarget = resolveThreadRouteTarget(routeParams);
    const activeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : undefined;
    const activeThread = activeThreadRef ? readThreadShell(activeThreadRef) : null;
    const activeProject =
      activeThread && activeThreadRef
        ? readProject(scopeProjectRef(activeThreadRef.environmentId, activeThread.projectId))
        : null;
    const commitThreadRef =
      activeThread &&
      sourceControlClients.parseCommitUrl(url, activeProject?.repositoryIdentity?.provider) !== null
        ? activeThreadRef
        : undefined;
    if (openChangeRequest(externalClick, url, commitThreadRef)) return;
    await openInBrowser(url);
  });

  const receiveLink = useEffectEvent((url: string) => {
    // A connected server publishes its config before its project snapshot, so a source control
    // link delivered at launch would miss its project and fall through to the browser. Hold
    // those links until discovery settles; an ordinary link never waits for it.
    const hold =
      openPullRequestsInApp &&
      (sourceControlClients.parseChangeRequestUrl(url) !== null ||
        sourceControlClients.parseCommitUrl(url) !== null)
        ? projectsSettled()
        : Promise.resolve();
    void hold.then(() => {
      queueRef.current = queueRef.current.then(() => openLink(url)).catch(() => undefined);
    });
  });

  // oxlint-disable-next-line aprende/no-unreasoned-state-sync -- subscribes to desktop web link opens over the bridge and marks the renderer ready
  useEffect(() => {
    if (!ready || webLinks === undefined) return;
    let subscribed = true;
    const unsubscribe = webLinks.onOpen(receiveLink);
    queueMicrotask(() => {
      if (subscribed) void webLinks.setReady(true).catch(() => undefined);
    });
    return () => {
      subscribed = false;
      void webLinks.setReady(false).catch(() => undefined);
      unsubscribe();
    };
  }, [ready, webLinks]);

  return null;
}
