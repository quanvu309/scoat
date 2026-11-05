import { createHttpServer } from "../dist/server.js";
import { fixtureDelivery } from "./watch-delivery.mjs";
import { fixtureLoginDelivery } from "./auth-delivery.mjs";
const server = await createHttpServer({ delivery: fixtureDelivery(), loginDelivery: fixtureLoginDelivery() });
server.listen(Number(process.env.PORT), "127.0.0.1", () => process.send?.({ port: server.address().port }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.close(); server.closeAllConnections(); });
