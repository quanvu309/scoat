import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp/index.js";

export function createHttpServer() {
  return createServer(async (req, res) => {
    if (req.url === "/healthz" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ready: true, phase: "P01", market: "GB", currency: "GBP", shopping: "unavailable", auth: "unavailable" }));
      return;
    }
    if (req.url !== "/mcp") { res.writeHead(404); res.end(); return; }
    const server = createMcpServer();
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true, enableDnsRebindingProtection: true, allowedHosts: [`localhost:${req.socket.localPort}`, `127.0.0.1:${req.socket.localPort}`], allowedOrigins: [`http://localhost:${req.socket.localPort}`, `http://127.0.0.1:${req.socket.localPort}`] });
    res.on("close", () => { void transport.close(); void server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res); }
    catch { if (!res.headersSent) res.writeHead(500); res.end(); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be an integer from 0 to 65535");
  const server = createHttpServer();
  server.requestTimeout = 15000;
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address !== "string" && process.send) process.send({ port: address.port });
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.close(); server.closeAllConnections(); });
}
