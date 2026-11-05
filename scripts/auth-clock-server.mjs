import { createHttpServer } from "../dist/server.js";
const now = Date.now.bind(Date);
let offset = 0;
Date.now = () => now() + offset;
process.on("message", message => {
 if (!Number.isSafeInteger(message?.advanceSeconds) || message.advanceSeconds < 0) throw new Error("Invalid fixture clock advance");
 offset += message.advanceSeconds * 1000;
 process.send?.({ advanced: true });
});
const server = await createHttpServer();
server.listen(Number(process.env.PORT), "127.0.0.1", () => process.send?.({ ready: true }));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { server.close(); server.closeAllConnections(); process.disconnect(); });
