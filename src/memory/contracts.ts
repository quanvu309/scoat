import { z } from "zod";
import { huntViewSchema } from "../hunt/view-schema.js";
import { releaseSchema } from "../knowledge/schema.js";
import { observationSchema } from "../delivery/schema.js";
const id = z.string().min(1).max(128);
export const profileSchema = z.strictObject({ student: z.enum(["yes", "no", "unknown"]), cards: z.array(z.string().min(1).max(2000)).max(30), memberships: z.array(z.string().min(1).max(2000)).max(30) });
export const watchTargetPence = z.number().int().min(1).max(10000000);
export const watchCommandSchema = z.strictObject({ op: z.literal("watch"), requestKey: id, hunt: id, target: z.strictObject({ currency: z.literal("GBP"), pence: watchTargetPence }) });
export const memoryCommandSchema = z.discriminatedUnion("op", [
 z.strictObject({ op: z.literal("profile"), requestKey: id, profile: profileSchema }),
 z.strictObject({ op: z.literal("save"), requestKey: id, hunt: id }),
 watchCommandSchema,
 z.strictObject({ op: z.literal("unwatch"), requestKey: id, watch: z.uuid() }),
]);
export const memoryInput = z.discriminatedUnion("op", [
 ...memoryCommandSchema.options,
 z.strictObject({ op: z.literal("read"), collection: z.enum(["overview", "saved", "recent", "watches"]).default("overview"), after: z.string().max(2048).optional(), limit: z.number().int().min(1).max(20).default(20) }),
 z.strictObject({ op: z.literal("item"), item: z.uuid() }),
]);
export type MemoryCommand = z.infer<typeof memoryCommandSchema>;

export const watchRefusalReasons = ["service-unconfigured", "unfinished", "no-exact-supported-variant", "ambiguous-variant", "already-watching", "watch-limit", "invalid-target", "stale", "expired", "recipient-changed"] as const;
const count = z.number().int().nonnegative();
const instant = z.iso.datetime();
export const memoryOutcome = z.discriminatedUnion("kind", [
 z.strictObject({ kind: z.literal("profile"), revision: z.uuid() }),
 z.strictObject({ kind: z.literal("saved"), item: z.uuid() }),
 z.strictObject({ kind: z.literal("unfinished") }),
 z.strictObject({ kind: z.literal("watching"), watch: z.uuid() }),
 z.strictObject({ kind: z.literal("watch-unavailable"), reason: z.enum(watchRefusalReasons), explanation: z.string(), limits: z.strictObject({ active: count, seller: z.string() }) }),
 z.strictObject({ kind: z.literal("unwatched"), watch: z.uuid(), wasActive: z.boolean(), jobs: count, acceptedAlerts: count, mayStillArrive: count }),
]);
const proposal = z.union([
 z.strictObject({ kind: z.literal("confirmation-required"), command: z.discriminatedUnion("op", [memoryCommandSchema.options[0], memoryCommandSchema.options[1]]), url: z.url({ protocol: /^https$/ }) }),
 z.strictObject({ kind: z.literal("confirmation-required"), command: watchCommandSchema, url: z.url({ protocol: /^https$/ }), proposedTarget: watchCommandSchema.shape.target, baseline: z.string(), limits: z.strictObject({ active: count, days: count }) }),
]);
export const memoryValue = z.union([
 memoryOutcome, proposal,
 z.strictObject({ kind: z.literal("overview"), profile: z.strictObject({ revision: z.uuid(), value: profileSchema }).nullable(), counts: z.strictObject({ saved: count, hunts: count }) }),
 z.strictObject({ kind: z.literal("saved"), items: z.array(z.strictObject({ id: z.uuid(), hunt: id, saved_at: instant })).max(20), next: z.string().nullable() }),
 z.strictObject({ kind: z.literal("recent"), items: z.array(z.strictObject({ id, started_at: instant, state: z.enum(["open", "finished"]) })).max(20), next: z.string().nullable() }),
 z.strictObject({ kind: z.literal("item"), item: z.strictObject({ id: z.uuid(), hunt: id, snapshot: huntViewSchema, release: releaseSchema, digest: z.string(), format: z.literal(1), saved_at: instant }) }),
 z.strictObject({ kind: z.literal("watches"), limits: z.strictObject({ active: count, days: count, schedule: z.literal("daily 00:05 UTC"), fetchSeconds: count, retryHorizonHours: count }), items: z.array(z.strictObject({
  watch: z.uuid(), hunt: id, status: z.enum(["active", "cancelled", "expired"]), alertsCurrentRecipient: z.boolean(), expiresAt: instant,
  item: z.strictObject({ seller: z.string(), url: z.url({ protocol: /^https$/ }), sku: z.string(), variant: z.number().int() }),
  basis: z.strictObject({ currency: z.literal("GBP"), delivery: z.literal("UK Royal Mail 1st Class, quantity one, non-member, non-lithium"), digest: z.string() }),
  baseline: z.strictObject({ pence: count, observedAt: instant, source: z.literal("public observation at confirmation") }), target: z.strictObject({ pence: watchTargetPence }),
  lastObservation: z.strictObject({ day: z.string(), observation: observationSchema }).nullable(),
  alerts: z.array(z.strictObject({ day: z.string(), pence: count.nullable(), state: z.enum(["pending", "submitting", "accepted", "rejected", "cancelled", "unconfirmed"]), attempts: count, reason: z.string().nullable() })), mayStillArrive: count,
 })).max(20) }),
]);
export const memoryRefusalCode = z.enum(["invalid-cursor", "missing-item", "key-reused", "session-mismatch", "expired"]);
export class MemoryRefusal extends Error {
 constructor(readonly code: z.infer<typeof memoryRefusalCode>) { super("Memory refused: " + code); }
}
