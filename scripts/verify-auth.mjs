import { withDatabase } from "./durable-database.mjs";
import { authLanes } from "./auth-lanes.mjs";
import { evidence } from "./auth-evidence.mjs";
const report = await evidence("verify");
const result = await withDatabase(authLanes);
await report.save("receipt.json", {
  ...report.identity,
  ...result,
  baseline: report.baseline,
  externalProvider: "UNTESTED",
  screenshots: "UNTESTED",
  video: "UNTESTED",
  independentReviews: "PENDING parent",
});
console.log(
  JSON.stringify({
    status: "PASS_LOCAL_ONLY",
    lanes: result.transcript.length,
    postgres: result.postgres,
    externalHosts: "UNTESTED",
    evidence: report.root,
  }),
);
