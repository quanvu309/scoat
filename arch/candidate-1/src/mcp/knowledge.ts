import type { Guide, GuideRequest, Knowledge, Release } from "../knowledge/index.js";
import type { Agent, HuntId, ReleaseId, Result } from "../domain.js";
import type { Hunts, HuntView } from "../hunt/index.js";

/** MCP prompt arguments are strings on the wire; mount parses them into GuideRequest once. */
export const prompt = {
  name: "hunt-benefits", arguments: ["job", "shop", "market"],
  description: "Run a thorough UK benefit hunt using the host's search and Scoat's sourced method.",
};
export const resourceCatalog = {
  latest: { uri: "scoat://knowledge/latest", mime: "application/json",
    description: "Current immutable knowledge release, including public facts and playbook recipes." },
  guide: { uri: "scoat://knowledge/{release}/{job}/{shop}", mime: "text/markdown",
    description: "Pinned sourced hunt method and shop/programme facts; use _ for an unspecified shop." },
  skill: { uri: "scoat://skills/{release}/{job}.md", mime: "text/markdown",
    description: "Downloadable SKILL.md text generated from the same published playbook." },
  hunt: { uri: "scoat://hunts/{hunt}", mime: "application/json",
    description: "Private current hunt card state and full text fallback, scoped to the OAuth account." },
};
export type ResourceRequest =
  | { readonly kind: "latest" }
  | { readonly kind: "guide"; readonly release: ReleaseId; readonly request: GuideRequest }
  | { readonly kind: "skill"; readonly release: ReleaseId; readonly job: "product" }
  | { readonly kind: "hunt"; readonly hunt: HuntId };
export type ResourceDocument =
  | { readonly mime: "application/json"; readonly data: Release | HuntView }
  | { readonly mime: "text/markdown"; readonly text: string; readonly release: ReleaseId };

/** Adapter emits SDK prompt messages from Guide.method; no parallel prompt or skill source. */
export function getPrompt(args: { knowledge: Knowledge; request: GuideRequest }): Promise<Guide> {
  throw new Error("not implemented");
}
export function readResource(args: {
  agent: Agent; knowledge: Knowledge; hunts: Hunts; request: ResourceRequest;
}): Promise<Result<ResourceDocument>> {
  // TODO Decode template URI segments, authorize private reads, render immutable guide/skill via Knowledge.
  // TODO Skill adds generated frontmatter/instructions; generic skill includes all supported shop branches.
  throw new Error("not implemented");
}
