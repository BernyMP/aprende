import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";

import { NEW_REVIEW, nextReview, reviewView } from "./reviewSchedule.ts";

const now = "2026-11-06T12:00:00.000Z";

describe("reviewView", () => {
  it.each([
    {
      name: "a new proposition is due one base interval after it was taught",
      createdAt: "2026-11-05T12:00:00.000Z",
      row: NEW_REVIEW,
      cadence: undefined,
      dueAt: "2026-11-06T00:00:00.000Z",
      due: true,
    },
    {
      name: "it is due all day, even before the hour it was taught",
      createdAt: "2026-11-05T21:00:00.000Z",
      row: NEW_REVIEW,
      cadence: undefined,
      dueAt: "2026-11-06T00:00:00.000Z",
      due: true,
    },
    {
      name: "the day is the learner's own",
      createdAt: "2026-11-05T03:00:00.000Z",
      row: NEW_REVIEW,
      cadence: undefined,
      zone: DateTime.zoneMakeOffset(-8 * 60 * 60 * 1000),
      dueAt: "2026-11-05T08:00:00.000Z",
      due: true,
    },
    {
      name: "a weekly learner waits a week before the first review",
      createdAt: "2026-11-05T12:00:00.000Z",
      row: NEW_REVIEW,
      cadence: "weekly" as const,
      dueAt: "2026-11-12T00:00:00.000Z",
      due: false,
    },
    {
      name: "each box doubles the wait from the last review",
      createdAt: "2026-01-01T00:00:00.000Z",
      row: { box: 3, lastReviewedAt: "2026-11-01T12:00:00.000Z", snoozedUntil: null },
      cadence: "fewTimesAWeek" as const,
      dueAt: "2026-11-17T00:00:00.000Z",
      due: false,
    },
    {
      name: "the wait is capped at 180 days",
      createdAt: "2026-01-01T00:00:00.000Z",
      row: { box: 12, lastReviewedAt: "2026-11-01T12:00:00.000Z", snoozedUntil: null },
      cadence: "weekly" as const,
      dueAt: "2027-04-30T00:00:00.000Z",
      due: false,
    },
    {
      name: "a snooze pushes a due proposition out",
      createdAt: "2026-10-01T00:00:00.000Z",
      row: { box: 0, lastReviewedAt: null, snoozedUntil: "2026-11-13T12:00:00.000Z" },
      cadence: undefined,
      dueAt: "2026-11-13T00:00:00.000Z",
      due: false,
    },
  ])("$name", ({ createdAt, row, cadence, dueAt, due, ...rest }) => {
    const zone = "zone" in rest ? rest.zone : DateTime.zoneMakeOffset(0);
    const view = reviewView({
      propositionId: "p-1",
      createdAt,
      row,
      cadence,
      nowMs: Date.parse(now),
      zone,
    });
    expect({ dueAt: view.dueAt, due: view.due }).toEqual({ dueAt, due });
  });
});

describe("nextReview", () => {
  const row = { box: 2, lastReviewedAt: "2026-11-01T12:00:00.000Z", snoozedUntil: null };
  const reviewed = (box: number) => ({ box, lastReviewedAt: now, snoozedUntil: null });
  const base = { row, due: true, hintsUsed: 0, retest: false, targetCount: 1, now };

  it.each([
    { name: "a clean solve on a due review moves up", outcome: "solved", expected: reviewed(3) },
    {
      name: "a solve before it was due changes nothing",
      outcome: "solved",
      due: false,
      expected: null,
    },
    {
      name: "a solve with hints stays in its box",
      outcome: "solved",
      hintsUsed: 1,
      expected: reviewed(2),
    },
    {
      name: "a right but unsure solve stays in its box",
      outcome: "solved",
      retest: true,
      expected: reviewed(2),
    },
    { name: "a partial answer stays in its box", outcome: "partial", expected: reviewed(2) },
    { name: "a miss drops to box 0", outcome: "missed", expected: reviewed(0) },
    {
      name: "a miss drops to box 0 even before it was due",
      outcome: "missed",
      due: false,
      expected: reviewed(0),
    },
    {
      name: "a miss on a problem combining several propositions changes none of them",
      outcome: "missed",
      targetCount: 3,
      expected: null,
    },
  ] as const)("$name", ({ name: _, expected, ...input }) => {
    expect(nextReview({ ...base, ...input })).toEqual(expected);
  });
});
