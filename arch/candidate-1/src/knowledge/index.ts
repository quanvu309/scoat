import type { FactId, Instant, Intent, NonEmpty, Profile, Proof, ReleaseId, RowId, Url } from "../domain.js";

export type BenefitKind = "price" | "seller" | "student" | "membership" | "code"
  | "cashback" | "price-match" | "card";
export type Fact = Readonly<{
  id: FactId; shopOrProgramme: string; proof: NonEmpty<Proof>;
  validUntil: Instant; applies: "online" | "in-store" | "both";
  rule: { readonly kind: "benefit"; readonly category: BenefitKind; readonly instructions: string }
    | { readonly kind: "stacking"; readonly with: readonly FactId[];
        readonly verdict: "allowed" | "forbidden"; readonly conditions: readonly string[] }
    | { readonly kind: "official-domain"; readonly domain: string };
}>;
export type RowRecipe = Readonly<{
  id: RowId; label: string; category: BenefitKind; checks: number;
  method: string; proofRequired: string; stopRule: string;
  freshnessSeconds: number;
  factIds: readonly FactId[];
}>;
export type Row = RowRecipe & Readonly<{
  /** Stable slots 0..checks-1; four seller checks remain one checklist row. */
  slots: NonEmpty<number>;
}>;
export type Playbook = Readonly<{
  job: "product"; version: number; rows: NonEmpty<RowRecipe>;
  introduction: string; resultInstructions: string;
}>;
/** Immutable content-addressed release: methods AND facts are published atomically. */
export type Release = Readonly<{
  id: ReleaseId; market: "GB"; publishedAt: Instant;
  playbooks: NonEmpty<Playbook>; facts: readonly Fact[];
  sellers: readonly Readonly<{ key: string; officialOrigins: readonly Url[] }>[];
}>;
export type GuideRequest = Readonly<{ job: "product"; shop: string | null; market: "GB" }>;
export type Guide = Readonly<{
  release: ReleaseId; method: string; facts: readonly Fact[];
  resource: string; skillResource: string;
}>;
export type KnowledgeRead = GuideRequest & Readonly<{ release: ReleaseId | "latest" }>;

/** Host prompt, fallback tool and skill resource all call this renderer. */
export function renderGuide(args: { release: Release; request: GuideRequest }): Guide {
  // TODO Render published row methods/facts/stop rules, including source dates and known unknowns.
  // TODO Instruct every worker to read hunt controls before its next external search; stop on directive.
  throw new Error("not implemented");
}
/** Only this function constructs checklists; profile filters never silently remove a required category. */
export function checklist(args: { release: Release; intent: Intent; profile: Profile }): NonEmpty<Row> {
  // TODO Instantiate recipe slots. Inapplicable/unsupported rows require evidenced none or a named gap.
  throw new Error("not implemented");
}
/** Server checks official code provenance; third-party code sources ALWAYS normalize to untested. */
export function isOfficialSource(args: { release: Release; seller: string; source: Url }): boolean {
  // TODO Compare parsed HTTPS origins to team-attested domains, never caller-provided issuer flags.
  throw new Error("not implemented");
}
export class Knowledge {
  /** Verifies release signature, references, unique rows, facts and dates before publishing. */
  publish(raw: unknown): Promise<ReleaseId> {
    // TODO Team-only ingestion; reject broken links between recipes/facts. Never an agent MCP tool.
    throw new Error("not implemented");
  }
  read(query: KnowledgeRead): Promise<Release> {
    // TODO Resolve latest only for discovery; immutable IDs are readable throughout hunt retention.
    throw new Error("not implemented");
  }
}
