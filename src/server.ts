import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp/index.js";
import { authenticatedDispatch } from "./mcp/authenticated.js";
import { createIssuer } from "./auth/issuer.js";
import { authSchema } from "./auth/schema.js";
import { PostgresHuntStore } from "./hunt/postgres.js";

export async function createHttpServer() {
  const configPath = process.env.SCOAT_AUTH_CONFIG;
  const store =
    configPath && process.env.DATABASE_URL
      ? new PostgresHuntStore({ databaseUrl: process.env.DATABASE_URL })
      : null;
  let auth: Awaited<ReturnType<typeof createIssuer>> | null = null;
  try {
    if (store && configPath) {
      await store.pool.query(authSchema);
      auth = await createIssuer(
        JSON.parse(await readFile(configPath, "utf8")),
        store.pool,
      );
    }
  } catch (error) {
    await store?.close();
    throw error;
  }
  const tls =
    process.env.SCOAT_TLS_KEY && process.env.SCOAT_TLS_CERT
      ? {
          key: await readFile(process.env.SCOAT_TLS_KEY),
          cert: await readFile(process.env.SCOAT_TLS_CERT),
        }
      : null;
  const handler: import("node:http").RequestListener = async (req, res) => {
    const allowedHosts = [
      `localhost:${req.socket.localPort}`,
      `127.0.0.1:${req.socket.localPort}`,
    ];
    const allowedOrigins = [
      `http://localhost:${req.socket.localPort}`,
      `http://127.0.0.1:${req.socket.localPort}`,
    ];
    if (auth) {
      allowedHosts.push(new URL(auth.issuer).host);
      allowedOrigins.push(auth.issuer);
    }
    if (
      !req.headers.host ||
      !allowedHosts.includes(req.headers.host) ||
      (req.headers.origin !== undefined &&
        !allowedOrigins.includes(req.headers.origin))
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    res.setHeader("cache-control", "no-store");
    if (req.url === "/healthz" && req.method === "GET") {
      res.writeHead(auth ? 200 : 503, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ready: !!auth,
          phase: "P05",
          auth: auth ? "configured" : "unavailable",
        }),
      );
      return;
    }
    if (auth && !("encrypted" in req.socket && req.socket.encrypted)) {
      res.writeHead(400);
      res.end("HTTPS required");
      return;
    }
    if (!auth || !store) {
      res.writeHead(503);
      res.end("Authentication is not configured");
      return;
    }
    if (Number(req.headers["content-length"] ?? 0) > 65536) {
      res.writeHead(413);
      res.end();
      return;
    }
    if (req.url !== "/mcp") {
      try {
        await auth.route(req, res);
      } catch {
        if (!res.headersSent) res.writeHead(400);
        res.end("Authentication request refused");
      }
      return;
    }
    const authStart = performance.now();
    let principal;
    try {
      principal = await auth.authenticate(req);
    } catch {
      res.writeHead(401, {
        "www-authenticate": `Bearer resource_metadata="${auth.issuer}/.well-known/oauth-protected-resource/mcp"`,
      });
      res.end();
      return;
    }
    const validationMs = performance.now() - authStart;
    const invoke = authenticatedDispatch(store, principal);
    const server = createMcpServer(async (name, raw) => {
      const start = performance.now();
      try {
        return await invoke(name, raw);
      } finally {
        if (!res.headersSent)
          res.setHeader(
            "server-timing",
            `validation;dur=${validationMs.toFixed(3)}, handler;dur=${(performance.now() - start).toFixed(3)}`,
          );
      }
    });
    const transport = new StreamableHTTPServerTransport({
      enableJsonResponse: true,
      enableDnsRebindingProtection: true,
      allowedHosts,
      allowedOrigins,
    });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      let body: unknown;
      if (req.method === "POST") {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += chunk.length;
          if (size > 65536) {
            res.writeHead(413);
            res.end();
            return;
          }
          chunks.push(chunk);
        }
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      }
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  };
  const http = tls ? createTlsServer(tls, handler) : createServer(handler);
  http.on("close", () => {
    void store?.close();
  });
  http.requestTimeout = 15000;
  return http;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("PORT must be an integer from 0 to 65535");
  const server = await createHttpServer();
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address !== "string" && process.send)
      process.send({ port: address.port });
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      server.close();
      server.closeAllConnections();
    });
}
