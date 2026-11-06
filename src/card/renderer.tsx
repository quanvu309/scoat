import { useEffect, useState } from "react";
import type { CardBridge, CardState } from "./index.js";
import { createController, initialState } from "./index.js";
import type { Snapshot } from "./contracts.js";
import type { Quote, Line, Money } from "../domain.js";
const money=(value:{readonly currency:Money["currency"];readonly pence:number})=>new Intl.NumberFormat("en-GB",{style:"currency",currency:value.currency}).format(value.pence/100);
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
function Mark({kind="spark"}:{kind?:"spark"|"check"|"bell"|"arrow"|"pause"}) {
 return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind==="check"?<path d="m5 12 4 4L19 6"/>:kind==="bell"?<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>:kind==="arrow"?<><path d="M5 12h14M13 6l6 6-6 6"/></>:kind==="pause"?<path d="M9 5v14M15 5v14"/>:<><path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z"/></>}</svg>;
}
export function WaitingCard() {
 return <main className="card waiting"><header><span className="wordmark">scoat<span>.</span></span><span className="edition">THE DEAL LEDGER</span></header><div className="empty-mark"><Mark/></div><p className="eyebrow">A little research. A better buy.</p><h1>Your next good find.</h1><p className="empty-copy" role="status">Opening your search. Prices and the details that matter will appear here.</p><p className="footnote">Your assistant is finding the evidence. Scoat keeps the numbers straight.</p></main>;
}
export function Card({initial,bridge,watching=false}:{initial:Snapshot;bridge:CardBridge|undefined;watching?:boolean}) {
 const [state,setState]=useState<CardState>(()=>initialState(initial,bridge));
 useEffect(()=>{performance.mark("scoat-card-render");},[state]);
 const [notice,setNotice]=useState("");
 const [excluded,setExcluded]=useState<string>(initial.value.view.rows[0]?.row.id ?? "");
 useEffect(()=>{const controller=createController(initial,bridge,setState,undefined,document.visibilityState==="visible");const visibility=()=>controller.setVisible(document.visibilityState==="visible");visibility();document.addEventListener("visibilitychange",visibility);return()=>{document.removeEventListener("visibilitychange",visibility);controller.dispose();};},[initial,bridge]);
 const view=state.snapshot.value.view, controls=state.snapshot.controls;
 const finished=view.final.kind==="finished";
 const hero=view.final.kind==="finished"?view.final.quote:view.best;
 const disabled=state.status!=="live" || finished;
 const alternatives=view.quotes.filter(quote=>quote.id!==hero?.id).sort((a,b)=>(a.guaranteed.kind==="known"?a.guaranteed.amount.pence:Infinity)-(b.guaranteed.kind==="known"?b.guaranteed.amount.pence:Infinity));
 const label=watching?"Watch active":finished?"Search complete":view.stopRequested?"Search paused":hero?"Comparing prices":"Just started";
 async function open(url:string) {try{if(bridge) await bridge.openLink(url);else window.open(url,"_blank","noopener,noreferrer");setNotice("Review and confirm in the page that opened.");}catch{setNotice("The link could not open. Use Manage search below.");}}
 async function refine() {try{if(!bridge?.sendMessage) throw new Error("Unavailable");await bridge.sendMessage("Help me refine this Scoat search: ask what I want to change about the product, budget or seller preferences before starting a new hunt.");setNotice("Back in the conversation, tell your assistant what you would like to change.");}catch{setNotice('Tell your assistant: “Refine this search — my budget or preferences have changed.”');}}
 return <main className="card"><header><span className="wordmark">scoat<span>.</span></span><span className="edition">THE DEAL LEDGER</span></header>
 <div className="search-heading"><span className="badge"><span className="status-dot"/>{label}</span><h1>{view.intent.product.kind==="description"?view.intent.product.text:"Your find at "+new URL(view.intent.product.url).hostname.replace(/^www\./,"")}</h1><p className="context muted">{view.intent.variant && <span>{view.intent.variant}</span>}{view.intent.budget && <span>Budget {money(view.intent.budget)}</span>}</p></div>
 {state.message.startsWith("Offline") && <aside className="connection-note" role="alert"><span className="note-icon"><Mark kind="pause"/></span><div><strong>A small pause in the search.</strong><p>We’ll reconnect automatically. Your last prices are saved below.</p></div></aside>}
 {state.status==="revoked" && <aside className="connection-note" role="alert"><strong>Let’s reconnect your search.</strong><p>Sign in again to get the latest prices. Your last results are still here.</p></aside>}
 <section className={"hero "+(!hero?"hero-empty":"")} aria-label={finished?"Finished quote":"Best deal so far"}>
 {hero?<><div className="hero-top"><h2 className="eyebrow">{finished?"YOUR BEST DEAL":"THE BEST SO FAR"}</h2><span className="verified"><Mark kind="check"/>{hero.guaranteed.kind==="known"?"Price checked":"Needs a closer look"}</span></div><div className="price-line"><p className="hero-price">{hero.guaranteed.kind==="known"?money(hero.guaranteed.amount):"Unconfirmed"}</p><div className="hero-merchant"><span>at {hero.seller}</span><span className="muted">{hero.guaranteed.kind==="known"?"Total to pay today":"Delivery or price still unknown"}</span></div></div><p className="budget-fit">{hero.budget.kind==="within"?<><Mark kind="check"/>{hero.guaranteed.kind==="known" && view.intent.budget && view.intent.budget.pence>hero.guaranteed.amount.pence?money({currency:view.intent.budget.currency,pence:view.intent.budget.pence-hero.guaranteed.amount.pence})+" under your budget":budget(hero.budget)}</>:budget(hero.budget)}</p><details className="deal-detail"><summary>How this price adds up<span>+</span></summary><QuoteDetails quote={hero}/></details></>:<><span className="empty-mark"><Mark/></span><h2>Good deals start with<br/>a closer look.</h2><p className="empty-copy">Your assistant is comparing sellers, delivery and discounts. The first confirmed price will land here.</p><p className="empty-promise"><Mark kind="check"/>Real prices. The small print included.</p></>}
 </section>
 {watching && <aside className="watch-note"><span className="note-icon"><Mark kind="bell"/></span><div><strong>Your price watch is on.</strong><p>Scoat will email you when your target price is reached.</p></div><Mark kind="check"/></aside>}
 <section aria-label="Search actions" className="controls">
 {!watching && (controls?.watch.available?<button className="primary" onClick={()=>controls.watch.available && void open(controls.watch.url)}><Mark kind="bell"/>Watch price</button>:<button onClick={()=>setNotice(controls && !controls.watch.available?controls.watch.reason:"Ask your assistant to finish this search before setting a price watch.")}><Mark kind="bell"/>Watch price</button>)}
 <button onClick={()=>void refine()}>Refine search<Mark kind="arrow"/></button>{!finished && <button className="quiet" disabled={disabled || view.stopRequested || !controls || !bridge} onClick={()=>controls && void open(controls.stop)}>{view.stopRequested?"Search paused":"Pause search"}</button>}
 {!watching && <p className="control-note muted">{finished?"A price watch starts after you confirm the details.":"Pausing keeps your results. Your assistant may finish its current step."}</p>}<p role="status" className="notice">{notice}</p></section>
 {alternatives.length>0 && <section className="alternatives"><div className="section-title"><h2>Also worth a look</h2><span>{alternatives.length} {alternatives.length===1?"alternative":"alternatives"}</span></div>{alternatives.map((quote,i)=><details className="seller-row" key={quote.id}><summary><span className="seller-index">{String(i+2).padStart(2,"0")}</span><span className="seller-name">{quote.seller}<small>{quote.guaranteed.kind==="known"?"Total to pay today":"Delivery not confirmed"}</small></span><span className="seller-price">{quote.guaranteed.kind==="known"?money(quote.guaranteed.amount):"Unconfirmed"}</span><span className="row-toggle">+</span></summary><QuoteDetails quote={quote}/></details>)}</section>}
 <section className="progress-section" aria-label="Search progress"><div className="progress-title"><h2>{finished?"All checks complete":view.stopRequested?"Search paused":"The search so far"}</h2><span>{view.progress.resolved} of {view.progress.total} checked</span></div><div className="progress-track" role="progressbar" aria-label="Resolved evidence checks" aria-valuemin={0} aria-valuemax={view.progress.total} aria-valuenow={view.progress.resolved}>{view.rows.map((row,i)=><span key={row.row.id} className={i<view.progress.resolved?"resolved":""}/>)}</div><p className="muted" role="status">{state.message}</p></section>
 <details className="evidence"><summary><span><Mark kind="check"/>Sources & small print</span><span>+</span></summary><h2>What we checked</h2><ul className="checklist">{view.rows.map(row=><li key={row.row.id}><h3>{row.row.label}</h3>{row.skippedBy==="person"?<p>Left out by you</p>:row.slots.every(slot=>slot.completion.kind==="pending")?<p className="muted">Not checked yet</p>:row.slots.filter(slot=>slot.completion.kind!=="pending").map(slot=><div key={slot.slot}><p>{slot.seller && <span>{slot.seller} · </span>}{slot.completion.kind==="gap"?slot.completion.reason:slot.completion.kind==="checked"?slot.completion.checked ?? "Checked":"Not checked yet"}</p>{slot.completion.kind==="checked" && slot.completion.proof.map((proof,i)=><p className="proof" key={i}><a href={proof.url} target="_blank" rel="noreferrer">View source</a> · {proof.note} · {new Date(proof.observedAt).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</p>)}</div>)}</li>)}</ul>
 <h2>All price scenarios</h2>{view.quotes.length===0 && <p>No confirmed quote yet.</p>}{view.quotes.map(quote=><QuoteDetails key={quote.id} quote={quote}/>)}
 <h2>Evidence gaps</h2>{view.gaps.length?<ul>{view.gaps.map((gap,i)=><li key={i}>{gap}</li>)}</ul>:<p>No named gaps.</p>}
 <details className="coverage-controls"><summary>Change what to compare</summary><label>Leave a check out<select value={excluded} onChange={event=>setExcluded(event.target.value)}>{view.rows.map(row=><option key={row.row.id} value={row.row.id}>{row.row.label}</option>)}</select></label><button disabled={disabled || !bridge || !controls?.skip.some(link=>link.row===excluded)} onClick={()=>{const link=controls?.skip.find(link=>link.row===excluded);if(link) void open(link.url);}}>Exclude check</button><p className="muted">Review and confirm before anything changes.</p></details></details>
 {view.ready && <p><a className="shop" href={view.ready.url} target="_blank" rel="noreferrer">Visit shop<Mark kind="arrow"/></a> {view.ready.steps.join(", ")}</p>}
 <footer><span>A good find, backed by the details.</span>{controls && <a href={controls.hub} target="_blank" rel="noreferrer">Manage search</a>}</footer></main>;
}
