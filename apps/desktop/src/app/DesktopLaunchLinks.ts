import * as NodeURL from "node:url";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Scope from "effect/Scope";

import { promptLinkAppPath } from "@aprende/shared/promptLinks";
import { readPairingAppLink } from "@aprende/shared/remote";
import * as HostProcess from "@aprende/shared/HostProcess";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopUserData from "./DesktopUserData.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopWebLinks from "./DesktopWebLinks.ts";

export class DesktopLaunchLinks extends Context.Service<
  DesktopLaunchLinks,
  {
    readonly configure: Effect.Effect<
      void,
      never,
      | ElectronApp.ElectronApp
      | ElectronWindow.ElectronWindow
      | DesktopWebLinks.DesktopWebLinks
      | Scope.Scope
    >;
  }
>()("@aprende/desktop/app/DesktopLaunchLinks") {}

/** @public */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const electronApp = yield* ElectronApp.ElectronApp;

  // Runs before Electron is ready, so userData is set before anything reads it.
  const userDataPath = yield* DesktopUserData.resolveUserDataPath(environment);
  yield* electronApp.setPath("userData", userDataPath);

  // Interrupt before runtime construction because quit is asynchronous.
  if (!(yield* electronApp.requestSingleInstanceLock)) {
    yield* electronApp.quit;
    return yield* Effect.interrupt;
  }

  const pendingSecondInstances: Array<readonly string[]> = [];
  let handleSecondInstance = (argv: readonly string[]) => {
    pendingSecondInstances.push(argv);
  };
  yield* electronApp.on("second-instance", (_event: unknown, argv: readonly string[]) => {
    handleSecondInstance(argv);
  });
  // macOS hands a launch link to open-url, which can fire before configure runs.
  const pendingOpenUrls: Array<string> = [];
  let handleOpenUrl = (url: string) => {
    pendingOpenUrls.push(url);
    return true;
  };
  yield* electronApp.on("open-url", (event: { preventDefault: () => void }, url: string) => {
    if (handleOpenUrl(url)) event.preventDefault();
  });

  return DesktopLaunchLinks.of({
    configure: Effect.gen(function* () {
      const electronApp = yield* ElectronApp.ElectronApp;
      const electronWindow = yield* ElectronWindow.ElectronWindow;
      const webLinks = yield* DesktopWebLinks.DesktopWebLinks;
      const context = yield* Effect.context<ElectronWindow.ElectronWindow>();
      const runPromise = Effect.runPromiseWith(context);

      const openAppLink = (value: string | undefined) => {
        if (!value || (promptLinkAppPath(value) === null && readPairingAppLink(value) === null))
          return false;
        void runPromise(webLinks.receive(value));
        return true;
      };
      const args = yield* HostProcess.Arguments;
      args.some(openAppLink);
      const openWebLink = (url: string) => {
        if (!DesktopWebLinks.isWebLink(url)) return false;
        void runPromise(webLinks.receive(url));
        return true;
      };
      handleOpenUrl = (url) => openWebLink(url) || openAppLink(url);
      for (const url of pendingOpenUrls.splice(0)) handleOpenUrl(url);
      yield* electronApp.on("open-file", (event: { preventDefault: () => void }, path: string) => {
        if (!DesktopWebLinks.isWebPageFile(path)) return;
        event.preventDefault();
        void runPromise(webLinks.receive(NodeURL.pathToFileURL(path).href));
      });
      handleSecondInstance = (argv) => {
        if (argv?.some(openAppLink)) return;
        void runPromise(
          Effect.gen(function* () {
            const mainWindow = yield* electronWindow.currentMainOrFirst;
            if (Option.isSome(mainWindow)) yield* electronWindow.reveal(mainWindow.value);
          }),
        );
      };
      for (const argv of pendingSecondInstances.splice(0)) handleSecondInstance(argv);
    }).pipe(Effect.withSpan("desktop.launchLinks.configure")),
  });
});

export const layer = Layer.effect(DesktopLaunchLinks, make);
