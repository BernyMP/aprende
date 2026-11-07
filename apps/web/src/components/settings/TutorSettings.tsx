import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  LearnerProfile,
  LearnerProfilePatch,
  LearningTutorPrompt,
} from "@aprende/contracts";
import { LEARNER_INTERESTS_MAX_CHARS, LEARNER_LANGUAGE_MAX_CHARS } from "@aprende/contracts";
import { useState } from "react";

import { useLiveRefresh } from "~/hooks/useLiveRefresh";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { SettingsPageContainer, SettingsRow, SettingsSection } from "./settingsLayout";

const NOT_SET = "unset";

type ChoiceField = "goalKind" | "returnCadence" | "diagrams" | "explanationLength";

const CHOICES: {
  readonly [Field in ChoiceField]: {
    readonly title: string;
    readonly description: string;
    readonly labels: Record<NonNullable<LearnerProfile[Field]>, string>;
  };
} = {
  goalKind: {
    title: "What you're after",
    description: "Shapes the path. The tutor still checks your understanding either way.",
    labels: {
      understanding: "Deep understanding",
      exam: "Preparing for an exam",
      skill: "A skill to use",
      gist: "The gist",
    },
  },
  returnCadence: {
    title: "How often you study",
    description: "Sets how soon ideas come back for review.",
    labels: {
      daily: "Daily",
      fewTimesAWeek: "A few times a week",
      weekly: "Weekly",
      occasionally: "Now and then",
    },
  },
  diagrams: {
    title: "Diagrams",
    description: "How often the tutor draws one.",
    labels: { often: "Often", whenUseful: "When they help", rarely: "Rarely" },
  },
  explanationLength: {
    title: "Explanations",
    description: "Every step still comes with its reason.",
    labels: { brief: "Brief", standard: "Standard", detailed: "Detailed" },
  },
};

export function TutorSettingsPanel() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const query = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.tutorPrompt({ environmentId, input: {} }),
  );
  return (
    <SettingsPageContainer>
      <LearnerProfileSection environmentId={environmentId} />
      <FoldedSettingsSection
        id="tutor-prompt"
        title="Tutor prompt"
        summary={query.data === null ? null : query.data.isDefault ? "Default" : "Edited by you"}
      >
        <div className="flex flex-col gap-3 px-3 py-3 sm:px-4">
          <p className="text-muted-foreground text-sm">
            These instructions tell the tutor how to teach. Claude receives them as its system
            prompt and Codex as developer instructions, followed by your choices above. Most
            preferences belong above; edit this only to change how the tutor teaches. Changes apply
            to sessions started or resumed after you save.
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
      </FoldedSettingsSection>
    </SettingsPageContainer>
  );
}

function LearnerProfileSection(props: { readonly environmentId: EnvironmentId | null }) {
  const { environmentId } = props;
  const query = useEnvironmentQuery(
    environmentId === null ? null : serverEnvironment.learnerProfile({ environmentId, input: {} }),
  );
  const save = useAtomCommand(serverEnvironment.setLearnerProfile, { label: "save preferences" });
  useLiveRefresh(environmentId === null ? null : query.refresh, { key: "learner-profile" });
  const profile = query.data ?? undefined;

  const update = async (patch: LearnerProfilePatch) => {
    if (environmentId === null) return;
    const result = await save({ environmentId, input: patch });
    if (result._tag === "Success") query.refresh();
  };

  return (
    <SettingsSection title="About you" id="learner-profile">
      <p className="px-3 py-3 text-muted-foreground text-sm sm:px-4">
        While the first two are not set, the tutor asks for them in your next session. Changes apply
        to sessions started or resumed after you change them.
      </p>
      {profile === undefined ? (
        <p className="px-3 text-muted-foreground text-sm sm:px-4">{query.error ?? "Loading…"}</p>
      ) : (
        <>
          {(Object.keys(CHOICES) as Array<ChoiceField>).map((field) => (
            <ChoiceRow
              key={field}
              field={field}
              value={profile[field]}
              onChange={(value) => void update({ [field]: value })}
            />
          ))}
          <TextRow
            key={`language:${profile.language ?? ""}`}
            title="Teach in"
            description="Leave empty to be taught in the language you write in."
            placeholder="The language you write in"
            maxLength={LEARNER_LANGUAGE_MAX_CHARS}
            value={profile.language}
            onSave={(value) => void update({ language: value })}
          />
          <TextRow
            key={`interests:${profile.interests ?? ""}`}
            title="Examples from"
            description="Things you care about, for the tutor to draw examples from."
            placeholder="Cycling, cooking, music"
            maxLength={LEARNER_INTERESTS_MAX_CHARS}
            value={profile.interests}
            onSave={(value) => void update({ interests: value })}
          />
        </>
      )}
    </SettingsSection>
  );
}

function ChoiceRow(props: {
  readonly field: ChoiceField;
  readonly value: string | undefined;
  readonly onChange: (value: string | null) => void;
}) {
  const { title, description, labels } = CHOICES[props.field];
  const value = props.value ?? NOT_SET;
  const options = Object.entries(labels) as Array<[string, string]>;
  return (
    <SettingsRow
      title={title}
      description={description}
      control={
        <Select
          value={value}
          onValueChange={(next) => {
            if (next !== null && next !== value) props.onChange(next === NOT_SET ? null : next);
          }}
        >
          <SelectTrigger size="sm" className="w-full sm:w-56" aria-label={title}>
            <SelectValue>{labels[value as keyof typeof labels] ?? "Not set"}</SelectValue>
          </SelectTrigger>
          <SelectPopup align="end" alignItemWithTrigger={false}>
            <SelectItem hideIndicator value={NOT_SET}>
              Not set
            </SelectItem>
            {options.map(([option, label]) => (
              <SelectItem key={option} hideIndicator value={option}>
                {label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      }
    />
  );
}

function TextRow(props: {
  readonly title: string;
  readonly description: string;
  readonly placeholder: string;
  readonly maxLength: number;
  readonly value: string | undefined;
  readonly onSave: (value: string | null) => void;
}) {
  const [draft, setDraft] = useState(props.value ?? "");
  const commit = () => {
    const next = draft.trim();
    if (next !== (props.value ?? "")) props.onSave(next.length === 0 ? null : next);
  };
  return (
    <SettingsRow
      title={props.title}
      description={props.description}
      control={
        <Input
          aria-label={props.title}
          className="w-full sm:w-56"
          size="sm"
          placeholder={props.placeholder}
          maxLength={props.maxLength}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      }
    />
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
