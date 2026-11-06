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
function Mark({kind}:{kind:"bell"|"arrow"|"chevron"}) {
 return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind==="bell"?<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>:kind==="arrow"?<path d="M6 18 18 6M6 6h12v12"/>:<path d="m6 9 6 6 6-6"/>}</svg>;
}
function productName(product:Snapshot["value"]["view"]["intent"]["product"]) {
 if(product.kind==="description") return product.text;
 const url=new URL(product.url),slug=url.pathname.split("/").filter(Boolean).at(-1);
 if(!slug || !/[a-z]/i.test(slug)) return url.hostname.replace(/^www\./,"");
 try {return decodeURIComponent(slug).replace(/\.html?$/i,"").replace(/[-_]+/g," ").replace(/\b[a-z]/g,letter=>letter.toUpperCase());} catch {return url.hostname.replace(/^www\./,"");}
}
export function WaitingCard() {
 return <main className="card waiting"><header><span className="wordmark">scoat<span>.</span></span></header><h1>Opening your search…</h1><p className="muted" role="status">Waiting for the first result.</p></main>;
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
 const offline=state.message.startsWith("Offline");
 const label=offline?"Reconnecting":state.status==="revoked"?"Sign in to reconnect":state.status==="unsupported" && !finished?"Live updates unavailable":watching?"Watch active":finished?"Search complete":view.stopRequested?"Search paused":state.status==="stale"?"Updating":hero?"Comparing":"Starting";
 const priceSource=hero?.guaranteed.lines.find(line=>line.label==="price" && line.status.kind==="confirmed")?.proof.url;
 const shopUrl=priceSource && view.ready && new URL(priceSource).origin===new URL(view.ready.url).origin?view.ready.url:priceSource;
 async function open(url:string) {try{if(bridge) await bridge.openLink(url);else window.open(url,"_blank","noopener,noreferrer");setNotice("Review and confirm in the page that opened.");}catch{setNotice("The link could not open. Use Manage search below.");}}
 async function refine() {try{if(!bridge?.sendMessage) throw new Error("Unavailable");await bridge.sendMessage("Help me refine this Scoat search: ask what I want to change about the product, budget or seller preferences before starting a new hunt.");setNotice("Back in the conversation, tell your assistant what you would like to change.");}catch{setNotice('Tell your assistant: “Refine this search — my budget or preferences have changed.”');}}
 return <main className="card" data-status={state.status}><header><span className="wordmark">scoat<span>.</span></span><div className={"progress-line "+(offline?"connection-note":"")} role={offline || state.status==="revoked"?"alert":"status"}><span className="status-dot"/>{watching && !offline && <Mark kind="bell"/>}<span className="state-label">{label}</span>{!offline && state.status!=="revoked" && !watching && !finished && <span className="progress-count"><span role="progressbar" aria-label="Resolved evidence checks" aria-valuemin={0} aria-valuemax={view.progress.total} aria-valuenow={view.progress.resolved}>{view.progress.resolved}/{view.progress.total} checks</span></span>}</div></header>
 <h1>{productName(view.intent.product)}{view.intent.variant && <span className="variant"> · {view.intent.variant}</span>}</h1>
 <section className={"hero "+(!hero?"hero-empty":"")} aria-label={finished?"Finished quote":"Best deal so far"}>
 {hero?<><div className="hero-content"><div><h2 className="hero-seller">{offline?"Last saved price":finished?"Best price":"Best so far"} <span>· {hero.seller}</span></h2><p className="hero-price">{hero.guaranteed.kind==="known"?money(hero.guaranteed.amount):"Unconfirmed"}</p><p className="price-note">{hero.guaranteed.kind==="known"?"Includes delivery":"Price or delivery unconfirmed"}{hero.budget.kind==="within" && hero.guaranteed.kind==="known" && view.intent.budget?<span className="budget-fit"> · {money({currency:view.intent.budget.currency,pence:view.intent.budget.pence-hero.guaranteed.amount.pence})} under budget</span>:view.intent.budget?<span> · {budget(hero.budget)}</span>:null}</p></div>{shopUrl && <a className="shop primary" href={shopUrl} target="_blank" rel="noreferrer">Visit {hero.seller}<Mark kind="arrow"/></a>}</div></>:<><h2>Waiting for the first price</h2><p className="muted">Checking sellers, delivery and discounts.</p></>}
 </section>
 {alternatives.length>0 && <section className="alternatives" aria-label="Alternative prices">{alternatives.slice(0,2).map(quote=><div className="seller-row" key={quote.id}><span>{quote.seller}</span><span className="seller-price">{quote.guaranteed.kind==="known"?money(quote.guaranteed.amount):"Delivery unconfirmed"}</span></div>)}</section>}
 <section aria-label="Search actions" className="controls">
 {!watching && hero && <button disabled={(!finished && state.status!=="live") || offline || state.status==="revoked"} onClick={()=>controls?.watch.available?void open(controls.watch.url):setNotice(controls && !controls.watch.available?controls.watch.reason:"Finish this search before setting a price watch.")}><Mark kind="bell"/>Watch price</button>}
 <button onClick={()=>void refine()}>Refine search</button>{!finished && <button className="quiet" disabled={disabled || view.stopRequested || !controls || !bridge} onClick={()=>controls && void open(controls.stop)}>Pause search</button>}
 </section>{notice && <p role="status" className="notice">{notice}</p>}
 <details className="evidence"><summary>Sources & small print<Mark kind="chevron"/></summary><h2>What we checked</h2><ul className="checklist">{view.rows.map(row=><li key={row.row.id}><h3>{row.row.label}</h3>{row.skippedBy==="person"?<p>Left out by you</p>:row.slots.every(slot=>slot.completion.kind==="pending")?<p className="muted">Not checked yet</p>:row.slots.filter(slot=>slot.completion.kind!=="pending").map(slot=><div key={slot.slot}><p>{slot.seller && <span>{slot.seller} · </span>}{slot.completion.kind==="gap"?slot.completion.reason:slot.completion.kind==="checked"?slot.completion.checked ?? "Checked":"Not checked yet"}</p>{slot.completion.kind==="checked" && slot.completion.proof.map((proof,i)=><p className="proof" key={i}><a href={proof.url} target="_blank" rel="noreferrer">View source</a> · {proof.note} · {new Date(proof.observedAt).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}</p>)}</div>)}</li>)}</ul>
 {view.intent.budget && <p>Budget {money(view.intent.budget)}</p>}<h2>All price scenarios</h2>{view.quotes.length===0 && <p>No confirmed quote yet.</p>}{view.quotes.map(quote=><QuoteDetails key={quote.id} quote={quote}/>)}
 <h2>Evidence gaps</h2>{view.gaps.length?<ul>{view.gaps.map((gap,i)=><li key={i}>{gap}</li>)}</ul>:<p>No named gaps.</p>}
 <details className="coverage-controls"><summary>Change what to compare</summary><label>Leave a check out<select value={excluded} onChange={event=>setExcluded(event.target.value)}>{view.rows.map(row=><option key={row.row.id} value={row.row.id}>{row.row.label}</option>)}</select></label><button disabled={disabled || !bridge || !controls?.skip.some(link=>link.row===excluded)} onClick={()=>{const link=controls?.skip.find(link=>link.row===excluded);if(link) void open(link.url);}}>Exclude check</button><p className="muted">Review and confirm before anything changes.</p></details>
 {view.ready && <p className="muted">{view.ready.steps.join(", ")}</p>}
 {controls && <p><a href={controls.hub} target="_blank" rel="noreferrer">Manage search</a></p>}</details></main>;
}
