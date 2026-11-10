import { EDITORS, type EditorId } from "@aprende/contracts";

import { getLocalFileManagerName } from "~/lib/utils";

const editorLabels = new Map<EditorId, string>(EDITORS.map((editor) => [editor.id, editor.label]));

const NO_EDITORS: ReadonlyArray<EditorId> = [];
const FILE_MANAGER_ONLY: ReadonlyArray<EditorId> = ["file-manager"];

/** Learners open files and folders in the file manager, never a code editor. */
export function learnerEditors(
  available: ReadonlyArray<EditorId> | undefined,
): ReadonlyArray<EditorId> {
  return available?.includes("file-manager") ? FILE_MANAGER_ONLY : NO_EDITORS;
}

export function editorLabelForPlatform(editorId: EditorId, platform: string): string {
  if (editorId === "file-manager") {
    return getLocalFileManagerName(platform);
  }

  return editorLabels.get(editorId) ?? "Editor";
}
