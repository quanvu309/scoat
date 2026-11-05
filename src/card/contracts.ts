import { z } from "zod";
import { huntSnapshot as snapshotSchema } from "../mcp/outputs.js";
export { controls as controlsSchema, huntSnapshot as snapshotSchema } from "../mcp/outputs.js";
export const capabilitySchema = z.strictObject({grant:z.string().min(1),expiresAt:z.iso.datetime()});
export const cardFailureSchema = z.strictObject({code:z.enum(["expired","revoked","transient"])});
export const toolReplySchema = z.strictObject({structuredContent:z.unknown().optional(),_meta:z.record(z.string(),z.unknown()).optional(),isError:z.boolean().optional(),content:z.array(z.unknown()).optional()});
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export class CardFailure extends Error {
 constructor(readonly code: z.infer<typeof cardFailureSchema>["code"]) { super(code); }
}
