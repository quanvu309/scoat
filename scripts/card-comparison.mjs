import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const escape=value=>String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
const definitions={
 progress:{before:[['h1','A generic title hides the product identity.'],['.controls>button:first-child','“Stop new discovery” uses technical language.'],['section:has(>h2:text("Checklist"))>h2','The checklist comes before any price.'],['.checklist>li:first-child','Checks expand into a long wall of evidence.']],after:[['h1','A product title anchors the Scoat Deal Ledger.'],['.controls','Watch, refine and pause use shopper language.'],['.hero-price','The best delivered price gets the spotlight.'],['.progress-track','One live bar shows progress; sellers sit above it.']]},
 finished:{before:[['h1','The title still describes a generic hunt.'],['.controls>button:first-child','An inactive discovery button leads the actions.'],['section:has(>h2:text("Checklist"))>h2','Even at 8/8, prices remain below the checklist.'],['.checklist>li:first-child','Expanded proof makes the result hard to scan.']],after:[['h1','Your product stays at the centre of the result.'],['.controls','A price watch and refinement are the next steps.'],['.hero-price','The final best deal is the first thing you see.'],['.alternatives','Other sellers are ordered by total price.']]},
 "watch-active":{before:[['header .badge','“Finished” does not acknowledge the active watch.'],['.controls>button:nth-of-type(2)','Watch controls offer no active confirmation.'],['section:has(>h2:text("Checklist"))>h2','The checklist still outranks the purchase price.']],after:[['.badge','“Watch active” reflects the confirmed receipt.'],['.watch-note','A clear confirmation explains the email alert.'],['.hero-price','The current delivered price stays visible.']]},
 error:{before:[['p[role="status"]:first-of-type','“Offline or stale” is easy to miss in body text.'],['.controls>button:first-child','A disabled discovery action dominates the card.'],['section:has(>h2:text("Checklist"))>h2','The checklist still buries your saved prices.']],after:[['.connection-note','A calm notice explains recovery and saved prices.'],['.controls','Clear actions remain beside your saved results.'],['.hero-price','Your last confirmed price remains the hero.']]}
};
export async function comparisonPoints(page,state,side){
 const frame=page.frameLocator("iframe"),points=[];
 for(const [selector,label] of definitions[state][side]){
  const box=await frame.locator(selector).first().boundingBox();
  assert(box && box.y>=0 && box.y+Math.min(box.height,20)<844,`${state}/${side}: callout outside phone viewport: ${selector}`);
  points.push({label,x:box.x+Math.min(box.width/2,26),y:box.y+Math.min(box.height/2,22)});
 }
 return points;
}
export async function renderComparisons(context,root,pairs,baseline,ownerPath){
 const files=[],dir=path.join(root,"compare");
 const data=async file=>`data:image/png;base64,${(await readFile(file)).toString("base64")}`;
 const render=async({file,title,subtitle,before,after,owner=false})=>{
  const imageY=154,width=owner?1820:1580,height=1080;
  const sides=[{...before,x:owner?300:318,labelX:24,width:owner?760:390,name:"BEFORE",caption:owner?"Owner’s original host capture":"origin/main · same harness + state"},{...after,x:owner?1380:1108,labelX:owner?1100:814,width:390,name:"AFTER",caption:"PR #29 · Deal Ledger · 390 × 844"}];
  const content=await Promise.all(sides.map(async side=>{
   const scale=side.width/(side.sourceWidth??390),imageHeight=(side.sourceHeight??844)*scale;
   let priorY=88;
   const tops=new Map([...side.points].sort((a,b)=>a.y-b.y).map(point=>{const top=Math.max(priorY+102,Math.min(880,Math.max(190,imageY+point.y*scale-39)));priorY=top;return [point,top];}));
   const labels=side.points.map((point,index)=>{
    const labelY=tops.get(point),targetX=side.x+point.x*scale,targetY=imageY+point.y*scale,startX=side.labelX+248,startY=labelY+39;
    return `<div class="pill" style="left:${side.labelX}px;top:${labelY}px"><span>${["①","②","③","④"][index]}</span><p>${escape(point.label)}</p></div><svg class="leader" width="${width}" height="${height}"><path d="M ${startX} ${startY} L ${side.x-20} ${startY} L ${targetX} ${targetY}" marker-end="url(#arrow)"/></svg>`;
   }).join("");
   return `<div class="side-label" style="left:${side.x}px">${side.name}<small>${escape(side.caption)}</small></div><img alt="${side.name}" style="left:${side.x}px;top:${imageY}px;width:${side.width}px;height:${imageHeight}px" src="${await data(side.file)}">${labels}`;
  }));
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escape(title)}</title><style>*{box-sizing:border-box}body{margin:0;width:${width}px;height:${height}px;overflow:hidden;background:#eef1f4;color:#1b3043;font:15px/1.45 system-ui,sans-serif}h1{position:absolute;left:24px;top:22px;margin:0;font-size:25px;letter-spacing:-.025em}header>p{position:absolute;left:24px;top:63px;margin:0;color:#526271;font-size:14px}.side-label{position:absolute;top:109px;font-size:13px;font-weight:750;letter-spacing:.12em;color:#315f87}.side-label small{display:block;font-size:10px;letter-spacing:0;font-weight:500;color:#526271}img{position:absolute;border:1px solid #cfd7df;box-shadow:0 8px 24px #1b304310;border-radius:8px}.pill{position:absolute;z-index:3;width:248px;min-height:78px;display:flex;align-items:flex-start;gap:10px;padding:14px;background:white;border:1px solid #d8e0e7;border-radius:13px;box-shadow:0 4px 14px #1b30430e}.pill>span{font-size:24px;line-height:1.15;color:#315f87}.pill>p{margin:0;font-size:14px;color:#1b3043}.leader{position:absolute;inset:0;z-index:2;pointer-events:none}.leader path{fill:none;stroke:#315f87;stroke-width:2;stroke-dasharray:2 5;stroke-linecap:round}footer{position:absolute;left:24px;bottom:20px;font-size:12px;color:#526271}</style></head><body><svg width="0" height="0"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 1 1 L 7 4 L 1 7" fill="none" stroke="#315f87" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></marker></defs></svg><header><h1>${escape(title)}</h1><p>${escape(subtitle)}</p></header>${content.join("")}<footer>${owner?"Reference capture supplied by owner; product and host width differ from the controlled fixture.":`Controlled comparison · baseline ${baseline.slice(0,7)} · identical persisted shopping data and host mode.`} Screenshots are unchanged; annotations sit outside the frames.</footer></body></html>`;
  const page=await context.newPage();await page.setViewportSize({width,height});await page.setContent(html);await page.locator("img").last().waitFor();await page.evaluate(()=>Promise.all([...document.images].map(image=>image.decode())));await page.screenshot({path:path.join(dir,file)});await page.close();
  await writeFile(path.join(dir,file.replace(".png",".html")),html);files.push({file:`compare/${file}`,state:before.state??"progress",theme:before.theme??"light",source:owner?"owner host reference":"origin/main"});
 };
 for(const pair of pairs) await render({file:`${pair.state}-phone-${pair.theme}.png`,title:`scoat. / ${pair.state.replaceAll("-"," ")} · ${pair.theme}`,subtitle:"BEFORE → AFTER · matched numbered callouts · phone viewport 390 × 844",before:{file:path.join(root,pair.before),points:pair.beforePoints,state:pair.state,theme:pair.theme},after:{file:path.join(root,pair.after),points:pair.afterPoints}});
 const progress=pairs.find(pair=>pair.state==="progress" && pair.theme==="light");
 if(ownerPath && progress) await render({file:"progress-owner-host.png",title:"scoat. / the owner’s host capture → Deal Ledger",subtitle:"Original host reference alongside the phone design · matched numbered callouts",owner:true,before:{file:ownerPath,sourceWidth:1594,sourceHeight:1490,points:[{x:100,y:205,label:"The host card opens with a generic hunt title."},{x:140,y:570,label:"Discovery jargon leads the control panel."},{x:100,y:982,label:"A checklist outranks the deal itself."},{x:100,y:1348,label:"Repeated pending sellers and Skip buttons fill the card."}]},after:{file:path.join(root,progress.after),points:progress.afterPoints}});
 return files;
}
