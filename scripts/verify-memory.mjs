import { withDatabase } from "./durable-database.mjs";
import { memoryLanes } from "./memory-lanes.mjs";
import { erasureLanes } from "./erasure-lanes.mjs";
import { lifecycleLanes } from "./lifecycle-lanes.mjs";
import { memoryEvidence } from "./memory-evidence.mjs";
const report = await memoryEvidence("verify");
const result = await withDatabase(async url => ({memory:await memoryLanes(url),erasure:await erasureLanes(url),lifecycle:await lifecycleLanes(url)}));
await report.save("receipt.json",{...report.identity,...result,baseline:report.baseline,externalProvider:"UNTESTED",realHosts:"UNTESTED",modelAgentLanes:"UNTESTED",screenshots:"UNTESTED",video:"UNTESTED",fixedTwoVcpu:"UNTESTED",p03SharedHost:"INCONCLUSIVE: 1056 ms fail and 947 ms isolated pass at the same earlier SHA; causality unproven"});
console.log(JSON.stringify({status:"PASS_LOCAL_ONLY",evidence:report.root,head:report.identity.head,externalAcceptance:"UNTESTED"}));
