import type { HuntView } from "./index.js";
import { z } from "zod";
import { row, publicSourceUrl } from "../knowledge/schema.js";
import { moneySchema, proofSchema, offerSchema, offerIdSchema, statusSchema, selectionSchema } from "./schema.js";
const text = z.string();
const rows = text.brand<"RowId">();
const nonempty = <T extends z.ZodType>(item: T) => z.tuple([item]).rest(item);
const step = z.enum(["verify-student", "join", "enrol", "activate", "apply-code", "request-price-match"]);
const line = z.strictObject({ offer: offerIdSchema, label: text, proof: proofSchema, status: statusSchema, value: z.union([moneySchema, z.strictObject({ points: z.number() }), z.strictObject({ text })]) });
const pay = z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("known"), amount: moneySchema, lines: nonempty(line) }), z.strictObject({ kind: z.literal("unknown"), gaps: nonempty(text), lines: z.array(line) })]);
const budget = z.discriminatedUnion("kind", [z.strictObject({kind:z.literal("within")}),z.strictObject({kind:z.literal("over"),by:moneySchema}),z.strictObject({kind:z.literal("unknown")}),z.strictObject({kind:z.literal("no-budget")})]);
const quote = z.strictObject({ id: text.brand<"QuoteId">(), seller: text, limitations: z.array(text), untested: z.array(offerSchema), selection: selectionSchema, guaranteed: pay, budget, conditional: z.array(z.strictObject({selection:selectionSchema,payToday:pay,requires:nonempty(step),budget,backLater:z.array(line),perks:z.array(line)})), backLater:z.array(line),perks:z.array(line) });
const completion = z.discriminatedUnion("kind", [z.strictObject({kind:z.literal("pending")}),z.strictObject({kind:z.literal("checked"),checked:text.optional(),proof:nonempty(proofSchema),offers:z.array(offerIdSchema)}),z.strictObject({kind:z.literal("gap"),reason:text})]);
export const huntViewSchema: z.ZodType<HuntView> = z.strictObject({
 hunt:text.brand<"HuntId">(),release:text.brand<"ReleaseId">(),
 intent:z.strictObject({product:z.discriminatedUnion("kind",[z.strictObject({kind:z.literal("url"),url:publicSourceUrl}),z.strictObject({kind:z.literal("description"),text})]),variant:text.nullable(),shop:text.nullable(),budget:moneySchema.nullable()}),
 profile:z.strictObject({student:z.enum(["yes","no","unknown"]),cards:z.array(text),memberships:z.array(text)}),
 rows:nonempty(z.strictObject({row,revision:z.number().int().nonnegative().brand<"RowRevision">(),skippedBy:z.literal("person").nullable(),slots:z.array(z.strictObject({slot:z.number().int().nonnegative(),seller:text.nullable(),completion}))})),
 offers:z.array(offerSchema),quotes:z.array(quote),gaps:z.array(text),progress:z.strictObject({resolved:z.number().int().nonnegative(),total:z.number().int().nonnegative()}),best:quote.nullable(),
 final:z.discriminatedUnion("kind",[z.strictObject({kind:z.literal("open")}),z.strictObject({kind:z.literal("finished"),quote:quote.nullable()})]),stopRequested:z.boolean(),ready:z.strictObject({url:publicSourceUrl,steps:z.array(step)}).nullable(),
 directive:z.discriminatedUnion("kind",[z.strictObject({kind:z.literal("continue"),rows:nonempty(rows)}),z.strictObject({kind:z.literal("name-gaps-and-finish"),rows:z.array(rows)}),z.strictObject({kind:z.literal("finish")}),z.strictObject({kind:z.literal("complete")})]),text
});
