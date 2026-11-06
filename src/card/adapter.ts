import { cardOutput } from "../mcp/outputs.js";
import { JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } from "@modelcontextprotocol/ext-apps";
import { capabilitySchema, CardFailure, snapshotSchema, toolReplySchema } from "./contracts.js";
import type { CardAction, CardBridge } from "./index.js";
import { modelContext } from "./index.js";
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
 const app=new App({name:"Scoat live hunt",version:"0.1.0"},{availableDisplayModes:["inline"]},{autoResize:true});
 const capabilities=new Map<string,ReturnType<typeof capabilitySchema.parse>>();
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
 const media=window.matchMedia("(prefers-color-scheme: dark)");
 const hostContext=()=>{
  const context=app.getHostContext(),root=document.documentElement;
  applyDocumentTheme(app.getHostContext()?.theme ?? (media.matches?"dark":"light"));
  if(context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  if(context?.styles?.css?.fonts) applyHostFonts(context.styles.css.fonts);
  for(const [local,host] of [["--background","--color-background-primary"],["--foreground","--color-text-primary"],["--muted-foreground","--color-text-secondary"],["--border","--color-border-primary"],["--secondary","--color-background-secondary"]] as const) {
   if(context?.styles?.variables?.[host]) root.style.setProperty(local,`var(${host})`);else root.style.removeProperty(local);
  }
  for(const side of ["top","right","bottom","left"] as const) root.style.setProperty(`--safe-area-${side}`,`${context?.safeAreaInsets?.[side]??0}px`);
  const size=context?.containerDimensions;
  root.style.height=size && "height" in size?"100vh":"";
  root.style.width=size && "width" in size?"100vw":"";
  root.style.maxHeight=size && "maxHeight" in size && size.maxHeight!==undefined?`${size.maxHeight}px`:"";
  root.style.maxWidth=size && "maxWidth" in size && size.maxWidth!==undefined?`${size.maxWidth}px`:"";
 };
 app.onhostcontextchanged=hostContext;
 media.addEventListener("change",hostContext);
 hostContext();
 let lastContext="";
 let lastAction:CardAction|undefined,lastHunt:string|undefined,contextQueue=Promise.resolve();
 const bridge:CardBridge={
  get toolsAvailable(){return !!app.getHostCapabilities()?.serverTools;},
  async capability(op,hunt,grant){if(op==="renew") capabilities.delete(hunt);const value=capabilitySchema.parse((await call(op,hunt,grant))._meta?.["scoat/readCapability"]);capabilities.set(hunt,value);return value;},
  async read(hunt,grant){return snapshotSchema.parse((await call("read",hunt,grant)).structuredContent);},
  async controls(hunt){if(!bridge.toolsAvailable) throw new Error("Tools unavailable");let capability=capabilities.get(hunt);if(!capability || Date.parse(capability.expiresAt)<=Date.now()+15000) capability=await bridge.capability("open",hunt);try{return await bridge.read(hunt,capability.grant);}catch(error){capabilities.delete(hunt);throw error;}},
  async openLink(url){if(!app.getHostCapabilities()?.openLinks) throw new Error("Links unavailable");const result=await app.openLink({url});if(result.isError) throw new Error("Link unavailable");},
  async sendMessage(text){if(!app.getHostCapabilities()?.message?.text) throw new Error("Messages unavailable");const result=await app.sendMessage({role:"user",content:[{type:"text",text}]});if(result.isError) throw new Error("Message declined");},
  async updateContext(snapshot,action){const supported=app.getHostCapabilities()?.updateModelContext;if(!supported?.text && !supported?.structuredContent) return;if(lastHunt!==snapshot.value.view.hunt) lastAction=undefined;lastHunt=snapshot.value.view.hunt;lastAction=action??lastAction;const context=modelContext(snapshot,lastAction),text=JSON.stringify(context);contextQueue=contextQueue.catch(()=>{}).then(async()=>{if(text===lastContext) return;await app.updateModelContext({...(supported.text?{content:[{type:"text" as const,text}]}:{}),...(supported.structuredContent?{structuredContent:context}:{})});lastContext=text;});await contextQueue;}
 };
 return {app,bridge,connect:async()=>{await app.connect(new CardTransport(window.parent,window.parent));hostContext();}};
}
