import type {
  EnvironmentId,
  LearningKnowledgeView,
  LearningProposition,
  ProjectId,
} from "@aprende/contracts";
import type { EnvironmentProject } from "@aprende/client-runtime/state/shell";
import { useAtomValue } from "@effect/atom-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { flushSync } from "react-dom";

import { isElectron } from "~/env";
import { useLiveRefresh } from "~/hooks/useLiveRefresh";
import { useEnvironmentQuery } from "~/state/query";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { serverEnvironment } from "~/state/server";
import { useProjects } from "~/state/entities";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { defaultPracticeProjectId, propositionMatches } from "./knowledge.logic";
import { usePracticeSession } from "./usePracticeSession";

const ALL_SUBJECTS = "all";
const propositionElementId = (id: string) => `knowledge-${id}`;

export function KnowledgePage() {
  const environmentId = useAtomValue(primaryEnvironmentIdAtom);
  const query = useEnvironmentQuery(
    environmentId === null
      ? null
      : serverEnvironment.learningKnowledge({ environmentId, input: {} }),
  );
  useLiveRefresh(environmentId === null ? null : query.refresh, { key: "knowledge" });

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <span className="text-sm font-medium text-foreground">Knowledge</span>
        </WorkspacePageHeader>
        {environmentId !== null && query.data !== null ? (
          <KnowledgeList environmentId={environmentId} knowledge={query.data} />
        ) : (
          <p className="px-6 py-4 text-muted-foreground text-sm">{query.error ?? "Loading…"}</p>
        )}
      </div>
    </SidebarInset>
  );
}

function KnowledgeList(props: {
  readonly environmentId: EnvironmentId;
  readonly knowledge: LearningKnowledgeView;
}) {
  const { propositions, chains, sessions } = props.knowledge;
  const projects = useProjects().filter(
    (project) => project.environmentId === props.environmentId && !project.archivedAt,
  );
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState<string>(ALL_SUBJECTS);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  if (propositions.length === 0) {
    return (
      <Empty className="flex-1">
        <EmptyHeader>
          <EmptyTitle>Nothing here yet</EmptyTitle>
          <EmptyDescription>
            As the tutor teaches, each session adds the ideas you learned here, with the reasoning
            that connects them.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const sessionsById = new Map(sessions.map((session) => [session.threadId, session]));
  const propositionsById = new Map(propositions.map((entry) => [entry.id, entry]));
  const subjects = projects.filter((project) =>
    sessions.some((session) => session.projectId === project.id),
  );
  const visible = propositions.filter(
    (proposition) =>
      propositionMatches(proposition, search) &&
      (subject === ALL_SUBJECTS ||
        proposition.sourceThreadIds.some(
          (threadId) => sessionsById.get(threadId)?.projectId === subject,
        )),
  );

  const toggle = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const reveal = (id: string) => {
    flushSync(() => {
      setSearch("");
      setSubject(ALL_SUBJECTS);
    });
    const element = document.getElementById(propositionElementId(id));
    element?.scrollIntoView({ block: "center" });
    element?.focus({ preventScroll: true });
  };

  const selection = propositions.filter((proposition) => selected.has(proposition.id));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3 sm:px-6">
        <Input
          aria-label="Search knowledge"
          className="max-w-sm flex-1"
          placeholder="Search what you've learned"
          size="sm"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {subjects.length > 1 ? (
          <Select
            value={subject}
            onValueChange={(value) => {
              if (value !== null) setSubject(value);
            }}
          >
            <SelectTrigger aria-label="Subject" className="w-44" size="sm">
              <SelectValue>
                {subject === ALL_SUBJECTS
                  ? "All subjects"
                  : subjects.find((project) => project.id === subject)?.title}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              <SelectItem value={ALL_SUBJECTS}>All subjects</SelectItem>
              {subjects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.title}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        ) : null}
      </div>
      {selection.length > 0 ? (
        <PracticeBar
          key={[...selected].join(",")}
          selection={selection}
          projects={projects}
          defaultProjectId={defaultPracticeProjectId(selection, sessions)}
          onClear={() => setSelected(new Set())}
        />
      ) : null}
      <div className="scrollbar-gutter-both min-h-0 flex-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="px-6 py-4 text-muted-foreground text-sm">No propositions match.</p>
        ) : (
          <ul className="mx-auto flex max-w-3xl flex-col divide-y divide-border px-4 sm:px-6">
            {visible.map((proposition) => (
              <PropositionRow
                key={proposition.id}
                environmentId={props.environmentId}
                proposition={proposition}
                chains={chains.filter((chain) => chain.conclusion === proposition.id)}
                propositionsById={propositionsById}
                sessionsById={sessionsById}
                checked={selected.has(proposition.id)}
                onCheckedChange={(checked) => toggle(proposition.id, checked)}
                onReveal={reveal}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PropositionRow(props: {
  readonly environmentId: EnvironmentId;
  readonly proposition: LearningProposition;
  readonly chains: LearningKnowledgeView["chains"];
  readonly propositionsById: ReadonlyMap<string, LearningProposition>;
  readonly sessionsById: ReadonlyMap<string, LearningKnowledgeView["sessions"][number]>;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
  readonly onReveal: (id: string) => void;
}) {
  const { proposition } = props;
  const taughtIn = proposition.sourceThreadIds.flatMap((threadId) => {
    const session = props.sessionsById.get(threadId);
    return session === undefined ? [] : [session];
  });
  return (
    <li
      id={propositionElementId(proposition.id)}
      tabIndex={-1}
      className="flex gap-3 py-4 outline-none focus-visible:bg-accent/40"
    >
      <Checkbox
        aria-label={`Select ${proposition.name}`}
        className="mt-0.5"
        checked={props.checked}
        onCheckedChange={(checked) => props.onCheckedChange(checked)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
        <span className="font-medium text-foreground">{proposition.name}</span>
        <p className="text-foreground/90">{proposition.statement}</p>
        {props.chains.map((chain) => (
          <p key={chain.id} className="text-muted-foreground">
            Follows from{" "}
            {chain.premises.map((premiseId, index) => (
              <span key={premiseId}>
                {index > 0 ? (index === chain.premises.length - 1 ? " and " : ", ") : null}
                <button
                  type="button"
                  className="text-foreground underline underline-offset-2 hover:text-primary"
                  onClick={() => props.onReveal(premiseId)}
                >
                  {props.propositionsById.get(premiseId)?.name ?? premiseId}
                </button>
              </span>
            ))}
          </p>
        ))}
        {taughtIn.length > 0 ? (
          <p className="text-muted-foreground text-xs">
            Taught in{" "}
            {taughtIn.map((session, index) => (
              <span key={session.threadId}>
                {index > 0 ? ", " : null}
                <Link
                  className="underline underline-offset-2 hover:text-foreground"
                  to="/$environmentId/$threadId"
                  params={{ environmentId: props.environmentId, threadId: session.threadId }}
                >
                  {session.title}
                </Link>
              </span>
            ))}
          </p>
        ) : null}
      </div>
    </li>
  );
}

function PracticeBar(props: {
  readonly selection: ReadonlyArray<LearningProposition>;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly defaultProjectId: ProjectId | null;
  readonly onClear: () => void;
}) {
  const [projectId, setProjectId] = useState(
    props.defaultProjectId ?? props.projects[0]?.id ?? null,
  );
  const [starting, setStarting] = useState(false);
  const startPractice = usePracticeSession();
  const project = props.projects.find((candidate) => candidate.id === projectId);

  const practice = async () => {
    if (project === undefined) return;
    setStarting(true);
    const started = await startPractice(project, props.selection);
    setStarting(false);
    if (started) props.onClear();
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-4 py-2 sm:px-6">
      <span className="text-sm">{props.selection.length} selected</span>
      {props.projects.length > 1 ? (
        <Select
          value={projectId ?? ""}
          onValueChange={(value) => {
            if (value) setProjectId(value as ProjectId);
          }}
        >
          <SelectTrigger aria-label="Practice in subject" className="w-44" size="sm">
            <SelectValue>{project?.title ?? "Pick a subject"}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            {props.projects.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.title}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      ) : null}
      <Button
        size="sm"
        disabled={starting || project === undefined}
        onClick={() => void practice()}
      >
        {starting ? "Starting…" : "Practice"}
      </Button>
      <Button size="sm" variant="ghost" disabled={starting} onClick={props.onClear}>
        Clear
      </Button>
    </div>
  );
}
