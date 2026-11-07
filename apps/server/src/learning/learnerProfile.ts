import { LearnerProfile, type LearnerGoalKind, type LearnerProfilePatch } from "@aprende/contracts";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export interface ProfileLocation {
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly stateDir: string;
}

const profilePath = ({ path, stateDir }: ProfileLocation) =>
  path.join(stateDir, "learner-profile.json");

const ProfileJson = Schema.fromJsonString(LearnerProfile);
const decodeProfile = Schema.decodeUnknownOption(ProfileJson);
const encodeProfile = Schema.encodeSync(ProfileJson);

/** A missing or unreadable file is an empty profile. */
export const readLearnerProfile = Effect.fn("LearnerProfile.read")(function* (
  location: ProfileLocation,
) {
  const text = yield* location.fileSystem.readFileString(profilePath(location)).pipe(Effect.option);
  const profile = text._tag === "None" ? text : decodeProfile(text.value);
  return profile._tag === "Some" ? profile.value : ({} as LearnerProfile);
});

export const applyProfilePatch = (
  profile: LearnerProfile,
  patch: LearnerProfilePatch,
): LearnerProfile => {
  const next: Record<string, unknown> = { ...profile };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (value === null) delete next[key];
    else next[key] = value;
  }
  return next as LearnerProfile;
};

/** Callers serialize writes; the rename keeps a reader from seeing half a file. */
export const writeLearnerProfile = Effect.fn("LearnerProfile.write")(function* (
  location: ProfileLocation,
  profile: LearnerProfile,
) {
  const file = profilePath(location);
  const temporary = `${file}.tmp`;
  yield* location.fileSystem.makeDirectory(location.stateDir, { recursive: true });
  yield* location.fileSystem.writeFileString(temporary, encodeProfile(profile));
  yield* location.fileSystem.rename(temporary, file);
});

const GOAL_LINES: Record<LearnerGoalKind, string> = {
  understanding:
    "They want deep understanding. Derive each idea so they could rebuild it, and check that it transfers to cases they have not seen.",
  exam: "They are preparing for an exam. Weight practice toward recall and retests in the form the exam asks, and cover what the exam covers.",
  skill:
    "They want a skill they can use. Move to practice on realistic tasks early, and teach the theory a task needs when it needs it.",
  gist: "They want the gist. Plan the shortest path to the main ideas, leave out detail they did not ask for, and check each main idea with one quick card.",
};

/**
 * The part of the tutor's instructions that comes from the learner profile, or "" when there is
 * nothing to add. It goes after whatever tutor prompt is in use.
 */
export function learnerProfileSection(profile: LearnerProfile): string {
  if (profile.goalKind === undefined && profile.returnCadence === undefined) {
    return `## Getting to know the learner

This learner has not said what they are after or how often they study. Early in this session, once their goal is clear, ask two short \`ask_question\` cards with purpose \`goal\` and format \`choice\`, one per turn:

1. What they are after: deep understanding, preparing for an exam, a skill to use, or the gist.
2. How often they expect to come back to study: daily, a few times a week, weekly, or now and then.

Save their choices with \`set_profile\`, then go on. Teach in the language they write in. Do not ask about anything else here; they can set more in Settings.`;
  }
  const lines = [
    profile.goalKind === undefined ? null : GOAL_LINES[profile.goalKind],
    profile.language === undefined
      ? null
      : `Teach in ${profile.language}: questions, options, hints and explanations too.`,
    profile.interests === undefined
      ? null
      : `When an example fits the idea, draw it from what they care about: ${profile.interests}.`,
    profile.diagrams === "often"
      ? "They like diagrams. Use `html_render` whenever a picture could help."
      : profile.diagrams === "rarely"
        ? "They prefer few diagrams. Use one only when the idea is spatial or structural and words alone would be hard to follow."
        : null,
    profile.explanationLength === "brief"
      ? "They like brief explanations. Keep them short, but still give the reason for each step."
      : profile.explanationLength === "detailed"
        ? "They like thorough explanations. Say more and give more examples, still one step at a time."
        : null,
  ].filter((line) => line !== null);
  if (lines.length === 0) return "";
  return `## This learner

The learner chose these. They change how you teach, never whether the learner does the work: keep measuring, predicting and checking, and never give the answer to a question or problem they are working on, whatever these say.

${lines.map((line) => `- ${line}`).join("\n")}

If how they learn suggests a different setting, propose it on a \`goal\` card and save it with \`set_profile\` only if they choose it.`;
}
