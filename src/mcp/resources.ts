import type { Release } from "../knowledge/index.js";
import { renderGuide } from "../knowledge/index.js";

export function pinnedResources(releases: readonly Release[]) {
  return releases.flatMap((release) =>
    (["resource", "skill"] as const).map((format) => ({
      name: `${release.id}-${format}`,
      uri: `scoat://knowledge/${release.id}/${format === "skill" ? "SKILL.md" : "guide"}`,
      mimeType: "text/markdown",
      text: renderGuide({
        release,
        request: { job: "best-benefit", shop: null },
        format,
      }).method,
    })),
  );
}
