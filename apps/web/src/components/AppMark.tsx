import type { SVGProps } from "react";

/** aprende's mark: three rising steps and a spark, in the current text colour. */
export function AppMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="250 190 524 584" xmlns="http://www.w3.org/2000/svg">
      <rect x="262" y="590" width="132" height="172" rx="30" fill="currentColor" />
      <rect x="446" y="478" width="132" height="284" rx="30" fill="currentColor" />
      <rect x="630" y="366" width="132" height="396" rx="30" fill="currentColor" />
      <circle cx="696" cy="262" r="58" fill="currentColor" />
    </svg>
  );
}
