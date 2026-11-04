import { z } from "zod";
import { huntViewSchema } from "../hunt/view-schema.js";
const https = z.url({ protocol: /^https$/ });
export const controlsSchema = z.strictObject({hub:https,stop:https,skip:z.array(z.strictObject({row:z.string(),url:https})),watch:z.strictObject({available:z.literal(false),reason:z.string()})});
export const snapshotSchema = z.strictObject({ok:z.literal(true),value:z.strictObject({view:huntViewSchema}),controls:controlsSchema.optional()});
export const capabilitySchema = z.strictObject({grant:z.string().min(1),expiresAt:z.iso.datetime()});
export const cardFailureSchema = z.strictObject({code:z.enum(["expired","revoked","transient"])});
export const toolReplySchema = z.strictObject({structuredContent:z.unknown().optional(),_meta:z.record(z.string(),z.unknown()).optional(),isError:z.boolean().optional(),content:z.array(z.unknown()).optional()});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export class CardFailure extends Error {
 constructor(readonly code: z.infer<typeof cardFailureSchema>["code"]) { super(code); }
}
