import { z } from "zod";
import { failureCodes } from "../domain.js";
import { huntViewSchema } from "../hunt/view-schema.js";
import { row, releaseSchema } from "../knowledge/schema.js";

const https = z.url({ protocol: /^https$/ });
const huntId = z.string().min(1).max(128);
export const controls = z.strictObject({
  hub: https, stop: https,
  skip: z.array(z.strictObject({ row: z.string(), url: https })),
  watch: z.discriminatedUnion("available", [
    z.strictObject({ available: z.literal(true), url: https }),
    z.strictObject({ available: z.literal(false), reason: z.string() }),
  ]),
});
export const inputIssue = z.strictObject({
  path: z.string().max(200),
  problem: z.enum(["unknown-field", "missing", "wrong-type", "out-of-range", "invalid-value", "unknown-operation"]),
});
export const repair = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("read-hunt"), call: z.strictObject({ tool: z.literal("scoat_hunt"), arguments: z.strictObject({ op: z.literal("read"), hunt: huntId }) }) }),
  z.strictObject({ kind: z.literal("list-hunts"), call: z.strictObject({ tool: z.literal("scoat_hunt"), arguments: z.strictObject({ op: z.literal("list") }) }) }),
  z.strictObject({ kind: z.literal("fix-arguments"), operations: z.array(z.string()), issues: z.array(inputIssue).min(1).max(10) }),
  z.strictObject({ kind: z.literal("repeat-original-or-new-key") }),
  z.strictObject({ kind: z.literal("reconnect-with-write-access") }),
  z.strictObject({ kind: z.literal("none") }),
]);
export const failureCode = z.enum([...failureCodes, "invalid-input", "scope-required", "unavailable"]);
export const refused = z.strictObject({ ok: z.literal(false), error: z.strictObject({ code: failureCode, message: z.string(), next: z.string(), repair }) });
export const guideOutput = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), market: z.literal("GB"), currency: z.literal("GBP"), release: z.string(), method: z.string(), rows: z.array(row), facts: releaseSchema.shape.facts, gap: z.string().nullable() }),
  refused,
]);
const viewValue = z.strictObject({ view: huntViewSchema });
const huntSuccess = z.strictObject({ ok: z.literal(true), value: z.union([viewValue, z.strictObject({ hunts: z.array(huntViewSchema).max(20), next: huntId.nullable() })]), controls: controls.optional() });
export const huntSnapshot = huntSuccess.extend({ value: viewValue });
export const huntOutput = z.discriminatedUnion("ok", [huntSuccess, refused.extend({ current: huntViewSchema.optional() })]);
export type Repair = z.infer<typeof repair>;
