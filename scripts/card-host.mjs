import { CardTransport } from "../src/card/adapter.ts";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
const frame=document.querySelector("iframe");
const bridge=new AppBridge(null,{name:"Scoat local ext-apps harness",version:"1.0.0"},{...(location.search.includes("unsupported")?{}:{serverTools:{}}),openLinks:{},message:{text:{}}},{hostContext:{theme:"light"}});
const opened=[],calls=[],samples=[];
let mode="live",delay=0,replyOverride,pendingRenderAt,capability,lostRenewals=0;
frame.addEventListener("load",()=>{const win=frame.contentWindow;new win.PerformanceObserver(list=>{for(const entry of list.getEntries()) if(entry.name==="scoat-card-render" && pendingRenderAt!==undefined){samples.push({resultToRenderMs:win.performance.timeOrigin+entry.startTime-performance.timeOrigin-pendingRenderAt});pendingRenderAt=undefined;}}).observe({type:"mark"});});
bridge.onopenlink=async({url})=>{opened.push(url);window.open(url,"_blank");return {};};
bridge.oncalltool=async params=>{
 const start=performance.now();calls.push({op:params.arguments.op,at:start});
 if(delay) await new Promise(resolve=>setTimeout(resolve,delay));
 if(mode==="outage") return {isError:true,content:[],structuredContent:{ok:false,error:{code:"transient",message:"Local bridge response lost",next:"Retry the authenticated card connection.",repair:{kind:"none"}}}};
 const result=await (await fetch("/tool",{method:"POST",body:JSON.stringify(params)})).json();
 if(mode==="lose-renew" && params.arguments.op==="renew" && !result.isError && result._meta?.["scoat/readCapability"]?.grant) {mode="live";lostRenewals++;return {isError:true,content:[],structuredContent:{ok:false,error:{code:"transient",message:"Local bridge response lost",next:"Retry the authenticated card connection.",repair:{kind:"none"}}}};}
 if(replyOverride && params.arguments.op==="read") result.structuredContent=replyOverride;
 if(mode==="old" && params.arguments.op==="read") result.structuredContent=await (await fetch("/initial")).json();
 const secret=result._meta?.["scoat/readCapability"];
 if(secret) capability={grant:secret.grant,hunt:params.arguments.hunt};
 const bridgeMs=performance.now()-start;
 samples.push({op:params.arguments.op,bridgeMs,deliberateDelayMs:delay});
 if(params.arguments.op==="read") pendingRenderAt=performance.now();
 return result;
};
bridge.oninitialized=async()=>{if(location.search.includes("waiting")){window.ready=true;return;}await bridge.sendToolInput({arguments:{op:"read"}});await bridge.sendToolResult({content:[],structuredContent:await (await fetch("/initial")).json()});window.ready=true;};
bridge.onmessage=async params=>{messages.push(params);return {};};
const messages=[];
window.harness={messages,async result(input,result){await bridge.sendToolInput({arguments:input});await bridge.sendToolResult(result);},async theme(theme){await bridge.setHostContext({theme});},calls,opened,samples,get lostRenewals(){return lostRenewals;},setMode(value){mode=value;},setReply(value){replyOverride=value;},setDelay(ms){delay=ms;},unmount(){frame.remove();},async revoke(){if(!capability) throw new Error("No active fixture capability");await fetch("/tool",{method:"POST",body:JSON.stringify({name:"scoat_card",arguments:{op:"revoke",...capability}})});},async expire(){await fetch("/expire",{method:"POST"});},async resend(){await bridge.sendToolResult({content:[],structuredContent:await (await fetch("/initial")).json()});}};
await bridge.connect(new CardTransport(frame.contentWindow,frame.contentWindow));
frame.src="/card";
