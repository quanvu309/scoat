import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { build } from "vite";
import { authFixture } from "./auth-fixture.mjs";
import { fixture, offer, gbp } from "../test/fixtures/hunt.mjs";
export async function cardFixture(databaseUrl) {
 const f=await authFixture(databaseUrl);
 let server;
 try {
 const login=await f.login();
 const inputs=fixture();inputs.intent.product.url="https://www.nike.com/gb/t/synthetic?utm_source=test#tracking";
 const started=await f.tool(login.token,"scoat_hunt",{op:"start",requestKey:randomUUID(),intent:inputs.intent,profile:{student:"unknown",cards:[],memberships:[]}});
 if(!started.structuredContent?.ok) throw new Error("Card fixture start failed");
 const hunt=started.structuredContent.value.view.hunt;
 const offers=inputs.offers;
 const found=offers.map(({id,row,...value})=>({...value,proof:{...value.proof,observedAt:new Date().toISOString()}}));
 const row=started.structuredContent.value.view.rows[0];
 const recorded=await f.tool(login.token,"scoat_hunt",{op:"record",requestKey:randomUUID(),hunt,row:row.row.id,slot:row.row.slots[0],expected:row.revision,outcome:{kind:"found",offers:found}});
 if(!recorded.structuredContent?.ok) throw new Error(JSON.stringify(recorded));
 const current=recorded.structuredContent.value.view;
 const compatible=await f.tool(login.token,"scoat_hunt",{op:"compatibility",requestKey:randomUUID(),hunt,evidence:{offers:current.offers.map(o=>o.id),proof:[current.offers[0].proof]}});
 if(!compatible.structuredContent?.ok) throw new Error("Fixture compatibility failed");
 const other=current.rows.find(r=>r.row.place==="other-sellers");
 const extra=offer("long-price","price",{seller:"SYNTHETIC Independent seller with a very long international trading name "+"Trading ".repeat(10),amount:gbp(5500)});
 const {id,row:ignored,...extraInput}=extra;
 const second=await f.tool(login.token,"scoat_hunt",{op:"record",requestKey:randomUUID(),hunt,row:other.row.id,slot:other.row.slots[0],expected:other.revision,outcome:{kind:"found",offers:[{...extraInput,proof:{...extraInput.proof,observedAt:new Date().toISOString()}}]}});
 if(!second.structuredContent?.ok) throw new Error("Fixture second seller failed");
 const initial=(await f.tool(login.token,"scoat_hunt",{op:"read",hunt})).structuredContent;
 const bundle=await build({configFile:false,logLevel:"silent",build:{target:"esnext",write:false,minify:true,lib:{entry:"scripts/card-host.mjs",formats:["es"],fileName:"host"}}});
 const output=Array.isArray(bundle)?bundle[0].output:bundle.output;
 const js=output.find(item=>item.type==="chunk").code;
 server=createServer(async(req,res)=>{try {
  if(req.url==="/card") {res.setHeader("content-type","text/html; charset=utf-8");res.end(await readFile("dist/card/index.html"));}
  else if(req.url==="/host.js") {res.setHeader("content-type","application/javascript");res.end(js);}
  else if(req.url==="/initial") {res.setHeader("content-type","application/json");res.end(JSON.stringify(initial));}
  else if(req.url==="/expire") {await f.store.pool.query("UPDATE oauth_read_grants SET expires_at=now()-interval '1 second'");res.end("ok");}
  else if(req.url==="/tool") {let body="";for await(const chunk of req) body+=chunk;const params=JSON.parse(body);res.setHeader("content-type","application/json");res.end(JSON.stringify(await f.tool(login.token,params.name,params.arguments)));}
  else {res.setHeader("content-type","text/html; charset=utf-8");res.end('<!doctype html><html lang="en"><head><title>Local ext-apps harness · synthetic shopping evidence</title></head><body style="margin:0"><iframe title="Scoat live card" style="width:100%;height:100vh;border:0"></iframe><script type="module" src="/host.js"></script></body></html>');}
 }catch{res.statusCode=500;res.end("Fixture request failed");}});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 return {tool:args=>f.tool(login.token,"scoat_hunt",args),url:`http://127.0.0.1:${server.address().port}`,initial,fixture:f,async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await f.close();}};
 }catch(error){if(server) server.close();await f.close();throw error;}
}
