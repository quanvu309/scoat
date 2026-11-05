import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { App } from "@modelcontextprotocol/ext-apps";
import { capabilitySchema, cardFailureSchema, CardFailure, snapshotSchema, toolReplySchema } from "./contracts.js";
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
  if(reply.isError) {const error=cardFailureSchema.safeParse(reply._meta?.["scoat/cardFailure"]);throw new CardFailure(error.success?error.data.code:"transient");}
  return reply;
 }
 const bridge:CardBridge={
  async capability(op,hunt,grant){return capabilitySchema.parse((await call(op,hunt,grant))._meta?.["scoat/readCapability"]);},
  async read(hunt,grant){return snapshotSchema.parse((await call("read",hunt,grant)).structuredContent);},
  async openLink(url){const result=await app.openLink({url});if(result.isError) throw new Error("Link unavailable");}
 };
 return {app,bridge,connect:()=>app.connect(new CardTransport(window.parent,window.parent))};
}
