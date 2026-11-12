import {
  learningStrandLevel,
  type LearningAssessment,
  type LearningStrand,
  type LearningStrandLevel,
} from "@aprende/contracts";
import { CircleCheckIcon, CircleDashedIcon, CircleDotIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "~/lib/utils";
import ChatMarkdown from "../ChatMarkdown";
import { OPTION_MARKDOWN_PLUGINS } from "./QuestionCard.logic";

const LEVELS: ReadonlyArray<LearningStrandLevel> = ["solid", "partial", "new"];

const LEVEL = {
  solid: { label: "solid", Icon: CircleCheckIcon, icon: "text-success", bar: "bg-success" },
  partial: {
    label: "partly there",
    Icon: CircleDotIcon,
    icon: "text-warning",
    bar: "bg-warning",
  },
  new: {
    label: "new",
    Icon: CircleDashedIcon,
    icon: "text-muted-foreground",
    bar: "bg-muted-foreground/40",
  },
} satisfies Record<LearningStrandLevel, unknown>;

const EYEBROW = "font-medium text-muted-foreground text-xs uppercase tracking-wide";

// The tutor writes code in backticks; phrases stay on one line, like answer choices.
function Phrase(props: { readonly text: string }) {
  return (
    <ChatMarkdown
      inline
      text={props.text}
      cwd={undefined}
      parseRawHtml={false}
      extraRemarkPlugins={OPTION_MARKDOWN_PLUGINS}
    />
  );
}

function Detail(props: {
  readonly label: string;
  readonly flagged?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-2">
      <dt className={props.flagged ? "text-warning-foreground" : "text-muted-foreground/80"}>
        {props.label}
      </dt>
      <dd className="text-muted-foreground">{props.children}</dd>
    </div>
  );
}

function Strand(props: { readonly strand: LearningStrand; readonly level: LearningStrandLevel }) {
  const { strand, level } = props;
  const { Icon, icon, label } = LEVEL[level];
  const holds = level === "new" ? undefined : strand.solid;
  const gap = level === "solid" ? undefined : strand.breaksAt;
  const untangle = level === "solid" ? undefined : strand.misconceptions;
  return (
    <li className="flex gap-2.5">
      <Icon aria-label={label} className={cn("mt-0.5 size-4 shrink-0", icon)} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="font-medium">
          <Phrase text={strand.name} />
        </p>
        {level === "solid" ? (
          holds === undefined ? null : (
            <p className="text-muted-foreground">
              <Phrase text={holds} />
            </p>
          )
        ) : (
          <dl className="flex flex-col gap-0.5">
            {holds === undefined ? null : (
              <Detail label="Solid">
                <Phrase text={holds} />
              </Detail>
            )}
            {gap === undefined ? null : (
              <Detail label="Not yet">
                <Phrase text={gap} />
              </Detail>
            )}
            {untangle === undefined ? null : (
              <Detail flagged label="To untangle">
                <Phrase text={untangle} />
              </Detail>
            )}
          </dl>
        )}
      </div>
    </li>
  );
}

/** Where the learner is going, then where they stand; the plan map below says where to next. */
export function StartingPoint(props: { readonly assessment: LearningAssessment }) {
  const { assessment } = props;
  const strands = assessment.strands
    .map((strand) => ({ strand, level: learningStrandLevel(strand) }))
    .toSorted((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level));
  const counts = LEVELS.map((level) => ({
    level,
    count: strands.filter((entry) => entry.level === level).length,
  })).filter((entry) => entry.count > 0);
  return (
    <section className="flex flex-col gap-5 text-sm" aria-label="Your starting point">
      <div className="flex flex-col gap-1.5">
        <p className={EYEBROW}>Your goal</p>
        <p className="text-pretty font-medium text-base">
          <Phrase text={assessment.goal} />
        </p>
      </div>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <p className={EYEBROW}>Your starting point</p>
          {assessment.summary ? (
            <p className="text-pretty">
              <Phrase text={assessment.summary} />
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <div aria-hidden className="flex gap-1">
            {strands.map((entry, index) => (
              <span
                // oxlint-disable-next-line react/no-array-index-key -- strands have no id and never reorder
                key={index}
                className={cn("h-1.5 w-6 rounded-full", LEVEL[entry.level].bar)}
              />
            ))}
          </div>
          <p className="text-muted-foreground text-xs">
            {counts.map((entry) => `${entry.count} ${LEVEL[entry.level].label}`).join(" · ")}
          </p>
        </div>
        <ul className="flex flex-col gap-3">
          {strands.map((entry, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- strands have no id and never reorder
            <Strand key={index} strand={entry.strand} level={entry.level} />
          ))}
        </ul>
      </div>
    </section>
  );
}
