import { useEffect, useState } from "react";
import type { CardBridge, CardState } from "./index.js";
import { createController } from "./index.js";
import type { Snapshot } from "./contracts.js";
import type { Quote, Line, Money } from "../domain.js";
const money=(value:Money)=>new Intl.NumberFormat("en-GB",{style:"currency",currency:value.currency}).format(value.pence/100);
const pay=(value:Quote["guaranteed"])=>value.kind==="known"?money(value.amount):"Unknown: "+value.gaps.join("; ");
function budget(value:Quote["budget"]):string {
 switch(value.kind) {
  case "over": return "Over budget by "+money(value.by);
  case "within": return "Within budget";
  case "unknown": return "Budget fit unknown";
  case "no-budget": return "No budget set";
  default: throw new Error("Unhandled budget state: "+(value satisfies never));
 }
}
function status(value:Line["status"]):string {
 switch(value.kind) {
  case "confirmed": return "Confirmed";
  case "needs-step": return "Requires "+value.steps.join(", ");
  case "unknown": return "Unknown: "+value.reason;
  case "untested": return "Untested";
  default: throw new Error("Unhandled evidence status: "+(value satisfies never));
 }
}
function Lines({title,lines}:{title:string;lines:readonly Line[]}) {return <div><h4>{title}</h4>{lines.length?lines.map((line,i)=><p key={i}>{line.label}: {"pence" in line.value?money(line.value):"points" in line.value?`${line.value.points} points`:line.value.text} · {status(line.status)} <a href={line.proof.url} target="_blank" rel="noreferrer">Source</a></p>):<p className="muted">None confirmed</p>}</div>;}
function QuoteDetails({quote}:{quote:Quote}) {return <article className="quote" key={quote.id}><h3>{quote.seller}</h3><p className="amount">{pay(quote.guaranteed)}</p><p>Guaranteed pay today · {budget(quote.budget)}</p><Lines title="Price evidence" lines={quote.guaranteed.lines}/><Lines title="Back later" lines={quote.backLater}/><Lines title="Perks" lines={quote.perks}/>{quote.conditional.map((scenario,i)=><div className="conditional" key={i}><h4>Conditional: {pay(scenario.payToday)}</h4><p>Requires {scenario.requires.join(", ")} · {budget(scenario.budget)}</p><Lines title="Scenario evidence" lines={scenario.payToday.lines}/><Lines title="Conditional back later" lines={scenario.backLater}/><Lines title="Conditional perks" lines={scenario.perks}/></div>)}{quote.limitations.map((gap,i)=><p key={i}>{gap}</p>)}{quote.untested.map(offer=><p key={offer.id}>Untested: {offer.kind} · {offer.seller} <a href={offer.proof.url} target="_blank" rel="noreferrer">Source</a></p>)}</article>;}
export function Card({initial,bridge}:{initial:Snapshot;bridge:CardBridge|undefined}) {
 const [state,setState]=useState<CardState>({snapshot:initial,status:bridge?"stale":"unsupported",message:"Connecting…"});
 useEffect(()=>{performance.mark("scoat-card-render");},[state]);
 const [notice,setNotice]=useState("");
 useEffect(()=>{const controller=createController(initial,bridge,setState,undefined,document.visibilityState==="visible");const visibility=()=>controller.setVisible(document.visibilityState==="visible");visibility();document.addEventListener("visibilitychange",visibility);return()=>{document.removeEventListener("visibilitychange",visibility);controller.dispose();};},[initial,bridge]);
 const view=state.snapshot.value.view, controls=state.snapshot.controls;
 const disabled=state.status!=="live" || view.final.kind==="finished";
 async function open(url:string) {try{if(bridge) await bridge.openLink(url);else window.open(url,"_blank","noopener,noreferrer");setNotice("Opened browser confirmation. Approve the exact action there.");}catch{setNotice("Host could not open the link. Use the browser control link below.");}}
 return <main className="card"><header><div><h1>Scoat benefit hunt</h1></div><span className="badge">{view.final.kind==="finished"?"Finished":view.stopRequested?"Discovery stopped":state.status}</span></header>
 <p role="status">{state.message}</p><p>{view.intent.product.kind==="description"?view.intent.product.text:view.intent.product.url}</p>
 <p className="muted">{view.intent.variant ?? "Variant unspecified"} · {view.intent.budget?"Budget "+money(view.intent.budget):"No budget set"}</p>
 <section aria-label="Person controls" className="controls"><button disabled={disabled || view.stopRequested || !controls || !bridge} onClick={()=>controls && void open(controls.stop)}>Stop new discovery</button><p>Stops new accepted discovery. The host agent may continue running.</p>
 <button onClick={()=>setNotice(controls?.watch.reason ?? "Watch requires verified email and a confirmed target; unavailable.")}>Watch unavailable</button>
 {controls && <p><a href={controls.hub} target="_blank" rel="noreferrer">Open browser controls</a></p>}<p role="status">{notice}</p></section>
 <section><h2>Checklist <span className="muted">{view.progress.resolved}/{view.progress.total}</span></h2><ul className="checklist">{view.rows.map(row=><li key={row.row.id}><div><h3>{row.row.label}</h3><div>{row.skippedBy==="person"?<p>Skipped by you</p>:row.slots.map(slot=><div key={slot.slot}><p>{slot.seller ?? "Seller unknown"}: {slot.completion.kind}{slot.completion.kind==="gap"?" · "+slot.completion.reason:slot.completion.kind==="checked" && slot.completion.checked?" · "+slot.completion.checked:""}</p>{slot.completion.kind==="checked" && slot.completion.proof.map((proof,i)=><p key={i}><a href={proof.url} target="_blank" rel="noreferrer">Checklist source</a> · {proof.note} · {proof.observedAt}</p>)}</div>)}</div></div><button disabled={disabled || row.skippedBy==="person" || !bridge || !controls?.skip.some(link=>link.row===row.row.id)} onClick={()=>{const link=controls?.skip.find(link=>link.row===row.row.id);if(link) void open(link.url);}}>Skip {row.row.label}</button></li>)}</ul></section>
 <section><h2>All price scenarios</h2>{view.quotes.length===0 && <p>No confirmed quote yet.</p>}{view.quotes.map(quote=><QuoteDetails key={quote.id} quote={quote}/>)}</section>
 {view.final.kind==="finished" && <section aria-label="Finished quote"><h2>Finished quote</h2>{view.final.quote?<QuoteDetails quote={view.final.quote}/>:<p>No confirmed final quote.</p>}</section>}
 <section><h2>Evidence gaps</h2>{view.gaps.length?<ul>{view.gaps.map((gap,i)=><li key={i}>{gap}</li>)}</ul>:<p>No named gaps.</p>}</section>
 {view.ready && <p><a className="shop" href={view.ready.url} target="_blank" rel="noreferrer">Open clean shop link</a> {view.ready.steps.join(", ")}</p>}
 <details><summary>Canonical hunt text</summary><pre>{view.text}</pre></details></main>;
}
