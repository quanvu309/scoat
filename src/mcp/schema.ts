import { z } from "zod";

export function wireSchema(schema: z.ZodType, options: { io: "input" | "output" }) {
  return { ...z.toJSONSchema(schema, {
    target: "draft-7", ...options,
    override: ({ jsonSchema }) => {
      if (!Array.isArray(jsonSchema.items)) return;
      const item = jsonSchema.additionalItems;
      if (!item || typeof item !== "object" || jsonSchema.items.some(prefix => JSON.stringify(prefix) !== JSON.stringify(item))) throw new Error("Public arrays must have one homogeneous item schema");
      jsonSchema.items = item;
      delete jsonSchema.additionalItems;
    }
  }), type: "object" as const };
}
