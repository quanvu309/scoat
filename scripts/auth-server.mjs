import { createHttpServer } from "../dist/server.js";
import { fixtureLoginDelivery } from "./auth-delivery.mjs";
const server = await createHttpServer({ loginDelivery: fixtureLoginDelivery() });
server.listen(Number(process.env.PORT), "127.0.0.1", () => process.send?.({ port: server.address().port }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.close(); server.closeAllConnections(); });
