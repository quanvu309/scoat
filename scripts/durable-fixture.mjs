import { durableSchema } from "../dist/db/schema.js";
import { randomUUID } from "node:crypto";
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
  const person = { ...scope,kind:"person",grant:"trusted-harness" };
  const deps = { store, knowledge:{ read:async () => officialRelease() }, profileOf:async () => ({ student:"unknown",cards:[],memberships:[] }), delivery:{} };
  const hunts = new Hunts(deps);
  const run = (request, actor=agent) => hunts.run({ agent:actor,request,now });
  const start = async () => { const result = await run({ op:"start",requestKey:randomUUID(),intent,profile:null }); if (!result.ok) throw new Error(JSON.stringify(result)); return result.value.view; };
  const record = (view,index=0,fields={}) => ({ op:"record",requestKey:randomUUID(),hunt:view.hunt,row:view.rows[index].row.id,slot:view.rows[index].slots[0].slot,expected:view.rows[index].revision,outcome:{ kind:"gap",reason:"Synthetic unavailable" },...fields });
  const control = (view,control,requestKey=randomUUID()) => hunts.control({ person,hunt:view.hunt,control,requestKey,now });
  return { store,hooks,scope,agent,person,run,start,record,control,hunts,deps };
  } catch (error) { await store.close(); throw error; }
}
