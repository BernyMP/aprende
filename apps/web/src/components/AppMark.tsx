import type { SVGProps } from "react";

const MARK_PATH =
  "M486 613 V492 C389 492 304 413 295 265 C424 271 506 343 512 416 C516 321 589 219 722 207 C724 348 639 435 538 444 V613 Z M486 613 C433 549 317 532 238 552 Q221 556 221 575 L221 740 Q221 760 240 757 C317 740 433 753 486 817 Z M538 613 C591 549 707 532 786 552 Q803 556 803 575 L803 740 Q803 760 784 757 C707 740 591 753 538 817 Z";

/** aprende's mark: a seedling growing from an open book, in the current text colour. */
export function AppMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="197 197 630 630" xmlns="http://www.w3.org/2000/svg">
      <path fill="currentColor" d={MARK_PATH} />
    </svg>
  );
}

/** The app icon, drawn flat so it sits with the UI around it. */
export function AppLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="100 100 824 824" xmlns="http://www.w3.org/2000/svg">
      <rect x="100" y="100" width="824" height="824" rx="196" className="fill-logo" />
      <path className="fill-logo-foreground" d={MARK_PATH} />
    </svg>
  );
}
