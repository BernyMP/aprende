import type { ElementType } from "react";
import type {
  ChangeRequestTerminology,
  SourceControlDefinition,
} from "@aprende/client-runtime/source-control-clients";
import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { SourceControlIconArtwork } from "./components/SourceControlIconArtwork";

export type { ChangeRequestTerminology } from "@aprende/client-runtime/source-control-clients";

type SourceControlIcon = ElementType<{ className?: string }>;

const SOURCE_CONTROL_ICONS = new WeakMap<SourceControlDefinition, SourceControlIcon>();

/** One component per definition, so a host's icon keeps its identity across renders. */
export function sourceControlIcon(definition: SourceControlDefinition): SourceControlIcon {
  const artwork = definition.icon;
  if (artwork === null) return PullRequestGlyph.pullRequest;
  let Icon = SOURCE_CONTROL_ICONS.get(definition);
  if (Icon === undefined) {
    Icon = (props: { className?: string }) => (
      <SourceControlIconArtwork {...props} icon={artwork} />
    );
    SOURCE_CONTROL_ICONS.set(definition, Icon);
  }
  return Icon;
}

export interface SourceControlPresentation {
  readonly definition: SourceControlDefinition;
  readonly providerName: string;
  readonly terminology: ChangeRequestTerminology;
  readonly Icon: SourceControlIcon;
}
