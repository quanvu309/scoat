import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {checkLoginCodes} from "../scripts/check-login.mjs";
const paths=["src/auth/login.ts","src/auth/issuer.ts","src/auth/erasure.ts","src/auth/flows.ts","src/auth/config.ts","package.json"];
const sources=paths.map(file=>readFileSync(file,"utf8"));
test("login enforcement rejects guessable, unbound, replayable, unmailed, over-budget and unerased credentials",()=>{
 assert.doesNotThrow(()=>checkLoginCodes(...sources));
 for(const [index,before,after] of [[0,'createHmac("sha256", this.key)','createHash("sha256")'],[0,'randomInt(0, 1000000)','123456'],[0,'attempts<5','attempts<50'],[0,'accepted AND',''],[0,'browser=$2 AND purpose=$3','true'],[0,'DELETE FROM login_challenges WHERE state=$1','SELECT state FROM login_challenges WHERE state=$1'],[0,'if (!delivery.canSubmit) throw new LoginRefused','if (false) throw new LoginRefused'],[0,'limit: 80','limit: 100'],[0,'limit: 3','limit: 300'],[0,'limit: 10','limit: 1000'],[2,'DELETE FROM login_addresses','SELECT * FROM login_addresses'],[2,'INSERT INTO login_suppression','SELECT * FROM login_suppression']]) {
  assert.ok(sources[index].includes(before));
  const mutated=sources.map((source,i)=>i===index?source.replace(before,after):source);
  assert.throws(()=>checkLoginCodes(...mutated));
 }
});
