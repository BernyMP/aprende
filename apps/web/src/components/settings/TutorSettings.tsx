import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, LearningTutorPrompt } from "@t3tools/contracts";
import { useState } from "react";

import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

export function TutorSettingsPanel() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const query = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.tutorPrompt({ environmentId, input: {} }),
  );
  return (
    <SettingsPageContainer>
      <SettingsSection title="Tutor prompt" id="tutor-prompt">
        <div className="flex flex-col gap-3 px-3 sm:px-4">
          <p className="text-muted-foreground text-sm">
            These instructions tell the tutor how to teach. Claude receives them as its system
            prompt and Codex as developer instructions. Changes apply to sessions started or resumed
            after you save.
          </p>
          {environmentId === null || query.data === null ? (
            <p className="text-muted-foreground text-sm">{query.error ?? "Loading…"}</p>
          ) : (
            <TutorPromptEditor
              key={`${query.data.isDefault}:${query.data.prompt.length}`}
              environmentId={environmentId}
              current={query.data}
              onSaved={query.refresh}
            />
          )}
        </div>
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function TutorPromptEditor(props: {
  readonly environmentId: EnvironmentId;
  readonly current: LearningTutorPrompt;
  readonly onSaved: () => void;
}) {
  const [draft, setDraft] = useState(props.current.prompt);
  const [saving, setSaving] = useState(false);
  const save = useAtomCommand(serverEnvironment.setTutorPrompt, { label: "save tutor prompt" });

  const write = async (prompt: string | null) => {
    setSaving(true);
    const result = await save({ environmentId: props.environmentId, input: { prompt } });
    setSaving(false);
    if (result._tag === "Success") props.onSaved();
  };

  return (
    <>
      <Textarea
        aria-label="Tutor prompt"
        size={24}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={saving || draft === props.current.prompt}
          onClick={() => void write(draft)}
        >
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={saving || props.current.isDefault}
          onClick={() => void write(null)}
        >
          Restore default
        </Button>
        <span className="text-muted-foreground text-xs">
          {props.current.isDefault ? "Using the default prompt." : "Using your edited prompt."}
        </span>
      </div>
    </>
  );
}
