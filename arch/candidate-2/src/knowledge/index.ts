import type { HttpUrl, Id, Product, Profile, ReleaseId, RowId, Source } from "../core/index.js";
export type StepKind = "identify-sellers" | "quote" | "benefit" | "verify" | "compatibility";
export type Place = "shop-price" | "other-sellers" | "student" | "membership" | "codes" | "cashback" | "price-match" | "card-perks";
export interface Fact {
  readonly id: Id<"fact">; readonly subject: string; readonly market: "GB";
  readonly source: Source; readonly validUntil: string;
  readonly rule: { readonly kind: "eligibility"; readonly requirement: string }
    | { readonly kind: "channel"; readonly value: "online" | "store" | "both" }
    | { readonly kind: "stacking"; readonly otherFact: Id<"fact">; readonly allowed: boolean }
    | { readonly kind: "benefit"; readonly description: string; readonly redemption: HttpUrl };
}
/** Typed instruction algebra; no free-form executable prompts or arbitrary agent stages. */
export interface Inputs {
  readonly "identify-sellers": { readonly product: Product; readonly count: 4 };
  readonly quote: { readonly product: Product; readonly seller: HttpUrl };
  readonly benefit: { readonly product: Product; readonly place: Place; readonly facts: readonly Fact[]; readonly profile: Profile };
  readonly verify: { readonly offer: Id<"observation">; readonly requirement: string };
  readonly compatibility: { readonly offers: readonly Id<"observation">[]; readonly question: string };
}
export type Instruction<K extends StepKind = StepKind> = {
  [P in K]: { readonly kind: P; readonly inputs: Inputs[P]; readonly proof: string;
    readonly stop: string; readonly facts: readonly Id<"fact">[] }
}[K];
/** Seller slots are materialized only by server validation of identify-sellers output. */
/** Templates bind contextual inputs during compilation; releases never embed a person's data. */
interface TemplateInputs {
  readonly "identify-sellers": { readonly count: 4 };
  readonly quote: { readonly seller: "product-origin" | { readonly slot: 0 | 1 | 2 | 3 } };
  readonly benefit: { readonly place: Place };
}
export type InstructionTemplate = { [K in keyof TemplateInputs]: {
  readonly kind: K; readonly bind: TemplateInputs[K]; readonly proof: string; readonly stop: string;
  readonly factIds: readonly Id<"fact">[];
} }[keyof TemplateInputs];
export type ProgramNode = { readonly kind: "step"; readonly key: string; readonly group: Place;
  readonly after: readonly string[]; readonly instruction: InstructionTemplate }
  | { readonly kind: "seller-expansion"; readonly key: string; readonly group: "other-sellers";
      readonly after: string; readonly slots: 4 };
export interface Release {
  readonly id: ReleaseId; readonly digest: string; readonly facts: readonly Fact[];
  readonly jobs: Readonly<Record<"product-benefits", readonly ProgramNode[]>>;
}
export interface PlanRow {
  readonly id: RowId; readonly group: Place; readonly dependsOn: readonly RowId[];
  readonly instruction: Instruction;
}
export interface Plan { readonly release: ReleaseId; readonly rows: readonly PlanRow[] }
/** Private release storage indexed by merchant/programme/market; releases never mutate. */
export class Knowledge {
  /** Validates acyclicity, fact references, all eight places and four seller slots. */
  async publish(candidate: Release): Promise<ReleaseId> { throw new Error("not implemented"); }
  async compile(input: { release: ReleaseId; product: Product; profile: Profile }): Promise<Plan> {
    // TODO Bind product/profile placeholders; assign stable row IDs and reject missing coverage.
    // TODO Four seller slots remain obligations even when discovery returns fewer sellers.
    // TODO Missing slots become explicitly named gaps, never silently disappear.
    throw new Error("not implemented");
  }
  /** MCP prompt, resource, tool fallback and downloadable skill use this same renderer. */
  async explain(input: { release: ReleaseId; product: Product | null }): Promise<string> { throw new Error("not implemented"); }
  async facts(input: { release: ReleaseId; subject: string }): Promise<readonly Fact[]> { throw new Error("not implemented"); }
}
