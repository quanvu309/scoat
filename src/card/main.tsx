import { createRoot } from "react-dom/client";
import { Card, WaitingCard } from "./renderer.js";
import { createAppAdapter } from "./adapter.js";
import { memoryOutput } from "../mcp/outputs.js";
import type { Snapshot } from "./contracts.js";
import { snapshotSchema } from "./contracts.js";
import { compareViews } from "./index.js";
import "../../landing/public/ui.css";
import "./style.css";
const element=document.getElementById("root");
if(!element) throw new Error("Card root required");
const root=createRoot(element);
const {app,bridge,connect}=createAppAdapter();
let connected=false;
let active:Snapshot|undefined;
let watching=false;
let watchHunt:string|undefined;
const render=()=>{if(active) root.render(<Card key={active.value.view.hunt} initial={active} watching={watching} bridge={connected?bridge:undefined}/>);};
root.render(<WaitingCard/>);
app.ontoolinput=({arguments:args})=>{
 watchHunt=args?.op==="watch" && typeof args.hunt==="string"?args.hunt:undefined;
 if(args?.op!=="start") return;
 const intent=args.intent;
 if(!intent || typeof intent!=="object" || !("product" in intent)) return;
 const product=intent.product;
 const label=typeof product==="string"?product:product && typeof product==="object" && "text" in product && typeof product.text==="string"?product.text:undefined;
 active=undefined;watching=false;root.render(<WaitingCard product={label}/>);
};
app.ontoolresult=raw=>{
 const result=snapshotSchema.safeParse(raw.structuredContent);
 if(result.success && (!active || active.value.view.hunt!==result.data.value.view.hunt || compareViews(active.value.view,result.data.value.view)==="accept")) {if(active?.value.view.hunt!==result.data.value.view.hunt) watching=false;active=result.data;render();}
 const receipt=memoryOutput.safeParse(raw.structuredContent);
 if(receipt.success && receipt.data.ok && receipt.data.value.kind==="watching" && watchHunt===active?.value.view.hunt) {watching=true;render();}
};
void connect().then(()=>{connected=true;render();}).catch(()=>{connected=false;render();});
