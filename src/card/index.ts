import type { HuntView } from "../hunt/index.js";
import type { Capability, Snapshot } from "./contracts.js";
import { CardFailure } from "./contracts.js";
export type CardAction = "visit"|"refine"|"watch-requested"|"stop-requested"|"watch-active";
export type CardBridge = { toolsAvailable?:boolean; capability(op:"open"|"renew",hunt:string,grant?:string):Promise<Capability>; read(hunt:string,grant:string):Promise<Snapshot>; controls(hunt:string):Promise<Snapshot>; openLink(url:string):Promise<void>; sendMessage?(text:string):Promise<void>; updateContext(snapshot:Snapshot,action?:CardAction):Promise<void> };
export type CardState = { snapshot:Snapshot; status:"live"|"stale"|"revoked"|"unsupported"; message:string };
export function modelContext(snapshot:Snapshot,action?:CardAction) {
 const view=snapshot.value.view,quote=view.final.kind==="finished"?view.final.quote:view.best;
 return {hunt:view.hunt,product:view.intent.product,search:view.final.kind==="finished"?"complete":view.stopRequested?"stopped":"searching",checked:view.progress.resolved,total:view.progress.total,best:quote?{seller:quote.seller,price:quote.guaranteed.kind==="known"?quote.guaranteed.amount:null}:null,...(action?{action,confirmation:action==="stop-requested" && view.stopRequested?"Stop confirmed.":action==="watch-requested" || action==="stop-requested"?"Browser approval is still required; no change has been confirmed.":"No additional approval requested."}:{})};
}
export function compareViews(prior:HuntView,next:HuntView):"accept"|"drop"|"retry" {
 if(prior.hunt!==next.hunt || prior.release!==next.release || prior.final.kind==="finished" || (prior.stopRequested && !next.stopRequested)) return "drop";
 if(prior.rows.length!==next.rows.length) return "drop";
 let lower=false, higher=false;
 for(const row of prior.rows) {
  const incoming=next.rows.find(value=>value.row.id===row.row.id);
  if(!incoming || (row.skippedBy==="person" && incoming.skippedBy!=="person")) return "drop";
  lower ||= incoming.revision<row.revision;
  higher ||= incoming.revision>row.revision;
 }
 return lower ? higher ? "retry" : "drop" : "accept";
}
export function initialState(initial:Snapshot,bridge:CardBridge|undefined):CardState {
 if(bridge?.toolsAvailable===false) bridge=undefined;
 if(initial.value.view.final.kind==="finished") return {snapshot:initial,status:bridge?"stale":"unsupported",message:"Your final comparison, ready when you are."};
 return {snapshot:initial,status:bridge?"stale":"unsupported",message:bridge?"Connecting…":"Live updates unavailable here. Ask your assistant for the latest prices."};
}
export function createController(initial:Snapshot,bridge:CardBridge|undefined,notify:(state:CardState)=>void,clock={now:()=>Date.now(),set:(fn:()=>void,ms:number)=>setTimeout(fn,ms),clear:(id:ReturnType<typeof setTimeout>)=>clearTimeout(id)},visibleInitially=true) {
 let state:CardState=initialState(initial,bridge);
 let capability:Capability|undefined, timer:ReturnType<typeof setTimeout>|undefined, flight=false, visible=visibleInitially, disposed=false, terminal=false, sequence=0, applied=0, failures=0;
 const publish=()=>{if(!disposed) notify(state);};
 const clear=()=>{if(timer!==undefined) clock.clear(timer);timer=undefined;};
 const eligible=()=>!disposed && visible && !terminal && state.snapshot.value.view.final.kind!=="finished" && bridge!==undefined && bridge.toolsAvailable!==false;
 const schedule=()=>{clear();if(eligible()) timer=clock.set(()=>{timer=undefined;void refresh();},Math.min(30000,3000*2**Math.min(failures,3)));};
 async function refresh() {
  if(!eligible() || flight || !bridge) return;
  clear();flight=true;const seq=++sequence;
  try {
   if(!capability) capability=await bridge.capability("open",initial.value.view.hunt);
   if(disposed) return;
   if(Date.parse(capability.expiresAt)-clock.now()<15000) {
    const prior=capability;
    capability=undefined;
    capability=await bridge.capability("renew",initial.value.view.hunt,prior.grant);
   }
   if(disposed) return;
   const reply=await bridge.read(initial.value.view.hunt,capability.grant);
   if(disposed || seq<applied || state.snapshot.value.view.final.kind==="finished") return;
   const decision=compareViews(state.snapshot.value.view,reply.value.view);
   if(decision!=="accept") {state={...state,status:"stale",message:"Checking for the latest result. Actions will be ready in a moment."};publish();return;}
   applied=seq;failures=0;state={snapshot:reply,status:"live",message:reply.value.view.final.kind==="finished"?"Your final comparison, ready when you are.":"Up to date"};publish();
  } catch(error) {
   if(disposed || seq<applied || state.snapshot.value.view.final.kind==="finished") return;
   if(error instanceof CardFailure && error.code==="revoked") {terminal=true;capability=undefined;state={...state,status:"revoked",message:"Sign in again to reconnect this search."};}
   else {if(error instanceof CardFailure && error.code==="expired" && capability) capability={...capability,expiresAt:new Date(0).toISOString()};failures++;state={...state,status:"stale",message:"Offline. Reconnecting automatically."};}
   publish();
  } finally {flight=false;schedule();}
 }
 publish();void refresh();
 return {refresh,receive(snapshot:Snapshot){if(snapshot===state.snapshot || disposed || terminal || compareViews(state.snapshot.value.view,snapshot.value.view)!=="accept") return;applied=++sequence;failures=0;state={snapshot,status:bridge && bridge.toolsAvailable!==false?"live":"unsupported",message:snapshot.value.view.final.kind==="finished"?"Your final comparison, ready when you are.":"Up to date"};publish();schedule();},setVisible(value:boolean){visible=value;clear();if(value) void refresh();},dispose(){disposed=true;sequence++;clear();capability=undefined;},getState:()=>state};
}
