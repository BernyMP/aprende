import { APP_DISPLAY_NAME, DESKTOP_DOWNLOAD_URL } from "~/branding";
import { isElectron } from "../env";
import { isLocalEnvironmentDisabled } from "../localEnvironment";
import { CommandBlock } from "./CommandBlock";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

/** Home screen for the hosted app before any computer is added. */
export function HostedEmptyState() {
  const localEnvironmentOff = isLocalEnvironmentDisabled();

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              {APP_DISPLAY_NAME}
            </span>
          </div>
        </WorkspacePageHeader>

        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>
              {localEnvironmentOff ? "This computer is off" : "No computer connected"}
            </EmptyTitle>
            <EmptyDescription>
              {localEnvironmentOff
                ? "aprende will restart and run on this computer again."
                : "Your tutor runs on your computer. Start aprende there first."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            {localEnvironmentOff ? (
              <Button
                size="sm"
                onClick={() => void window.desktopBridge?.setLocalEnvironmentEnabled(true)}
              >
                Turn on this computer
              </Button>
            ) : (
              <RunOnComputer command="npx aprende" />
            )}
          </EmptyContent>
        </Empty>
      </div>
    </SidebarInset>
  );
}

function RunOnComputer({ command }: { readonly command: string }) {
  return (
    <>
      <p>Run on your computer:</p>
      <CommandBlock command={command} className="mt-2" />
      <a
        className="mt-2 inline-block text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        href={DESKTOP_DOWNLOAD_URL}
        target="_blank"
        rel="noreferrer noopener"
      >
        Or download the desktop app
      </a>
    </>
  );
}
