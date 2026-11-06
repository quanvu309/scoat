import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import { withDatabase } from "./durable-database.mjs";
import { watchFixture, productUrl } from "./watch-fixture.mjs";
import { serveCard } from "./card-fixture.mjs";
import { comparisonPoints, renderComparisons } from "./card-comparison.mjs";
const root=process.env.SCOAT_EVIDENCE_DIR??path.join(os.homedir(),"tmp/scoat-ui-council/round-4");
await mkdir(root,{recursive:true});
const matrix=[],errors=[],proofs=[],comparisons=[],readability=[];
const beforePath=process.env.SCOAT_BEFORE_CARD;
const baseline=beforePath?execFileSync("git",["rev-parse","origin/main"],{encoding:"utf8"}).trim():undefined;
if(beforePath) await mkdir(path.join(root,"compare/before"),{recursive:true});
let completed=false;
const head=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
await withDatabase(async databaseUrl=>{
 const w=await watchFixture(databaseUrl),{f}=w;
 const browser=await chromium.launch();
 const context=await browser.newContext({ignoreHTTPSErrors:true,reducedMotion:"reduce",viewport:{width:760,height:1000},recordVideo:{dir:path.join(root,"recordings"),size:{width:760,height:1000}}});
 context.setDefaultTimeout(20000);
 const page=await context.newPage(),cards=[];
 page.on("pageerror",error=>errors.push(error.message));
 try {
  const login=await f.login();
  const call=async(name,input)=>{const result=await f.tool(login.token,name,input);assert(!result.isError,JSON.stringify(result));assert(result.structuredContent?.ok,JSON.stringify(result));return result.structuredContent;};
  const hunt=input=>call("scoat_hunt",input);
  const memory=input=>call("scoat_memory",input);
  const open=async(snapshot)=>{const card=await serveCard(f,login,snapshot);cards.push(card);await page.goto(card.url);await page.frameLocator("iframe").locator(snapshot.value.view.final.kind==="finished"?".state-label":"main[data-status=live]").waitFor();};
  const capture=async(state,watchReceipt)=>{
   const pairs=[];
   for(const [size,width,height] of [["desktop",760,1000],["phone",390,844]]) for(const theme of ["light","dark"]){
    await page.setViewportSize({width,height});await page.emulateMedia({colorScheme:theme,reducedMotion:"reduce"});await page.evaluate(value=>window.harness.theme(value),theme);
    const frame=page.frameLocator("iframe");await frame.locator(`html[data-theme="${theme}"]`).waitFor();
    const fonts=await frame.locator("body").evaluate(async()=>{await document.fonts.ready;return [...document.fonts].filter(face=>face.family==="Inter").map(face=>face.status);});
    assert(fonts.length>0 && fonts.every(status=>status==="loaded"),JSON.stringify({fonts}));
    await frame.locator("body").evaluate(()=>window.scrollTo(0,0));
    assert(await frame.locator("body").evaluate(el=>el.scrollWidth<=el.clientWidth+1));
    assert.equal(await frame.getByText(/Seller unknown: pending|Checklist 0\/8|Stop new discovery|Open browser controls/).count(),0);
    const audit=await frame.locator("main").evaluate(main=>{
     const canvas=document.createElement("canvas");canvas.width=canvas.height=1;const context=canvas.getContext("2d");
     const parse=color=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);const [r,g,b,a]=context.getImageData(0,0,1,1).data;return [r,g,b,a/255];};
     const luminance=color=>color.slice(0,3).map(n=>{const c=n/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;}).reduce((sum,c,i)=>sum+c*[.2126,.7152,.0722][i],0);
     const walker=document.createTreeWalker(main,NodeFilter.SHOW_TEXT),failures=[],ratios=[],sizes=[];
     while(walker.nextNode()){
      const node=walker.currentNode,el=node.parentElement;if(!node.textContent.trim() || !el) continue;
      const range=document.createRange();range.selectNodeContents(node);const box=range.getBoundingClientRect();if(!box.width || !box.height || box.top>=innerHeight || box.bottom<=0) continue;
      const style=getComputedStyle(el),size=parseFloat(style.fontSize);let parent=el,background=[255,255,255];
      if(el.closest(":disabled")){sizes.push(size);if(size<13) failures.push({text:node.textContent.trim(),size});continue;}
      while(parent){const value=parse(getComputedStyle(parent).backgroundColor);if(value.length===3 || value[3]===1){background=value;break;}parent=parent.parentElement;}
      const a=luminance(parse(style.color)),b=luminance(background),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05),large=size>=24 || size>=18.66 && Number(style.fontWeight)>=700;
      ratios.push(ratio);sizes.push(size);if(size<13 || ratio<(large?3:4.5)) failures.push({text:node.textContent.trim(),size,ratio});
     }
     return {minimumFont:Math.min(...sizes),minimumContrast:Math.min(...ratios),failures,height:main.getBoundingClientRect().height,priceWeight:main.querySelector(".hero-price")?Number(getComputedStyle(main.querySelector(".hero-price")).fontWeight):undefined,primaryActions:main.querySelectorAll(".primary").length};
    });
    assert.deepEqual(audit.failures,[],JSON.stringify({state,size,theme,audit}));assert.equal(audit.primaryActions,state==="empty"?0:1);if(state!=="empty") assert(audit.priceWeight>=700);if(size==="phone") assert(audit.height<=844,`${state}: core exceeds phone fold`);
    if(state==="error"){
     assert.match(await frame.locator('header [role="status"]').innerText(),/Paused\s*·\s*3 of 8 checked/);assert.equal(await frame.getByRole("alert").count(),1);assert.equal(await frame.locator(".progress-paused").evaluate(el=>getComputedStyle(el).animationName),"none");
     const observedAt=view.best.guaranteed.lines.find(line=>line.label==="price").proof.observedAt;const savedAt=await frame.locator("main").evaluate((_,value)=>new Intl.DateTimeFormat(undefined,{hour:"2-digit",minute:"2-digit"}).format(new Date(value)),observedAt);assert.equal(await frame.getByRole("alert").innerText(),`Can't reach Scoat right now. Showing the price saved at ${savedAt}.`);
     await frame.locator(".hero-stale").waitFor();await frame.getByRole("heading",{name:/^Last saved price/}).waitFor();
     assert.equal(await frame.locator(".controls button").count(),1);assert(await frame.getByRole("button",{name:"Refine search"}).isEnabled());
    }
    if(state==="progress" || state==="finished"){
     assert.match(await frame.locator(".alternatives").innerText(),/£5.00 more/);
     if(size==="phone") assert(await frame.locator(".price-note").evaluate(el=>el.getBoundingClientRect().height<=parseFloat(getComputedStyle(el).lineHeight)+1),"Phone price caption must fit one line");
    }
    await frame.getByText("How we checked",{exact:true}).waitFor();
    if(state==="watch-active"){
     assert.match(await frame.locator("h1").innerText(),/Raspberry Pi 5/);assert.equal(await frame.locator(".watch-note").innerText(),"Price alerts on · we'll email you if it drops.");assert.match(await frame.locator("header [role=status]").innerText(),/Search complete\s*·\s*8 of 8 checked/);
     assert.equal(await frame.locator("h1").evaluate(el=>getComputedStyle(el).marginBottom),"8px");assert.equal(await frame.locator(".watch-note").evaluate(el=>getComputedStyle(el).marginBottom),"8px");assert.equal(await frame.locator(".watch-note svg").evaluate(el=>getComputedStyle(el).color),await frame.locator(".watch-label").evaluate(el=>getComputedStyle(el).color));
    }
    if(state==="empty" || state==="progress"){
     const stop=frame.getByRole("button",{name:"Stop search",exact:true});assert.equal(await stop.evaluate(el=>getComputedStyle(el).backgroundColor),"rgba(0, 0, 0, 0)");assert.equal(await stop.evaluate(el=>getComputedStyle(el).fontWeight),"500");if(size==="phone") assert((await stop.boundingBox()).height>=44);
    }
    readability.push({state,size,theme,fonts,...audit});
    const file=`${state}-${size}-${theme}.png`;await page.screenshot({path:path.join(root,file)});matrix.push({state,size,theme,width,height,file});
    if(beforePath && size==="phone" && state!=="empty") pairs.push({state,theme,after:file,afterPoints:await comparisonPoints(page,state,"after")});
   }
   if(pairs.length){
    const snapshot=await hunt({op:"read",hunt:view.hunt});
    const card=await serveCard(f,login,snapshot,()=>undefined,beforePath);cards.push(card);
    const old=await context.newPage();await old.setViewportSize({width:390,height:844});await old.goto(card.url);const frame=old.frameLocator("iframe");await frame.locator("h1").waitFor();
    if(snapshot.value.view.final.kind!=="finished") await frame.getByText("Current hunt",{exact:true}).waitFor();
    if(state==="error"){await old.evaluate(()=>window.harness.setMode("outage"));await frame.getByText("Offline or stale. Retrying; controls paused.",{exact:true}).waitFor();}
    if(watchReceipt) await old.evaluate(({input,result})=>window.harness.result(input,{content:[],structuredContent:result}),{input:{op:"watch",hunt:view.hunt},result:watchReceipt});
    for(const pair of pairs){
     await old.emulateMedia({colorScheme:pair.theme,reducedMotion:"reduce"});await old.evaluate(theme=>window.harness.theme(theme),pair.theme);await frame.locator("body").evaluate(()=>window.scrollTo(0,0));
     pair.before=`compare/before/${state}-phone-${pair.theme}.png`;pair.beforePoints=await comparisonPoints(old,state,"before");await old.screenshot({path:path.join(root,pair.before)});comparisons.push(pair);
    }
    await old.close();
   }
   console.log(JSON.stringify({state,screenshots:4,status:"PASS"}));
  };
  let result=await hunt({op:"start",requestKey:randomUUID(),intent:{product:{kind:"description",text:"Nike Air Max 90"},variant:"UK 6 · Black / white",shop:"nike",budget:{currency:"GBP",pence:11000}}});
  let view=result.value.view;
  await open(result);await capture("empty");
  const record=async(rowId,slot,outcome)=>{const row=view.rows.find(row=>row.row.id===rowId);result=await hunt({op:"record",requestKey:randomUUID(),hunt:view.hunt,row:rowId,slot,expected:row.revision,outcome});view=result.value.view;};
  const addPrice=async(row,slot,seller,pence,url)=>{
   const base={seller,variant:view.intent.variant,status:{kind:"confirmed"},proof:{url,observedAt:new Date().toISOString(),note:"SYNTHETIC council fixture. No live retailer price claim."},validUntil:null};
   await record(row,slot,{kind:"found",offers:[{...base,kind:"price",amount:{currency:"GBP",pence}},{...base,kind:"delivery",amount:{currency:"GBP",pence:0}}]});
   const offers=view.offers.filter(offer=>offer.seller===seller).map(offer=>offer.id);
   result=await hunt({op:"compatibility",requestKey:randomUUID(),hunt:view.hunt,evidence:{offers,proof:[base.proof]}});view=result.value.view;
  };
  await addPrice(view.rows[0].row.id,view.rows[0].slots[0].slot,"Nike",8999,"https://www.nike.com/gb/");
  const others=view.rows.find(row=>row.row.place==="other-sellers");
  await addPrice(others.row.id,others.slots[0].slot,"JD Sports",9999,"https://www.jdsports.co.uk/");
  await addPrice(others.row.id,others.slots[1].slot,"Footasylum",9499,"https://www.footasylum.com/");
  for(const slot of view.rows.find(row=>row.row.id===others.row.id).slots.filter(slot=>slot.completion.kind==="pending")) await record(others.row.id,slot.slot,{kind:"gap",reason:"No further matching seller in this synthetic fixture."});
  const next=view.rows.find(row=>row.row.id!==others.row.id && row.slots.some(slot=>slot.completion.kind==="pending"));
  for(const slot of next.slots.filter(slot=>slot.completion.kind==="pending")) await record(next.row.id,slot.slot,{kind:"gap",reason:"No matching discount in this synthetic fixture."});
  await page.frameLocator("iframe").getByText("3 of 8 checked",{exact:true}).waitFor();
  await capture("progress");
  await page.evaluate(()=>window.harness.setMode("outage"));
  await page.frameLocator("iframe").getByRole("alert").waitFor();await capture("error");
  await page.evaluate(()=>window.harness.setMode("live"));await page.frameLocator("iframe").locator("main[data-status=live]").waitFor();
  for(const row of view.rows) for(const slot of row.slots.filter(slot=>slot.completion.kind==="pending")) await record(row.row.id,slot.slot,{kind:"gap",reason:"No additional benefit in this synthetic fixture."});
  result=await hunt({op:"finish",requestKey:randomUUID(),hunt:view.hunt,selection:null});view=result.value.view;
  await page.frameLocator("iframe").getByText("Search complete",{exact:true}).waitFor();await capture("finished");
  proofs.push({state:"finished",hunt:view.hunt,resolved:view.progress.resolved,total:view.progress.total,best:view.final.quote.seller,amount:view.final.quote.guaranteed});
  result=await hunt({op:"start",requestKey:randomUUID(),intent:{product:{kind:"url",url:productUrl},variant:"4GB",shop:null,budget:{currency:"GBP",pence:8000}}});view=result.value.view;
  const row=view.rows[0];
  const base={seller:"The Pi Hut",variant:"4GB",status:{kind:"confirmed"},proof:{url:productUrl,observedAt:new Date().toISOString(),note:"SYNTHETIC council fixture. No live retailer price claim."},validUntil:null};
  await record(row.row.id,row.slots[0].slot,{kind:"found",offers:[{...base,kind:"price",amount:{currency:"GBP",pence:6620}},{...base,kind:"delivery",amount:{currency:"GBP",pence:380}}]});
  result=await hunt({op:"compatibility",requestKey:randomUUID(),hunt:view.hunt,evidence:{offers:view.offers.map(offer=>offer.id),proof:[base.proof]}});view=result.value.view;
  for(const row of view.rows) for(const slot of row.slots.filter(slot=>slot.completion.kind==="pending")) await record(row.row.id,slot.slot,{kind:"gap",reason:"No additional benefit in this synthetic fixture."});
  result=await hunt({op:"finish",requestKey:randomUUID(),hunt:view.hunt,selection:null});view=result.value.view;
  const watchHunt=view.hunt;await open(result);
  const watchRequest={op:"watch",requestKey:randomUUID(),hunt:watchHunt,target:{currency:"GBP",pence:6000}};
  const proposal=await memory(watchRequest);assert.equal(proposal.value.kind,"confirmation-required");
  await page.evaluate(({input,result})=>window.harness.result(input,{content:[],structuredContent:result}),{input:{op:"watch",hunt:watchHunt},result:proposal});
  assert.equal(await page.frameLocator("iframe").locator(".watch-note").count(),0);
  await f.setEmail({email:"shopper@example.test",email_verified:true});
  const approval=await context.newPage();await approval.goto(proposal.value.url);await f.nativeLogin(approval);
  await approval.getByRole("button",{name:"Start watching",exact:true}).click();await approval.getByText("Watch active",{exact:true}).waitFor();await approval.close();
  const receipt=await memory(watchRequest);assert.equal(receipt.value.kind,"watching");
  await page.evaluate(({input,result})=>window.harness.result(input,{content:[],structuredContent:result}),{input:{op:"watch",hunt:randomUUID()},result:receipt});
  assert.equal(await page.frameLocator("iframe").locator(".watch-note").count(),0);
  await page.evaluate(({input,result})=>window.harness.result(input,{content:[],structuredContent:result}),{input:{op:"watch",hunt:watchHunt},result:receipt});
  await page.frameLocator("iframe").locator(".watch-note").waitFor();await capture("watch-active",receipt);
  proofs.push({state:"watch-active",hunt:watchHunt,receipt:receipt.value.kind,activation:"native browser confirmation",proposalShowsActive:false,foreignHuntShowsActive:false});
  const order=["empty","progress","finished","watch-active","error"];matrix.sort((a,b)=>order.indexOf(a.state)-order.indexOf(b.state));
  const contact=await context.newPage();
  const tiles=await Promise.all(matrix.map(async item=>`<figure><figcaption>${item.state} · ${item.size} · ${item.theme}</figcaption><img src="data:image/png;base64,${(await readFile(path.join(root,item.file))).toString("base64")}"/></figure>`));
  await contact.setViewportSize({width:1600,height:1000});
  await contact.setContent(`<html><head><title>Scoat · Deal Ledger · Council round 4</title><style>*{box-sizing:border-box}body{margin:0;padding:32px;background:#e8e9ec;font:14px system-ui;color:#202b42}h1{margin:0 0 8px}p{margin:0 0 24px}main{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}figure{margin:0;background:white;padding:10px;border-radius:8px}figcaption{margin-bottom:10px;font-size:12px;font-weight:600}img{display:block;width:100%;height:460px;object-fit:contain;object-position:top}</style></head><body><h1>scoat. / Council round 4</h1><p>Council round 4 · Five states × two host widths × light and dark. Synthetic shopping data rendered through the production card.</p><main>${tiles.join("")}</main></body></html>`);
  await contact.locator("img").last().waitFor();await contact.screenshot({path:path.join(root,"contact-sheet.png"),fullPage:true});await contact.close();
  assert.equal(errors.length,0,errors.join("\n"));
  const comparisonFiles=beforePath?await renderComparisons(context,root,comparisons,baseline,process.env.SCOAT_OWNER_CAPTURE):[];
  const index=["# Scoat card — council round 4","","Production card build, real ext-apps App/AppBridge harness, authenticated MCP and isolated PostgreSQL. All prices are synthetic review fixtures, not live retailer claims. No external email was sent.","","Desktop: 760 × 1000. Phone: 390 × 844. Host theme changes are negotiated through AppBridge. Screenshots are unaltered viewport captures, with reduced motion enabled.","","[Contact sheet](contact-sheet.png) · [Short recording](walkthrough.webm)","",`Chromium checks visible text, with disabled controls excluded from contrast requirements: minimum ${Math.min(...readability.map(item=>item.minimumFont))}px; normal text ≥4.5:1 and large text ≥3:1 in both themes. Every collapsed phone card fits above the 844px fold. Full measured results: [receipt.json](receipt.json).`,"","| State | Size | Theme | Screenshot |","| --- | --- | --- | --- |",...matrix.map(item=>`| ${item.state} | ${item.size} | ${item.theme} | [${item.file}](${item.file}) |`),"","Watch keeps the completed-search header, identifies the product in the title and confirms email alerts without repeating it. The receipt does not expose the confirmed target or address, so neither is inferred from the proposal. The progress state contains three persisted checks and three sellers. Error is an actual unavailable harness tool response with saved prices retained. Watch active follows native browser confirmation and a schema-validated Memory receipt for the displayed hunt; a proposal or another hunt’s receipt cannot activate it.","","Reproduce after `npm run build`: `SCOAT_EVIDENCE_DIR=~/tmp/scoat-ui-council/round-4 pstack-run run --timeout 240 -- node scripts/card-review.mjs`.",""];
  if(comparisonFiles.length) index.push("## Annotated Before / After","",`Baseline: origin/main at ${baseline}. Both card builds use the same AppBridge harness, persisted hunt and phone viewport. The active Watch receipt is delivered to both builds. Error uses the same unavailable bridge response. Small red numbered dots sit directly on element bounds. Matching numbers map to a footer legend below equal 390 × 844 frames. No arrows or side cards. Every pair is labelled as real card builds with fixture data.`,"","| State | Theme | Comparison | Overlay |","| --- | --- | --- | --- |",...comparisonFiles.map(item=>`| ${item.state} | ${item.theme} | [${item.file}](${item.file}) | [HTML](${item.file.replace(".png",".html")}) |`),"","The [owner host capture](compare/reference-owner-host.png) is a separate, unannotated reference; its product and host width differ and it is excluded from the controlled comparisons. Controlled before captures are in [compare/before/](compare/before/). Every comparison has an adjacent HTML overlay for inspection.","","| Baseline state | Theme | Raw screenshot |","| --- | --- | --- |",...comparisons.map(item=>`| ${item.state} | ${item.theme} | [${item.before}](${item.before}) |`),"","To include comparisons, build origin/main in an isolated archive and set `SCOAT_BEFORE_CARD` to its `dist/card/index.html`. Set `SCOAT_OWNER_CAPTURE` to the supplied host screenshot.","");
  await writeFile(path.join(root,"index.md"),index.join("\n"));await writeFile(path.join(root,"receipt.json"),JSON.stringify({status:"PASS",head,baseline,fixture:"production card / real AppBridge / authenticated MCP / synthetic prices / local mail capture",matrix,comparisons:comparisonFiles,callouts:comparisons,readability,proofs,errors},null,2));
  completed=true;console.log(JSON.stringify({status:"PASS",screenshots:matrix.length,root}));
 } finally {await context.close();await browser.close();for(const card of cards) await card.close();await w.close();if(completed){await rename(await page.video().path(),path.join(root,"walkthrough.webm"));await rm(path.join(root,"recordings"),{recursive:true,force:true});}}
});
