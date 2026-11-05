import { z } from "zod";
const id = z.string().min(1).max(128);
export const profileSchema = z.strictObject({ student: z.enum(["yes", "no", "unknown"]), cards: z.array(z.string().min(1).max(2000)).max(30), memberships: z.array(z.string().min(1).max(2000)).max(30) });
export const memoryCommandSchema = z.discriminatedUnion("op", [
 z.strictObject({ op: z.literal("profile"), requestKey: id, profile: profileSchema }),
 z.strictObject({ op: z.literal("save"), requestKey: id, hunt: id }),
]);
export const memoryInput = z.discriminatedUnion("op", [
 ...memoryCommandSchema.options,
 z.strictObject({ op: z.literal("read"), collection: z.enum(["overview", "saved", "recent"]).default("overview"), after: z.string().max(2048).optional(), limit: z.number().int().min(1).max(20).default(20) }),
 z.strictObject({ op: z.literal("item"), item: z.uuid() }),
]);
export type MemoryCommand = z.infer<typeof memoryCommandSchema>;
