import { withDatabase } from "./durable-database.mjs";
import path from "node:path";
import {loginBrowser} from "./login-browser.mjs";
import { authLanes } from "./auth-lanes.mjs";
import { evidence } from "./auth-evidence.mjs";
const report = await evidence("verify");
const result = await withDatabase(async databaseUrl=>({...await authLanes(databaseUrl),browser:await loginBrowser(databaseUrl,process.env.SCOAT_LOGIN_SHOTS ?? path.join(report.root,"login-shots"))}));
await report.save("receipt.json", {
  ...report.identity,
  ...result,
  baseline: report.baseline,
  externalProvider: "UNTESTED",
  screenshots: result.browser.screenshots,
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
