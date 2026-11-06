import { useEffect, useState } from "react";
import type { CardBridge, CardState } from "./index.js";
import { createController, initialState } from "./index.js";
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
export function WaitingCard() {
 return <main className="card waiting"><header><span className="wordmark">scoat<span>.</span></span><span className="badge">Connecting</span></header><h1>Your next good find.</h1><p className="muted" role="status">Waiting for your hunt. Your results will appear here.</p><div className="waiting-rule"/><p className="muted">If this host cannot display the card, your results and next steps are in the conversation.</p></main>;
}
export function Card({initial,bridge}:{initial:Snapshot;bridge:CardBridge|undefined}) {
 const [state,setState]=useState<CardState>(()=>initialState(initial,bridge));
 useEffect(()=>{performance.mark("scoat-card-render");},[state]);
 const [notice,setNotice]=useState("");
 useEffect(()=>{const controller=createController(initial,bridge,setState,undefined,document.visibilityState==="visible");const visibility=()=>controller.setVisible(document.visibilityState==="visible");visibility();document.addEventListener("visibilitychange",visibility);return()=>{document.removeEventListener("visibilitychange",visibility);controller.dispose();};},[initial,bridge]);
 const view=state.snapshot.value.view, controls=state.snapshot.controls;
 const finished=view.final.kind==="finished";
 const hero=view.final.kind==="finished"?view.final.quote:view.best;
 const disabled=state.status!=="live" || finished;
 async function open(url:string) {try{if(bridge) await bridge.openLink(url);else window.open(url,"_blank","noopener,noreferrer");setNotice("Opened browser confirmation. Approve the exact action there.");}catch{setNotice("Host could not open the link. Use the browser control link below.");}}
 async function refine() {try{if(!bridge?.sendMessage) throw new Error("Unavailable");await bridge.sendMessage("Help me refine this Scoat hunt: ask what I want to change about the product, budget or seller preferences before starting a new hunt.");setNotice("Sent to the conversation. Tell your assistant what you would like to change.");}catch{setNotice('Tell your assistant: “Refine this hunt — my budget or preferences have changed.”');}}
 return <main className="card"><header><span className="wordmark">scoat<span>.</span></span><span className="badge">{finished?"Finished":view.stopRequested?"Discovery stopped":state.status==="live"?"Live hunt":state.status==="stale"?"Updating":"Text available"}</span></header>
 {state.message.startsWith("Offline") && <aside className="connection-note" role="alert"><strong>Connection paused</strong><p>Your last result is saved here. Reconnecting automatically; browser controls remain available below.</p></aside>}
 <h1>{view.intent.product.kind==="description"?view.intent.product.text:"Your find at "+new URL(view.intent.product.url).hostname.replace(/^www\./,"")}</h1>
 <p className="context muted">{view.intent.variant && <span>{view.intent.variant}</span>}<span>{view.intent.budget?"Budget "+money(view.intent.budget):"No budget set"}</span></p>
 <section className="hero" aria-label={finished?"Finished quote":"Best deal so far"}>
 {hero?<><h2>{finished?"Your final pick":"Best confirmed so far"}</h2><p className="hero-seller">{hero.seller}</p><p className="hero-price">{hero.guaranteed.kind==="known"?money(hero.guaranteed.amount):"Price unconfirmed"}<span>pay today</span></p><p className="muted">{budget(hero.budget)}. Later rewards stay separate.</p><details><summary>Why this deal · price & rewards</summary><QuoteDetails quote={hero}/></details></>:<><h2>{finished?"No confirmed final quote":view.stopRequested?"Discovery stopped":"The evidence comes first."}</h2><p className="empty-copy">{finished?"The hunt ended without a confirmed pick. Refine your preferences to try again.":"No confirmed quote yet. Seller prices appear as your assistant records evidence."}</p></>}
 </section>
 <section aria-label="Person controls" className="controls">
 {controls?.watch.available?<button className="primary" onClick={()=>controls.watch.available && void open(controls.watch.url)}>Watch price</button>:<button onClick={()=>setNotice(controls && !controls.watch.available?controls.watch.reason:"Price watch links appear with browser controls.")}>Why no price watch?</button>}
 <button onClick={()=>void refine()}>Refine search</button><button disabled={disabled || view.stopRequested || !controls || !bridge} onClick={()=>controls && void open(controls.stop)}>Stop new discovery</button>
 <p className="control-note muted">Watch and Stop open browser confirmation. Nothing changes until you approve. Stop ends new accepted discovery; the host agent may continue running.</p>
 {controls && <a href={controls.hub} target="_blank" rel="noreferrer">Open browser controls</a>}<p role="status" className="notice">{notice}</p></section>
 <section className="progress-section" aria-label="Hunt progress"><div className="progress-title"><h2>{finished?"Hunt complete":view.stopRequested?"Discovery stopped":"Checking the possibilities"}</h2><span>{view.progress.resolved}/{view.progress.total}</span></div><div className="progress-track" role="progressbar" aria-label="Resolved evidence checks" aria-valuemin={0} aria-valuemax={view.progress.total} aria-valuenow={view.progress.resolved}>{view.rows.map((row,i)=><span key={row.row.id} className={i<view.progress.resolved?"resolved":""}/>)}</div><p className="muted" role="status">{state.message}</p></section>
 {view.quotes.some(quote=>quote.id!==hero?.id) && <section className="alternatives"><h2>Other options</h2>{view.quotes.filter(quote=>quote.id!==hero?.id).map(quote=><details className="seller-row" key={quote.id}><summary><span className="seller-name">{quote.seller}<small>{budget(quote.budget)}</small></span><span className="seller-price">{quote.guaranteed.kind==="known"?money(quote.guaranteed.amount):"Unconfirmed"}</span></summary><QuoteDetails quote={quote}/></details>)}</section>}
 <details className="evidence"><summary>Evidence notebook · {view.progress.resolved}/{view.progress.total} checks</summary><h2>Checklist</h2><ul className="checklist">{view.rows.map(row=><li key={row.row.id}><div><h3>{row.row.label}</h3><div>{row.skippedBy==="person"?<p>Skipped by you</p>:row.slots.map(slot=><div key={slot.slot}><p>{slot.seller ?? "Seller unknown"}: {slot.completion.kind}{slot.completion.kind==="gap"?" · "+slot.completion.reason:slot.completion.kind==="checked" && slot.completion.checked?" · "+slot.completion.checked:""}</p>{slot.completion.kind==="checked" && slot.completion.proof.map((proof,i)=><p key={i}><a href={proof.url} target="_blank" rel="noreferrer">Checklist source</a> · {proof.note} · {proof.observedAt}</p>)}</div>)}</div></div><button disabled={disabled || row.skippedBy==="person" || !bridge || !controls?.skip.some(link=>link.row===row.row.id)} onClick={()=>{const link=controls?.skip.find(link=>link.row===row.row.id);if(link) void open(link.url);}}>Skip {row.row.label}</button></li>)}</ul>
 <h2>All price scenarios</h2>{view.quotes.length===0 && <p>No confirmed quote yet.</p>}{view.quotes.map(quote=><QuoteDetails key={quote.id} quote={quote}/>)}
 <h2>Evidence gaps</h2>{view.gaps.length?<ul>{view.gaps.map((gap,i)=><li key={i}>{gap}</li>)}</ul>:<p>No named gaps.</p>}</details>
 {view.ready && <p><a className="shop" href={view.ready.url} target="_blank" rel="noreferrer">Open clean shop link</a> {view.ready.steps.join(", ")}</p>}
 <details className="canonical"><summary>Canonical hunt text</summary><pre>{view.text}</pre></details></main>;
}
