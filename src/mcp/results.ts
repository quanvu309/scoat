import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Failure } from "../domain.js";
import { toolCatalog } from "./index.js";
import type { ToolCall, ToolName } from "./index.js";
import { inputIssue, refused } from "./outputs.js";
import type { Repair } from "./outputs.js";

export class ContractBreach extends Error {
  constructor() { super("Scoat result failed its published contract"); }
}
export function refusal(code: z.infer<typeof refused>["error"]["code"], message: string, next: string, repair: Repair) {
  const structuredContent = { ok: false as const, error: { code, message, next, repair } };
  return { isError: true, content: [{ type: "text" as const, text: message + " " + next }], structuredContent };
}
export function conform(name: ToolName, result: CallToolResult): CallToolResult {
  const output = toolCatalog[name].output;
  if (!result.structuredContent) {
    if (output) throw new ContractBreach();
    return result;
  }
  const wire: unknown = JSON.parse(JSON.stringify(result.structuredContent));
  if (output && (!output.safeParse(wire).success || (result.isError === true) !== (result.structuredContent.ok === false))) throw new ContractBreach();
  return { ...result, content: [...result.content, { type: "text", text: JSON.stringify(wire) }], structuredContent: JSON.parse(JSON.stringify(wire)) };
}
export function refuseInput(name: ToolName, error: z.ZodError): CallToolResult {
  const input = toolCatalog[name].input;
  const operations = "options" in input ? input.options.map(option => option.shape.op.value) : [];
  const path = (parts: PropertyKey[]) => parts.map(part => /^[A-Za-z0-9_-]{1,64}$/.test(String(part)) ? String(part) : "<field>").join(".").slice(0,200);
  const issues = error.issues.flatMap<z.infer<typeof inputIssue>>(issue => {
    if (issue.code === "unrecognized_keys") return issue.keys.map(key => ({ path: path([...issue.path, key]), problem: "unknown-field" as const }));
    const problem: z.infer<typeof inputIssue>["problem"] = issue.code === "invalid_union" && issue.path.at(-1) === "op" ? "unknown-operation" : issue.code === "invalid_type" ? (issue.input === undefined ? "missing" : "wrong-type") : issue.code === "too_small" || issue.code === "too_big" ? "out-of-range" : "invalid-value";
    return [{ path: path(issue.path), problem }];
  }).slice(0,10);
  return refusal("invalid-input", "Invalid tool input; use the strict registry schema.", "Correct the listed fields and repeat the call.", { kind: "fix-arguments", operations, issues });
}
export function repairFor(call: Extract<ToolCall, { name: "scoat_hunt" }>, failure: Failure): Repair {
  if (failure.code === "missing") return { kind: "list-hunts", call: { tool: "scoat_hunt", arguments: { op: "list" } } };
  if (failure.code === "key-reused") return { kind: "repeat-original-or-new-key" };
  if ("hunt" in call.input) return { kind: "read-hunt", call: { tool: "scoat_hunt", arguments: { op: "read", hunt: call.input.hunt } } };
  return { kind: "none" };
}
