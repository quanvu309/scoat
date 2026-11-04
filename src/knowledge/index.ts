import { z } from "zod";
import { readFile, readdir, mkdir, writeFile, link, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Intent, Profile, Url } from "../domain.js";

const text = z.string().trim().min(1);
const key = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const instant = z.iso.datetime().brand<"UtcInstant">();
const url = z.url().refine(value => { const parsed = new URL(value); return parsed.protocol === "https:" && !parsed.username && !parsed.password; }, "Public HTTPS source required").brand<"PublicHttpsUrl">();
export const places = ["shop-price", "other-sellers", "student", "membership", "codes", "cashback", "price-match", "card-perks"] as const;
const place = z.enum(places);
const fact = z.strictObject({
  id: key.brand<"FactId">(), shop: key, claim: text, place,
  source: url, observedAt: instant, validUntil: instant,
  applies: z.enum(["online", "in-store", "both"]), refreshOwner: text,
  authority: z.enum(["primary", "third-party"]),
  status: z.enum(["confirmed", "needs-step", "untested", "unknown"]),
  kind: z.enum(["benefit", "student", "code", "official-domain"]),
  domain: z.string().nullable(), requires: z.array(text), references: z.array(key)
});
const row = z.strictObject({ id: key.brand<"RowId">(), place, label: text, method: text, proofRequired: text, stopRule: text, slots: z.array(z.number().int().nonnegative()).min(1), facts: z.array(key) });
const shop = z.discriminatedUnion("status", [
  z.strictObject({ id: key, label: text, status: z.literal("unsupported"), reason: text, refreshOwner: text }),
  z.strictObject({ id: key, label: text, status: z.literal("supported"), facts: z.array(key).min(1) })
]);
export const releaseSchema = z.strictObject({ id: key.refine(value => value !== "latest", "Reserved release ID").brand<"ReleaseId">(), market: z.literal("GB"), publishedAt: instant, rows: z.array(row), shops: z.array(shop), facts: z.array(fact) });
export type Release = z.infer<typeof releaseSchema>;
export type Fact = z.infer<typeof fact>;
export type Row = z.infer<typeof row>;
export type GuideRequest = { job: "best-benefit"; shop: string | null };
function unique(values: readonly (string | number)[], name: string) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${name}`);
}
export function validateRelease(raw: unknown, now: string): Release {
  const release = releaseSchema.parse(raw);
  const at = Date.parse(instant.parse(now));
  if (Date.parse(release.publishedAt) > at) throw new Error("Future publication");
  unique(release.rows.map(row => row.place), "checklist row");
  unique(release.rows.map(row => row.id), "row ID");
  for (const name of places) {
    const recipe = release.rows.find(row => row.place === name);
    if (!recipe) throw new Error(`Missing row ${name}`);
    const slots = name === "other-sellers" ? [0, 1, 2, 3] : [0];
    if (JSON.stringify(recipe.slots) !== JSON.stringify(slots)) throw new Error(`Invalid ${name} slots; expected ${slots}`);
  }
  unique(release.shops.map(shop => shop.id), "seller identity");
  unique(release.shops.map(shop => shop.label.toLowerCase()), "seller configuration");
  unique(release.facts.map(fact => fact.id), "fact ID");
  const facts = new Map(release.facts.map(fact => [fact.id.toString(), fact]));
  for (const recipe of release.rows) for (const id of recipe.facts) {
    const value = facts.get(id);
    if (!value || value.place !== recipe.place) throw new Error(`Dangling or wrong-place row fact ${id}`);
  }
  for (const entry of release.shops) if (entry.status === "supported") for (const id of entry.facts) {
    if (facts.get(id)?.shop !== entry.id) throw new Error(`Dangling shop fact ${id}`);
  }
  for (const value of release.facts) {
    const entry = release.shops.find(shop => shop.id === value.shop);
    if (!entry || entry.status !== "supported" || !entry.facts.includes(value.id)) throw new Error(`Unowned fact ${value.id}`);
    if (!release.rows.some(row => row.place === value.place && row.facts.includes(value.id))) throw new Error(`Unreachable fact ${value.id}`);
    if (Date.parse(value.observedAt) > Date.parse(release.publishedAt) || Date.parse(value.validUntil) <= Date.parse(value.observedAt)) throw new Error(`Invalid provenance time ${value.id}`);
    if (value.status !== "unknown" && Date.parse(value.validUntil) <= at) throw new Error(`Expired fact ${value.id}`);
    for (const id of value.references) if (!facts.has(id) || id === value.id) throw new Error(`Dangling fact reference ${id}`);
    if (value.authority === "third-party" && (value.kind !== "code" || value.status !== "untested")) throw new Error("Third-party codes must remain untested; other facts need primary sources");
    if ((value.kind === "student" && value.place !== "student") || (value.kind === "code" && value.place !== "codes")) throw new Error("Fact kind must match checklist place");
    if (value.kind === "student" && (value.status !== "needs-step" || !value.requires.includes("verify-student"))) throw new Error("Student declaration is not verification");
    if (value.status === "needs-step" && value.requires.length === 0) throw new Error("Eligibility steps required");
    if (value.kind === "official-domain") {
      if (value.authority !== "primary" || value.status !== "confirmed" || value.domain !== new URL(value.source).hostname) throw new Error("Official domain needs matching primary proof");
    } else if (value.domain !== null) throw new Error("Unexpected official domain");
  }
  return freeze(release);
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
export function checklist({ release }: { release: Release; intent?: Intent; profile?: Profile }): readonly Row[] { return release.rows; }
export function auditSources(release: Release, now: string) {
  const at = Date.parse(instant.parse(now));
  return { release: release.id, shops: release.shops, claims: release.facts.map(fact => ({ id: fact.id, source: fact.source, observedAt: fact.observedAt, validUntil: fact.validUntil, applies: fact.applies, refreshOwner: fact.refreshOwner, freshness: Date.parse(fact.validUntil) <= at ? "expired" : "current", status: fact.status })) };
}
export function renderGuide({ release, request, format: _format }: { release: Release; request: GuideRequest; format: "prompt" | "resource" | "skill" | "tool" }) {
  const entry = release.shops.find(shop => shop.id === request.shop?.trim().toLowerCase());
  const facts = release.facts.filter(fact => fact.shop === entry?.id);
  const gap = entry?.status === "supported" ? null : entry?.status === "unsupported" ? entry.reason : "Shop facts unavailable: unknown shop; use the complete general method.";
  const method = [
    "# Scoat best-benefit", `Release: ${release.id}; GB / GBP; published ${release.publishedAt}.`,
    "Pinned historical knowledge, not a claim of current availability. Compare validity with today's time; expired or unknown facts cannot confirm an offer.",
    "Require source URL plus observed time for every finding. Resolve every slot as checked, person-skipped, or a named gap before finishing. Other sellers must have four distinct seller identities; never count aliases twice.",
    "Student yes is a declaration, never verification. Verify student eligibility first. Eligibility steps are not guaranteed offers. Seller-issued codes need primary proof; third-party codes remain untested until tested with evidence.",
    "Scoat computes totals on the server; never submit calculated totals. Only confirmed offers enter guaranteed pay-today. Keep cashback and points separate as back-later; budget uses pay-today only. Hunt calculation is unavailable until P03/P04.",
    `Shop: ${entry?.label ?? request.shop ?? "general"}. ${gap ? `Named gap: ${gap}` : "Use sourced facts below."}`,
    ...release.rows.map(row => `${row.place} [slots ${row.slots.join(", ")}]: ${row.label}. ${row.method} Evidence: ${row.proofRequired} Stop: ${row.stopRule}`),
    ...facts.map(fact => `${fact.id}: ${fact.claim}; ${fact.status}; ${fact.authority}; ${fact.applies}; source ${fact.source}; observed ${fact.observedAt}; valid until ${fact.validUntil}; owner ${fact.refreshOwner}; steps ${fact.requires.join(", ")}`)
  ].join("\n\n");
  return { release: release.id, method, rows: release.rows, facts, gap };
}
export function isOfficialSource({ release, seller, source, now }: { release: Release; seller: string; source: Url; now: string }): boolean {
  const at = Date.parse(instant.parse(now));
  return release.facts.some(fact => fact.shop === seller && fact.kind === "official-domain" && fact.status === "confirmed" && Date.parse(fact.validUntil) > at && Date.parse(fact.observedAt) <= at && fact.domain === new URL(source).hostname);
}
export class Knowledge {
  readonly directory: string;
  constructor(directory = fileURLToPath(new URL("../../knowledge/releases/", import.meta.url))) { this.directory = directory; }
  async publish(raw: unknown, now = new Date().toISOString()) {
    const release = validateRelease(raw, now);
    await mkdir(this.directory, { recursive: true });
    const target = path.join(this.directory, `${release.id}.json`);
    const bytes = JSON.stringify(release, null, 2) + "\n";
    const temporary = path.join(this.directory, `.${randomUUID()}.pending`);
    await writeFile(temporary, bytes, { flag: "wx" });
    try {
      try { await link(temporary, target); }
      catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
        if (JSON.stringify(await this.read({ release: release.id })) !== JSON.stringify(release)) throw new Error(`Immutable release ID ${release.id} already exists`);
      }
    } finally { await unlink(temporary); }
    return release.id;
  }
  async list(): Promise<Release[]> {
    return Promise.all((await readdir(this.directory)).filter(name => name.endsWith(".json")).map(name => this.read({ release: name.slice(0, -5) })));
  }
  async read({ release }: { release: string }): Promise<Release> {
    const name = key.parse(release);
    if (name === "latest") {
      const releases = await this.list();
      const latest: Release | undefined = releases.sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || a.id.localeCompare(b.id)).at(-1);
      if (!latest) throw new Error("No knowledge releases");
      return latest;
    }
    const raw: unknown = JSON.parse(await readFile(path.join(this.directory, `${name}.json`), "utf8"));
    const parsed = releaseSchema.parse(raw);
    if (parsed.id !== name) throw new Error("Release filename mismatch");
    return validateRelease(parsed, parsed.publishedAt);
  }
}
