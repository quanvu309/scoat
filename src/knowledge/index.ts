import type { FactId, Instant, Intent, NonEmpty, Profile, Proof, ReleaseId, RowId, Url } from "../domain.js";
export type Place = "shop-price" | "other-sellers" | "student" | "membership" | "codes" | "cashback" | "price-match" | "card-perks";
export type Fact = Readonly<{
    id: FactId;
    subject: string;
    proof: NonEmpty<Proof>;
    validUntil: Instant;
    applies: "online" | "in-store" | "both";
    rule: {
        readonly kind: "benefit";
        readonly place: Place;
        readonly howToClaim: string;
    } | {
        readonly kind: "stacking";
        readonly with: readonly FactId[];
        readonly verdict: "allowed" | "forbidden";
    } | {
        readonly kind: "official-domain";
        readonly domain: string;
    };
}>;
export type RowRecipe = Readonly<{
    id: RowId;
    place: Place;
    label: string;
    slots: number;
    distinctSellers: boolean;
    method: string;
    proofRequired: string;
    stopRule: string;
    freshnessSeconds: number;
    facts: readonly FactId[];
}>;
export type Playbook = Readonly<{
    job: "best-benefit";
    version: number;
    introduction: string;
    resultInstructions: string;
    rows: NonEmpty<RowRecipe>;
}>;
export type Release = Readonly<{
    id: ReleaseId;
    market: "GB";
    publishedAt: Instant;
    playbooks: NonEmpty<Playbook>;
    facts: readonly Fact[];
}>;
export type Row = RowRecipe & Readonly<{
    slotIds: NonEmpty<number>;
}>;
export type GuideRequest = Readonly<{
    job: "best-benefit";
    shop: string | null;
}>;
export type Guide = Readonly<{
    release: ReleaseId;
    method: string;
    facts: readonly Fact[];
}>;
export function renderGuide(args: {
    release: Release;
    request: GuideRequest;
    format: "prompt" | "resource" | "skill" | "tool";
}): Guide {
    throw new Error("not implemented");
}
export function checklist(args: {
    release: Release;
    intent: Intent;
    profile: Profile;
}): NonEmpty<Row> {
    throw new Error("not implemented");
}
export function isOfficialSource(args: {
    release: Release;
    seller: string;
    source: Url;
}): boolean {
    throw new Error("not implemented");
}
export class Knowledge {
    publish(raw: unknown): Promise<ReleaseId> {
        throw new Error("not implemented");
    }
    read(args: {
        release: ReleaseId | "latest";
    }): Promise<Release> {
        throw new Error("not implemented");
    }
}
