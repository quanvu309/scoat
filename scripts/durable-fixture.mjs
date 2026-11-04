import { ControlCodec } from "../dist/controls/codec.js";
import { durableSchema } from "../dist/db/schema.js";
import { eraseAccount } from "../dist/accounts/erasure.js";
import { randomBytes, randomUUID } from "node:crypto";
import { PostgresHuntStore } from "../dist/hunt/postgres.js";
import { Hunts } from "../dist/hunt/index.js";
import { officialRelease, intent, offer, proof, now } from "../test/fixtures/hunt.mjs";
export { intent, offer, proof, now };
export function gate() { let resolve; const promise = new Promise((r,reject) => { const timer=setTimeout(()=>reject(new Error("Harness barrier timeout")),10000); timer.unref(); resolve=value=>{clearTimeout(timer);r(value);}; }); return { promise, resolve }; }
export async function fixture(databaseUrl) {
  const hooks = {};
  const store = new PostgresHuntStore({ databaseUrl,hooks });
  try {
  await store.pool.query(await durableSchema());
  const scope = await store.createAccount("fixture-" + randomUUID());
  const agent = { ...scope, kind:"agent",client:"compiled" };
  const codec=new ControlCodec({version:1,keyId:"fixture",secret:randomBytes(32).toString("hex")});
  const confirmations=new Map();
  const controlKey=key=>confirmations.get(key)?.key ?? key;
  const deps = { store, knowledge:{ read:async () => officialRelease() } };
  const hunts = new Hunts(deps);
  const run = (request, actor=agent) => hunts.run({ agent:actor,request,now });
  const start = async () => { const result = await run({ op:"start",requestKey:randomUUID(),intent,profile:null }); if (!result.ok) throw new Error(JSON.stringify(result)); return result.value.view; };
  const record = (view,index=0,fields={}) => ({ op:"record",requestKey:randomUUID(),hunt:view.hunt,row:view.rows[index].row.id,slot:view.rows[index].slots[0].slot,expected:view.rows[index].revision,outcome:{ kind:"gap",reason:"Synthetic unavailable" },...fields });
  const control = async (view,action,requestKey=randomUUID()) => {
    if(!confirmations.has(requestKey)) {
      const browser=randomBytes(32).toString("base64url");
      const clock=Number((await store.pool.query("SELECT extract(epoch FROM clock_timestamp())*1000 AS ms")).rows[0].ms);
      const token=codec.issue({...scope,hunt:view.hunt,action},browser,clock);
      confirmations.set(requestKey,{key:"person:"+token.nonce,confirmed:codec.verify(token.token,browser,action)});
    }
    return hunts.control({confirmed:confirmations.get(requestKey).confirmed});
  };
  const erase = async ({account}) => store.transact({...account,hunt:null,accountFence:"exclusive",huntFence:"exclusive",rows:[]},async tx=>{
    const status=randomUUID();
    await tx.client.query("INSERT INTO erase_status(digest,operation) VALUES($1,$2)",[status,randomUUID()]);
    return eraseAccount(tx.client,account,randomBytes(32).toString("hex"),"fixture",status);
  });
  return { erase,store,hooks,scope,agent,controlKey,run,start,record,control,hunts,deps };
  } catch (error) { await store.close(); throw error; }
}
