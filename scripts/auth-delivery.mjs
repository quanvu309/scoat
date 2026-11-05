import { Delivery } from "../dist/delivery/index.js";
export function fixtureLoginDelivery() {
 return new Delivery({ resolve: async () => { throw new Error("No public fetch in login fixture"); }, mail: { origin: process.env.SCOAT_FIXTURE_LOGIN_MAIL, apiKey: "fixture-only" } });
}
