import type { LearningKnowledgeSession, LearningProposition, ProjectId } from "@aprende/contracts";

/** Every word must appear in the name or statement, as `graph_search` matches. */
export function propositionMatches(proposition: LearningProposition, query: string): boolean {
  const haystack = `${proposition.name} ${proposition.statement}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

/** The tutor prompt tells the tutor to find these with graph_search and start posing problems. */
export function buildPracticeMessage(
  propositions: ReadonlyArray<Pick<LearningProposition, "id" | "name" | "statement">>,
): string {
  const lines = propositions.map(
    (proposition) =>
      `- ${proposition.id}: ${oneLine(proposition.name)}: ${oneLine(proposition.statement)}`,
  );
  return ["Let's practice these propositions:", "", ...lines].join("\n");
}

/** The subject of the newest session that taught any of the propositions. */
export function defaultPracticeProjectId(
  propositions: ReadonlyArray<Pick<LearningProposition, "sourceThreadIds">>,
  sessions: ReadonlyArray<LearningKnowledgeSession>,
): ProjectId | null {
  const sourceIds = new Set(propositions.flatMap((proposition) => proposition.sourceThreadIds));
  let newest: LearningKnowledgeSession | null = null;
  for (const session of sessions) {
    if (!sourceIds.has(session.threadId)) continue;
    if (newest === null || session.createdAt > newest.createdAt) newest = session;
  }
  return newest?.projectId ?? null;
}
