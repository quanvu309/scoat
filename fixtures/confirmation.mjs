import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
export async function confirmationFixture() {
  const sessionA = randomUUID();
  const sessionB = randomUUID();
  const nonce = randomUUID();
  let mutations = 0;
  const server = createServer((req, res) => {
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
    if (req.headers.cookie !== `fixture_session=${sessionA}` || req.headers["x-fixture-nonce"] !== nonce) { res.writeHead(403); res.end(); return; }
    mutations += 1;
    res.writeHead(204); res.end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, sessionA, sessionB, nonce, mutations: () => mutations, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}
