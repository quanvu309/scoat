import { cardOutput } from "../mcp/outputs.js";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { App } from "@modelcontextprotocol/ext-apps";
import { capabilitySchema, CardFailure, snapshotSchema, toolReplySchema } from "./contracts.js";
import type { CardBridge } from "./index.js";
export class CardTransport implements Transport {
 onmessage?: (message:JSONRPCMessage)=>void;
 onclose?: ()=>void;
 private readonly receive=(event:MessageEvent<unknown>)=>{
  if(event.source!==this.source) return;
  const message=JSONRPCMessageSchema.safeParse(event.data);
  if(message.success) this.onmessage?.(message.data);
 };
 constructor(private readonly target:Window,private readonly source:MessageEventSource) {}
 async start(){window.addEventListener("message",this.receive);}
 async send(message:JSONRPCMessage){this.target.postMessage(message,"*");}
 async close(){window.removeEventListener("message",this.receive);this.onclose?.();}
}
export function createAppAdapter() {
 const app=new App({name:"Scoat live hunt",version:"0.1.0"},{});
 async function call(op:string,hunt:string,grant?:string) {
  const reply=toolReplySchema.parse(await app.callServerTool({name:"scoat_card",arguments:{op,hunt,...(grant?{grant}:{})}}));
  const output=cardOutput.safeParse(reply.structuredContent);
  if(!output.success || reply.isError===true !== (output.data.ok===false)) throw new CardFailure("transient");
  if(!output.data.ok) {const code=output.data.error.code;throw new CardFailure(code==="expired" || code==="revoked" ? code : "transient");}
  if(op==="open" || op==="renew") {
   const capability=capabilitySchema.parse(reply._meta?.["scoat/readCapability"]);
   if(!("capability" in output.data.value) || output.data.value.expiresAt!==capability.expiresAt) throw new CardFailure("transient");
  }
  return reply;
 }
 const bridge:CardBridge={
  async capability(op,hunt,grant){return capabilitySchema.parse((await call(op,hunt,grant))._meta?.["scoat/readCapability"]);},
  async read(hunt,grant){return snapshotSchema.parse((await call("read",hunt,grant)).structuredContent);},
  async openLink(url){const result=await app.openLink({url});if(result.isError) throw new Error("Link unavailable");}
 };
 return {app,bridge,connect:()=>app.connect(new CardTransport(window.parent,window.parent))};
}
