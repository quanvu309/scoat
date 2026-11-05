import { createServer } from "node:http";
const server = createServer((req, res) => {
  if (req.url === "/healthz") { res.end("ready"); return; }
  if (req.url !== "/product") { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ fixture: "p01-v1", market: "GB", currency: "GBP", pence: 6000, seller: "fixture.invalid" }));
});
server.listen(8080, "0.0.0.0");
