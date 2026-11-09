import type { EnvironmentProject } from "@aprende/client-runtime/state/shell";
import type { LearningOutlineTopic } from "@aprende/contracts";

import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildLessonMessage } from "./notebook.logic";
import { reportNotebookResult } from "./useNotebook";
import { useStartSession } from "./useStartSession";

/** Starts a lesson on a notebook topic and opens it. */
export function useStartLesson() {
  const startSession = useStartSession();
  const setLessonTopic = useAtomCommand(serverEnvironment.setLessonTopic, {
    label: "start the lesson",
    reportFailure: false,
  });

  return (project: EnvironmentProject, topic: LearningOutlineTopic): Promise<boolean> =>
    startSession(project, {
      title: topic.title,
      text: buildLessonMessage(topic, project.title),
      failureTitle: "Could not start the lesson",
      // Linked first, so the tutor's first turn already knows its topic.
      beforeStart: async (threadId) =>
        reportNotebookResult(
          await setLessonTopic({
            environmentId: project.environmentId,
            input: { projectId: project.id, threadId, topicId: topic.id },
          }),
          "Could not start the lesson",
        ),
    });
}
