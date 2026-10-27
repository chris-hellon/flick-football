import type { Club } from "../rules/clubs";

/** A small CSS swatch of the club's shirt pattern. */
export function kitCSS(k: Club): string {
  const a = k.shirt;
  const b = k.alt;
  switch (k.pat) {
    case "stripes":
      return `repeating-linear-gradient(90deg,${a} 0 3px,${b} 3px 6px)`;
    case "hoops":
      return `repeating-linear-gradient(0deg,${a} 0 4px,${b} 4px 8px)`;
    case "halves":
      return `linear-gradient(90deg,${a} 50%,${b} 50%)`;
    case "sash":
      return `linear-gradient(135deg,${a} 38%,${b} 38% 62%,${a} 62%)`;
    default:
      return `linear-gradient(${a},${a}) , linear-gradient(${b},${b})`;
  }
}

export const kitEl = (k: Club, cls = "kit"): string =>
  `<span class="${cls}" style="background:${kitCSS(k)}"></span>`;
