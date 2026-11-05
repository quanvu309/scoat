import { Delivery } from "../dist/delivery/index.js";
import { FetchFailure } from "../dist/delivery/fetch.js";
export function fixtureDelivery(env = process.env) {
 const port = Number(env.SCOAT_FIXTURE_SELLER_PORT);
 return new Delivery({
  resolve: async host => { if (host !== "thepihut.com") throw new FetchFailure("blocked-destination"); return { address: "127.0.0.1", family: 4, port }; },
  mail: env.SCOAT_FIXTURE_MAIL_ORIGIN ? { origin: env.SCOAT_FIXTURE_MAIL_ORIGIN, apiKey: env.SCOAT_FIXTURE_MAIL_KEY } : null,
 });
}
