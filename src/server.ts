import { ControlCodec } from "./controls/codec.js";
import { Hunts } from "./hunt/index.js";
import { Knowledge } from "./knowledge/index.js";
import { createServer } from "node:http";
import { createServer as createTlsServer } from "node:https";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./mcp/index.js";
import { authenticatedDispatch } from "./mcp/authenticated.js";
import { createIssuer, InvalidCredential } from "./auth/issuer.js";
import { lifecycleSchema } from "./accounts/schema.js";
import { maintainAccounts } from "./accounts/maintenance.js";
import { memorySchema } from "./memory/schema.js";
import { authSchema } from "./auth/schema.js";
import { PostgresHuntStore } from "./hunt/postgres.js";
import { watchSchema } from "./memory/watch-schema.js";
import { Watches, watchConfigSchema } from "./memory/watches.js";
import { Delivery } from "./delivery/index.js";
import { admit, begin, inspect, LineageRefused, type RefusalReason } from "./db/lineage.js";
import { verifyRelease } from "./release.js";
import { health } from "./readiness.js";
import { z } from "zod";

const listenHostSchema = z.union([z.ipv4(), z.ipv6()]);

export function listenHost(value: string | undefined): string | null {
  const parsed = listenHostSchema.safeParse(value ?? "127.0.0.1");
  return parsed.success ? parsed.data : null;
}

async function lineageStatus(pool: import("pg").Pool): Promise<string> {
  try {
    const state = await inspect(pool);
    return state.kind === "unadmitted" ? state.reason : state.kind;
  } catch {
    process.stderr.write(JSON.stringify({ event: "lineage_unavailable" }) + "\n");
    return "database-unavailable";
  }
}

function refuseLineage(res: import("node:http").ServerResponse, reason: RefusalReason): void {
  process.stderr.write(JSON.stringify({ event: "lineage_refused", reason }) + "\n");
  if (!res.headersSent) res.writeHead(503, { "content-type": "application/json" });
  res.end(JSON.stringify({ error: "service_unavailable", lineage: reason }));
}

export async function createHttpServer(options: Readonly<{ delivery?: Delivery }> = {}) {
  const release = await verifyRelease();
  const configPath = process.env.SCOAT_AUTH_CONFIG;
  const store =
    configPath && process.env.DATABASE_URL
      ? new PostgresHuntStore({ databaseUrl: process.env.DATABASE_URL })
      : null;
  let codec: ControlCodec | undefined;
  let auth: Awaited<ReturnType<typeof createIssuer>> | null = null;
  let watches: Watches | undefined;
  try {
    if (store && configPath && release.kind === "verified") {
      const admitted = await admit(store.pool, "server");
      const installation = await store.pool.connect();
      try {
        await begin(installation);
        await installation.query("SELECT pg_advisory_xact_lock(80106)");
        await installation.query(authSchema + memorySchema + lifecycleSchema + watchSchema);
        await installation.query("COMMIT");
      } catch(error) { await installation.query("ROLLBACK"); throw error; } finally { installation.release(); }
      await maintainAccounts(store.pool);
      const controlPath=process.env.SCOAT_CONTROL_CONFIG;
      if(controlPath) codec=new ControlCodec(JSON.parse(await readFile(controlPath,"utf8")));
      const hunts=new Hunts({store,knowledge:new Knowledge(process.env.SCOAT_KNOWLEDGE_DIRECTORY)});
      watches = process.env.SCOAT_WATCH_CONFIG ? new Watches({ admitted, delivery: options.delivery ?? Delivery.production(null), config: watchConfigSchema.parse(JSON.parse(await readFile(process.env.SCOAT_WATCH_CONFIG, "utf8"))), enqueue: null }) : undefined;
      auth = await createIssuer(
        JSON.parse(await readFile(configPath, "utf8")),
        store.pool,
        codec ? {codec,hunts} : undefined,
        watches,
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
      ...(auth ? [new URL(auth.issuer).host] : []),
    ];
    const allowedOrigins = [
      `http://localhost:${req.socket.localPort}`,
      `http://127.0.0.1:${req.socket.localPort}`,
      ...(auth ? [auth.issuer] : []),
    ];
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
      const report = await health(release, store?.pool ?? null, auth !== null, tls !== null);
      res.writeHead(report.ready ? 200 : 503, { "content-type": "application/json" });
      res.end(JSON.stringify(report));
      return;
    }
    if (release.kind !== "verified") {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "service_unavailable", artifact: release.reason }));
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
    const lineage = await lineageStatus(store.pool);
    if (lineage !== "admitted") {
      res.writeHead(503, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "service_unavailable", lineage }));
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
      } catch (error) {
        if (error instanceof LineageRefused) {
          refuseLineage(res, error.reason);
          return;
        }
        process.stderr.write(JSON.stringify({ event: "authentication_request_refused" }) + "\n");
        if (!res.headersSent) res.writeHead(400);
        res.end("Authentication request refused");
      }
      return;
    }
    const authStart = performance.now();
    let principal;
    try {
      principal = await auth.authenticate(req);
    } catch (error) {
      if (error instanceof LineageRefused) {
        refuseLineage(res, error.reason);
        return;
      }
      if (!(error instanceof InvalidCredential)) {
        process.stderr.write(JSON.stringify({ event: "authentication_unavailable" }) + "\n");
        res.writeHead(503);
        res.end("Authentication temporarily unavailable");
        return;
      }
      res.writeHead(401, {
        "www-authenticate": `Bearer resource_metadata="${auth.issuer}/.well-known/oauth-protected-resource/mcp"`,
      });
      res.end();
      return;
    }
    const validationMs = performance.now() - authStart;
    const invoke = authenticatedDispatch(store, principal, auth.issuer, codec?.links.bind(codec), watches?.available === true);
    const server = createMcpServer(async (call) => {
      const start = performance.now();
      try {
        return await invoke(call);
      } catch (error) {
        if (error instanceof LineageRefused) refuseLineage(res, error.reason);
        throw error;
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
    } catch (error) {
      if (error instanceof LineageRefused) {
        refuseLineage(res, error.reason);
        return;
      }
      process.stderr.write(JSON.stringify({ event: "mcp_request_refused" }) + "\n");
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
  const host = listenHost(process.env.SCOAT_LISTEN_HOST);
  if (host === null) {
    process.stderr.write(JSON.stringify({ event: "configuration_refused", reason: "listen-host-not-ip-literal" }) + "\n");
    process.exit(78);
  }
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("PORT must be an integer from 0 to 65535");
  let server: Awaited<ReturnType<typeof createHttpServer>>;
  try {
    server = await createHttpServer();
  } catch (error) {
    if (!(error instanceof LineageRefused)) throw error;
    process.stderr.write(JSON.stringify({ event: "lineage_refused", reason: error.reason }) + "\n");
    process.exit(78);
  }
  server.listen(port, host, () => {
    const address = server.address();
    if (address && typeof address !== "string" && process.send)
      process.send({ port: address.port, host: address.address });
  });
  for (const signal of ["SIGINT", "SIGTERM"])
    process.on(signal, () => {
      server.close();
      server.closeAllConnections();
    });
}
