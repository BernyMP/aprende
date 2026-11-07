import type {
  LearningKnowledgeSession,
  LearningProposition,
  LearningReview,
  ProjectId,
} from "@aprende/contracts";

/** Every word must appear in the name or statement, as `graph_search` matches. */
export function propositionMatches(proposition: LearningProposition, query: string): boolean {
  const haystack = `${proposition.name} ${proposition.statement}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((word) => haystack.includes(word));
}

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

export type PracticeKind = "practice" | "review";

/** How many due propositions one review session takes on. */
export const REVIEW_BATCH_SIZE = 10;

/**
 * The tutor prompt tells the tutor to find these with graph_search and pose problems naming
 * their ids, so a review's outcomes reach the schedule.
 */
export function buildPracticeMessage(
  propositions: ReadonlyArray<Pick<LearningProposition, "id" | "name" | "statement">>,
  kind: PracticeKind = "practice",
): string {
  const lines = propositions.map(
    (proposition) =>
      `- ${proposition.id}: ${oneLine(proposition.name)}: ${oneLine(proposition.statement)}`,
  );
  const opening =
    kind === "review"
      ? "Let's review these propositions, which are due for review:"
      : "Let's practice these propositions:";
  return [opening, "", ...lines].join("\n");
}

/** Due propositions, the most overdue first. */
export function dueForReview(
  propositions: ReadonlyArray<LearningProposition>,
  reviews: ReadonlyArray<LearningReview>,
): ReadonlyArray<LearningProposition> {
  const byId = new Map(propositions.map((proposition) => [proposition.id, proposition]));
  return reviews
    .filter((review) => review.due)
    .toSorted((left, right) => left.dueAt.localeCompare(right.dueAt))
    .flatMap((review) => {
      const proposition = byId.get(review.propositionId);
      return proposition === undefined ? [] : [proposition];
    });
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
