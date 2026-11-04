export type Config = Readonly<{
  publicOrigin: string; port: number; databaseUrl: string;
  oauth: { readonly issuer: string; readonly audience: string };
  signingKeyRef: string; mailKeyRef: string;
}>;
/** Sole package entry. Build exports only "."; forbid external deep imports and cross-owner store imports. */
export function start(config: Config): Promise<{ close(): Promise<void> }> {
  // TODO Wire Profiles -> Hunts -> Memory without a service cycle; share immutable Knowledge/Delivery.
  // TODO Construct SDK McpServer + StreamableHTTP transport with OAuth middleware and call mcp.mount.
  // TODO Publish OAuth protected-resource discovery/challenges for configured authorization issuer.
  // TODO Serve /mcp, /r/:capability and /unsubscribe/:capability; no consumer application or checkout.
  // TODO Durable daily scheduler invokes Memory.recheckDue; outbox/erasure workers resume on boot.
  // TODO App resource is bundled from mcp/card.ts with restrictive MCP Apps CSP and declared domains.
  // TODO Parse config into branded runtime values once, resolve secrets server-side, redact private logs.
  throw new Error("not implemented");
}
