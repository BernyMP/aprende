import type {
  LearnerReturnCadence,
  LearningProblemOutcome,
  LearningReview,
} from "@aprende/contracts";
import * as DateTime from "effect/DateTime";

// Leitner boxes: each box doubles the wait, starting from how often the learner comes back.
const BASE_DAYS: Record<LearnerReturnCadence, number> = {
  daily: 1,
  fewTimesAWeek: 2,
  weekly: 7,
  occasionally: 14,
};
const MAX_INTERVAL_DAYS = 180;
const DAY_MS = 24 * 60 * 60 * 1000;

const intervalDays = (box: number, cadence: LearnerReturnCadence | undefined) =>
  Math.min(BASE_DAYS[cadence ?? "daily"] * 2 ** box, MAX_INTERVAL_DAYS);

export interface ReviewRow {
  readonly box: number;
  readonly lastReviewedAt: string | null;
  readonly snoozedUntil: string | null;
}

/** A proposition with no row has never been reviewed: box 0, counted from when it was taught. */
export const NEW_REVIEW: ReviewRow = { box: 0, lastReviewedAt: null, snoozedUntil: null };

/** Computed on read, so a new return cadence applies to every proposition at once. */
export function reviewView(input: {
  readonly propositionId: string;
  readonly createdAt: string;
  readonly row: ReviewRow;
  readonly cadence: LearnerReturnCadence | undefined;
  readonly nowMs: number;
}): LearningReview {
  const { row } = input;
  const from = Date.parse(row.lastReviewedAt ?? input.createdAt);
  const scheduled = from + intervalDays(row.box, input.cadence) * DAY_MS;
  const snoozed =
    row.snoozedUntil === null ? Number.NEGATIVE_INFINITY : Date.parse(row.snoozedUntil);
  const dueAt = Math.max(scheduled, snoozed);
  return {
    propositionId: input.propositionId,
    box: row.box,
    dueAt: DateTime.formatIso(DateTime.makeUnsafe(dueAt)),
    due: dueAt <= input.nowMs,
    lastReviewedAt: row.lastReviewedAt,
    snoozedUntil: row.snoozedUntil,
  };
}

/**
 * The next review state after a practice problem on this proposition, or null for no change.
 * Moving up needs a clean solve on a due review, so practicing early or retesting in the same
 * session cannot skip boxes. A miss drops to box 0, unless the problem combined several
 * propositions and it is unknown which one failed.
 */
export function nextReview(input: {
  readonly row: ReviewRow;
  readonly due: boolean;
  readonly outcome: LearningProblemOutcome;
  readonly hintsUsed: number;
  readonly retest: boolean;
  readonly targetCount: number;
  readonly now: string;
}): ReviewRow | null {
  const reviewed = (box: number): ReviewRow => ({
    box,
    lastReviewedAt: input.now,
    snoozedUntil: null,
  });
  if (input.outcome === "missed") return input.targetCount === 1 ? reviewed(0) : null;
  if (!input.due) return null;
  const clean = input.outcome === "solved" && input.hintsUsed === 0 && !input.retest;
  return reviewed(clean ? input.row.box + 1 : input.row.box);
}
