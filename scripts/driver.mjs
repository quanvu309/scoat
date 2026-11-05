import { fork } from "node:child_process";
import { once } from "node:events";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function launch() {
  const child = fork(new URL("../test/fixtures/legacy-server.mjs", import.meta.url), [], { execArgv: [], env: { ...process.env, PORT: "0" }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const logs = [];
  child.stdout.on("data", data => logs.push(data.toString()));
  child.stderr.on("data", data => logs.push(data.toString()));
  const startup = new Promise((resolve, reject) => {
    child.once("message", resolve);
    child.once("exit", code => reject(new Error(`Server exited during launch: ${code}: ${logs.join("")}`)));
    child.once("error", reject);
  });
  const timer = setTimeout(() => child.kill("SIGTERM"), 10000);
  let address;
  try { address = await startup; } finally { clearTimeout(timer); }
  const base = `http://127.0.0.1:${address.port}`;
  return { base, logs, async close() { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; } };
}
export async function connect(base) {
  const client = new Client({ name: "scoat-p01-driver", version: "1.0.0" });
  try { await client.connect(new StreamableHTTPClientTransport(new URL("/mcp", base))); }
  catch (error) { await client.close(); throw error; }
  return client;
}
export async function doctor() {
  const server = await launch();
  try { return await (await fetch(`${server.base}/healthz`)).json(); } finally { await server.close(); }
}
