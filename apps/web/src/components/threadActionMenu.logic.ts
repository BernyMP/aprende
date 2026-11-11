import type { ContextMenuItem, ProjectId } from "@aprende/contracts";
import type { SnoozePreset } from "@aprende/client-runtime/state/thread-settled";
import type { EnvironmentProject } from "@aprende/client-runtime/state/shell";

export type ThreadActionMenuId =
  | "find"
  | "open-notebook"
  | "filter-by-project"
  | "turn-into-project"
  | "move-to-notebook"
  | `move-to-notebook:${string}`
  | "project-settings"
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "auto-settle"
  | "auto-settle:enabled"
  | "auto-settle:disabled"
  | "snooze"
  | `snooze:${string}`
  | "unsnooze"
  | "rename"
  | "regenerate-title"
  | "mark-unread"
  | "copy"
  | "copy-path"
  | "copy-thread"
  | "copy-thread-id"
  | "archive"
  | "delete";

export type DraftActionMenuId = "copy" | "copy-path" | "project-settings" | "discard";

export function buildDraftActionMenuItems(options: {
  readonly hasPath: boolean;
  readonly hasProject: boolean;
}): ReadonlyArray<ContextMenuItem<DraftActionMenuId>> {
  return [
    {
      id: "copy",
      label: "Copy",
      icon: "copy",
      disabled: !options.hasPath,
      children: options.hasPath
        ? [{ id: "copy-path" as const, label: "Path", icon: "folder" }]
        : [],
    },
    ...(options.hasProject
      ? [{ id: "project-settings" as const, label: "Notebook settings", icon: "settings" }]
      : []),
    {
      id: "discard",
      label: "Discard draft",
      icon: "trash",
      destructive: true,
      separatorBefore: true,
    },
  ];
}

export interface ThreadActionMenuState {
  readonly canOperate: boolean;
  readonly canFind?: boolean;
  /** The thread is in a project, so it has a notebook to open. */
  readonly canOpenNotebook?: boolean;
  readonly projectFilter: {
    readonly label: string;
    readonly isActive: boolean;
  } | null;
  readonly isPinned: boolean;
  readonly isSettled: boolean;
  readonly autoSettleEnabled: boolean;
  readonly isSnoozed: boolean;
  readonly canSnoozeNow: boolean;
  readonly isRegeneratingTitle: boolean;
  /** Archive rejects attached providers, so disable it while running. */
  readonly isRunning: boolean;
  readonly supports: {
    readonly settlement: boolean;
    readonly autoSettleOptOut: boolean;
    readonly snooze: boolean;
    readonly pinning: boolean;
    readonly titleRegeneration: boolean;
  };
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  /** A No project thread with its own folder, on a server that can promote it. */
  readonly canTurnIntoProject?: boolean;
  /** Notebooks the thread can move to. */
  readonly moveTargets?: ReadonlyArray<{ readonly projectId: ProjectId; readonly title: string }>;
  /**
   * Set when no lesson list is shown: pin, snooze and unread have nothing to act on, and only a
   * quick question, which the home page lists, can be put away.
   */
  readonly withoutLessonList?: { readonly isQuickQuestion: boolean };
}

/** The notebooks a thread can move to: the others in its environment. */
export function notebookMoveTargets(
  projects: ReadonlyArray<EnvironmentProject>,
  thread: { readonly environmentId: string; readonly projectId: string },
): ReadonlyArray<{ readonly projectId: ProjectId; readonly title: string }> {
  return projects
    .filter(
      (project) =>
        project.environmentId === thread.environmentId &&
        project.id !== thread.projectId &&
        project.isScratch !== true &&
        project.archivedAt == null,
    )
    .map((project) => ({ projectId: project.id, title: project.title }))
    .toSorted((left, right) => left.title.localeCompare(right.title));
}

/** Local navigation, read markers, and copying remain available to read-only clients. */
export function threadActionRequiresOperate(action: ThreadActionMenuId): boolean {
  return ![
    "find",
    "open-notebook",
    "project-settings",
    "mark-unread",
    "copy",
    "copy-path",
    "copy-thread",
    "copy-thread-id",
  ].includes(action);
}

export function buildThreadActionMenuItems(
  state: ThreadActionMenuState,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  const listless = state.withoutLessonList;
  const supports =
    listless === undefined
      ? state.supports
      : {
          ...state.supports,
          pinning: false,
          snooze: false,
          autoSettleOptOut: false,
          settlement: state.supports.settlement && listless.isQuickQuestion,
        };
  const items: ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> = [
    ...(state.canFind
      ? [{ id: "find" as const, label: "Find in lesson", icon: "text-search" }]
      : []),
    ...(supports.pinning
      ? [
          state.isPinned
            ? { id: "unpin" as const, label: "Unpin lesson", icon: "pin-off" }
            : { id: "pin" as const, label: "Pin lesson", icon: "pin" },
        ]
      : []),
    ...(supports.settlement
      ? [
          state.isSettled
            ? {
                id: "unsettle" as const,
                label: listless ? "Show on the home page" : "Un-settle lesson",
                icon: "circle-check",
              }
            : {
                id: "settle" as const,
                label: listless ? "Remove from the home page" : "Settle lesson",
                icon: "circle-check",
              },
        ]
      : []),
    ...(supports.snooze
      ? [
          state.isSnoozed
            ? { id: "unsnooze" as const, label: "Wake lesson", icon: "clock" }
            : {
                id: "snooze" as const,
                label: "Snooze",
                icon: "clock",
                disabled: !state.canSnoozeNow,
                children: [
                  ...state.snoozePresets.map((preset) => ({
                    id: `snooze:${preset.id}` as const,
                    label: `${preset.label} (${preset.whenLabel})`,
                  })),
                  {
                    id: "snooze:custom" as const,
                    label: "Custom…",
                    separatorBefore: state.snoozePresets.length > 0,
                  },
                ],
              },
        ]
      : []),
    { id: "rename", label: "Rename lesson", icon: "pencil", separatorBefore: true },
    ...(supports.titleRegeneration
      ? [
          {
            id: "regenerate-title" as const,
            label: state.isRegeneratingTitle ? "Regenerating…" : "Regenerate title",
            icon: "refresh-cw",
            disabled: state.isRegeneratingTitle,
          },
        ]
      : []),
    ...(listless ? [] : [{ id: "mark-unread" as const, label: "Mark unread", icon: "mail-open" }]),
    ...(state.canOpenNotebook
      ? [{ id: "open-notebook" as const, label: "Open notebook", icon: "notebook" }]
      : []),
    ...(state.projectFilter
      ? [
          {
            id: "filter-by-project" as const,
            label: state.projectFilter.isActive
              ? "Show all notebooks"
              : `Filter by ${state.projectFilter.label}`,
            icon: "folder-tree",
          },
        ]
      : []),
    ...(state.moveTargets !== undefined && state.moveTargets.length > 0
      ? [
          {
            id: "move-to-notebook" as const,
            label: "Move to notebook",
            icon: "notebook",
            disabled: state.isRunning,
            children: state.moveTargets.map((target) => ({
              id: `move-to-notebook:${target.projectId}` as const,
              label: target.title,
            })),
          },
        ]
      : []),
    ...(state.canTurnIntoProject
      ? [
          {
            id: "turn-into-project" as const,
            label: "Turn into notebook",
            icon: "folder-plus",
            disabled: state.isRunning,
          },
        ]
      : []),
    ...(supports.autoSettleOptOut
      ? [
          {
            id: "auto-settle" as const,
            label: "Auto-settle behavior",
            icon: "timer",
            children: [
              {
                id: "auto-settle:enabled" as const,
                label: "Enabled",
                checked: state.autoSettleEnabled,
              },
              {
                id: "auto-settle:disabled" as const,
                label: "Disabled",
                checked: !state.autoSettleEnabled,
              },
            ],
          },
        ]
      : []),
    {
      id: "copy",
      label: "Copy",
      icon: "copy",
      separatorBefore: true,
      children: [
        { id: "copy-path", label: "Path", icon: "folder" },
        { id: "copy-thread", label: "Lesson", icon: "message-square" },
        { id: "copy-thread-id", label: "Lesson ID", icon: "hash" },
      ],
    },
    { id: "project-settings", label: "Notebook settings", icon: "settings" },
    {
      id: "archive",
      label: "Archive lesson",
      icon: "archive",
      disabled: state.isRunning,
      separatorBefore: true,
    },
    {
      id: "delete",
      label: "Delete",
      destructive: true,
      icon: "trash",
    },
  ];
  return state.canOperate
    ? items
    : items.map((item) =>
        threadActionRequiresOperate(item.id)
          ? {
              ...item,
              disabled: true,
              ...(item.children
                ? { children: item.children.map((child) => ({ ...child, disabled: true })) }
                : {}),
            }
          : item,
      );
}
