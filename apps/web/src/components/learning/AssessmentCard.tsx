import type { LearningAssessment } from "@t3tools/contracts";

export function AssessmentCard(props: { readonly assessment: LearningAssessment }) {
  const { assessment } = props;
  return (
    <section className="rounded-xl border bg-card px-4 py-3.5 text-card-foreground text-sm">
      <p className="mb-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide">
        Where you are
      </p>
      <p className="font-medium">{assessment.goal}</p>
      <dl className="mt-3 flex flex-col gap-3">
        {assessment.strands.map((strand) => (
          <div key={strand.name}>
            <dt className="font-medium">{strand.name}</dt>
            <dd className="mt-1 grid gap-0.5 text-muted-foreground">
              <span>
                <span className="text-foreground">Solid:</span> {strand.solid}
              </span>
              <span>
                <span className="text-foreground">Breaks at:</span> {strand.breaksAt}
              </span>
              {strand.misconceptions ? (
                <span>
                  <span className="text-foreground">To untangle:</span> {strand.misconceptions}
                </span>
              ) : null}
              <span>
                <span className="text-foreground">Start from:</span> {strand.startFrom}
              </span>
            </dd>
          </div>
        ))}
      </dl>
      {assessment.summary ? (
        <p className="mt-3 text-muted-foreground">{assessment.summary}</p>
      ) : null}
    </section>
  );
}
