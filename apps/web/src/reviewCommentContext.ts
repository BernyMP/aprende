import { PullRequestContextMetadata } from "@aprende/contracts";
import * as Schema from "effect/Schema";

const ReviewCommentSelectionSchema = Schema.Struct({
  start: Schema.Number,
  side: Schema.Literals(["additions", "deletions"]),
  end: Schema.Number,
  endSide: Schema.Literals(["additions", "deletions"]),
});
type ReviewCommentSelection = typeof ReviewCommentSelectionSchema.Type;

export const ReviewCommentContextSchema = Schema.Struct({
  id: Schema.String,
  sectionId: Schema.String,
  sectionTitle: Schema.String,
  filePath: Schema.String,
  startIndex: Schema.Number,
  endIndex: Schema.Number,
  rangeLabel: Schema.String,
  text: Schema.String,
  diff: Schema.String,
  fenceLanguage: Schema.optional(Schema.String),
  selection: Schema.optional(ReviewCommentSelectionSchema),
  pullRequest: Schema.optional(PullRequestContextMetadata),
});

export interface ReviewCommentContext {
  readonly id: string;
  readonly sectionId: string;
  readonly sectionTitle: string;
  readonly filePath: string;
  readonly startIndex: number;
  readonly endIndex: number;
  readonly rangeLabel: string;
  readonly text: string;
  readonly diff: string;
  readonly fenceLanguage?: string | undefined;
  readonly selection?: ReviewCommentSelection | undefined;
  readonly pullRequest?: PullRequestContextMetadata | undefined;
}

export function formatReviewCommentFence(language: string, contents: string): string {
  const longestBacktickRun = Math.max(
    0,
    ...Array.from(contents.matchAll(/`+/g), (match) => match[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1));
  return [`${fence}${language}`, contents.trimEnd(), fence].join("\n");
}

export function buildFileReviewComment(input: {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
  contents: string;
}): ReviewCommentContext {
  const startLine = Math.max(1, Math.min(input.startLine, input.endLine));
  const endLine = Math.max(startLine, Math.max(input.startLine, input.endLine));
  const selectedLines = input.contents.split("\n").slice(startLine - 1, endLine);
  return {
    id: input.id,
    sectionId: `file:${input.filePath}`,
    sectionTitle: "File comment",
    filePath: input.filePath,
    startIndex: startLine - 1,
    endIndex: endLine - 1,
    rangeLabel: startLine === endLine ? `L${startLine}` : `L${startLine} to L${endLine}`,
    text: input.text.trim(),
    diff: selectedLines.join("\n"),
    fenceLanguage: inferReviewCommentFenceLanguage(input.filePath),
  };
}

function inferReviewCommentFenceLanguage(filePath: string): string {
  const normalizedPath = filePath.replaceAll("\\", "/");
  const fileName = normalizedPath.slice(normalizedPath.lastIndexOf("/") + 1).toLowerCase();
  const extensionIndex = fileName.lastIndexOf(".");
  if (extensionIndex > 0 && extensionIndex < fileName.length - 1) {
    return fileName.slice(extensionIndex + 1);
  }
  if (fileName.startsWith(".") && fileName.length > 1) {
    return fileName.slice(1);
  }
  return "text";
}

export function buildReviewCommentRenderablePatch(comment: ReviewCommentContext): string {
  if ((comment.fenceLanguage ?? "diff") !== "diff") {
    return "";
  }
  if (comment.diff.trim().length === 0) {
    return "";
  }
  const diff = comment.diff.trimStart().replace(/\n+$/, "");
  if (diff.startsWith("diff --git ")) {
    return diff;
  }

  const normalizedPath = comment.filePath.replaceAll("\\", "/");
  return [
    `diff --git a/${normalizedPath} b/${normalizedPath}`,
    `--- a/${normalizedPath}`,
    `+++ b/${normalizedPath}`,
    diff,
  ].join("\n");
}
