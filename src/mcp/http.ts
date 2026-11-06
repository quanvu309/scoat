import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { failureCode } from "./outputs.js";

export const modernProtocol = "2026-07-28";
export const supportedProtocols = [modernProtocol, ...SUPPORTED_PROTOCOL_VERSIONS];
export const serverInfo = { name: "scoat-foundation", version: "0.1.0" };
const object = z.record(z.string(), z.unknown());
const methods = new Set(["initialize", "notifications/initialized", "ping", "server/discover", "tools/list", "tools/call", "resources/list", "resources/templates/list", "resources/read", "prompts/list", "prompts/get"]);
const messages = new Map([
  [-32700, "Parse error"], [-32600, "Invalid Request"], [-32601, "Method not found"],
  [-32602, "Invalid params"], [-32603, "Internal error"], [-32000, "Transport refused"],
  [-32020, "HeaderMismatch"], [-32022, "UnsupportedProtocolVersionError"],
]);
let windowStart = 0;
let entries = 0;

function record(value: unknown): Record<string, unknown> {
  const parsed = object.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function headerValue(value: string): string {
  return /^[\x20-\x7e]+$/.test(value) && value.trim() === value && !/^=\?base64\?.*\?=$/.test(value)
    ? value : "=?base64?" + Buffer.from(value).toString("base64") + "?=";
}

export function logMcpResponse(protocol: string | null, body: unknown, status: number, reply: unknown = null, write: (line: string) => void = line => { process.stderr.write(line); }): void {
  const request = record(body), envelope = record(reply), result = record(envelope.result), error = record(envelope.error);
  if (status < 400 && !(request.method === "tools/call" && typeof result.isError === "boolean")) return;
  const now = Date.now();
  if (now - windowStart >= 60000) { windowStart = now; entries = 0; }
  if (entries++ >= 100) return;
  const code = typeof error.code === "number" && messages.has(error.code) ? error.code : null;
  const toolCode = failureCode.safeParse(record(record(result.structuredContent).error).code);
  write(JSON.stringify({
    event: status >= 400 ? "mcp_http_refused" : "mcp_tool_result",
    method: typeof request.method === "string" && methods.has(request.method) ? request.method : "unknown",
    protocol: protocol === null ? "absent" : /^\d{4}-\d{2}-\d{2}$/.test(protocol) ? protocol : "invalid",
    status, code, message: code === null ? status >= 400 ? "Response refused" : result.isError ? "Tool reported an error" : "Tool completed" : messages.get(code),
    ...(toolCode.success ? { toolCode: toolCode.data } : {}),
    ...(typeof result.isError === "boolean" ? { isError: result.isError } : {}),
  }) + "\n");
}

export async function observeMcpResponse(request: Request, body: unknown, response: Response): Promise<Response> {
  if (response.status >= 400 || record(body).method === "tools/call") {
    const reply: unknown = await response.clone().json().catch(() => null);
    logMcpResponse(request.headers.get("mcp-protocol-version"), body, response.status, reply);
  }
  return response;
}

async function respond(request: Request, body: unknown, handle: (request: Request) => Promise<Response>): Promise<Response> {
  const rpc = record(body), params = record(rpc.params), meta = record(params._meta);
  const version = request.headers.get("mcp-protocol-version");
  const modern = version === modernProtocol || meta["io.modelcontextprotocol/protocolVersion"] !== undefined;
  const refuse = (code: number, data?: unknown) => Response.json({ jsonrpc: "2.0", id: typeof rpc.id === "string" || typeof rpc.id === "number" ? rpc.id : null, error: { code, message: messages.get(code), ...(data === undefined ? {} : { data }) } }, { status: 400 });
  if (!modern) return handle(request);
  if (request.method !== "POST" || rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string" || !(typeof rpc.id === "string" || typeof rpc.id === "number")) return refuse(-32600);
  const name = rpc.method === "resources/read" ? params.uri : ["tools/call", "prompts/get"].includes(rpc.method) ? params.name : undefined;
  if (version !== meta["io.modelcontextprotocol/protocolVersion"] || request.headers.get("mcp-method") !== headerValue(rpc.method) || (name !== undefined && (typeof name !== "string" || request.headers.get("mcp-name") !== headerValue(name)))) return refuse(-32020);
  if (version !== modernProtocol) return refuse(-32022, { supported: supportedProtocols, requested: version });
  if (!object.safeParse(meta["io.modelcontextprotocol/clientCapabilities"]).success) return refuse(-32602);
  const headers = new Headers(request.headers);
  headers.set("mcp-protocol-version", "2025-11-25");
  if (headers.get("accept")?.includes("application/json")) headers.set("accept", "application/json, text/event-stream");
  const response = await handle(new Request(request.url, { method: request.method, headers, body: JSON.stringify(body) }));
  if (!response.ok || response.status === 202) return response;
  const envelope = record(await response.json());
  if (record(envelope.error).code === -32601) return Response.json(envelope, { status: 404, headers: response.headers });
  if (envelope.result !== undefined) {
    const result = record(envelope.result);
    envelope.result = { ...result, resultType: "complete", _meta: { ...record(result._meta), "io.modelcontextprotocol/serverInfo": serverInfo } };
  }
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-length");
  return Response.json(envelope, { status: response.status, headers: responseHeaders });
}

export async function handleMcpRequest(request: Request, body: unknown, handle: (request: Request) => Promise<Response>): Promise<Response> {
  return observeMcpResponse(request, body, await respond(request, body, handle));
}
