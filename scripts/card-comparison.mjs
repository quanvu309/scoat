import assert from "node:assert/strict";
import { copyFile, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
const escape=value=>String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");
const definitions={
 progress:{before:[['h1','Generic hunt title; product identity is missing.'],['.controls>button:first-child','The leading action stops discovery.'],['.checklist>li:first-child','Expanded checks put the price below the fold.']],after:[['h1','One product line, including the selected variant.'],['.controls>.quiet','Stop search is a quiet trailing action.'],['.alternatives','Two seller rows show how much more each costs.']]},
 finished:{before:[['h1','Generic title remains after the search finishes.'],['.controls>button:first-child','A disabled discovery action leads the result.'],['section:has(>h2:text("Checklist"))>h2','The checklist appears before the winning price.']],after:[['h1','The product remains the heading.'],['.hero .shop','Visit the winning seller directly from the price.'],['.hero-price','A stronger price figure leads the finished comparison.']]},
 "watch-active":{before:[['h1','The generic heading does not identify the product.'],['header .badge','Finished status does not acknowledge the active watch.'],['section:has(>h2:text("Checklist"))>h2','Evidence checks outrank the current deal.']],after:[['h1','The product and variant remain visible while watching.'],['.watch-note','A blue bell confirms alerts without repeating the product.'],['.hero-price','The delivered price and shop action stay together.']]},
 error:{before:[['p[role="status"]:first-of-type','Connection failure appears as ordinary body text.'],['.controls>button:first-child','A disabled discovery button dominates the actions.'],['section:has(>h2:text("Checklist"))>h2','Checks still appear before the last saved price.']],after:[['.connection-note','One tinted notice explains the outage and saved-price time.'],['.controls','Refine leads; unavailable actions are hidden offline.'],['.hero-price','The saved hero is labelled and visually subdued.']]}
};
export async function comparisonPoints(page,state,side){
 const frame=page.frameLocator("iframe"),points=[];
 for(const [selector,label] of definitions[state][side]){
  const box=await frame.locator(selector).first().boundingBox();
  assert(box && box.y>=0 && box.y+Math.min(box.height,20)<844,`${state}/${side}: callout outside phone viewport: ${selector}`);
  points.push({label,x:Math.min(377,box.x+box.width-4),y:Math.max(12,box.y-8)});
 }
 return points;
}
export async function renderComparisons(context,root,pairs,baseline,ownerPath){
 const files=[],dir=path.join(root,"compare");
 const data=async file=>"data:image/png;base64,"+(await readFile(file)).toString("base64");
 for(const pair of pairs){
  const sides=[{name:"BEFORE",caption:`origin/main · ${baseline.slice(0,7)}`,file:pair.before,points:pair.beforePoints},{name:"AFTER",caption:"PR #29 · Deal Ledger",file:pair.after,points:pair.afterPoints}];
  const frames=await Promise.all(sides.map(async side=>`<section><h2>${side.name}<small>${escape(side.caption)}</small></h2><div class="frame"><img alt="${side.name}" src="${await data(path.join(root,side.file))}">${side.points.map((point,i)=>`<span class="dot" style="left:${point.x}px;top:${point.y}px">${i+1}</span>`).join("")}</div></section>`));
  const legend=pair.beforePoints.map((point,i)=>`<div class="legend-row"><span class="number">${i+1}</span><p><b>Before</b> ${escape(point.label)}</p><p><b>After</b> ${escape(pair.afterPoints[i].label)}</p></div>`).join("");
  const html=`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Scoat ${escape(pair.state)} comparison</title><style>*{box-sizing:border-box}body{margin:0;padding:26px;width:860px;background:#eef0f2;color:#242a31;font:14px/1.5 system-ui,sans-serif}h1{font-size:23px;letter-spacing:-.02em;margin:0 0 6px}header p{margin:0 0 20px;color:#505a65;font-size:13px}.frames{display:grid;grid-template-columns:390px 390px;gap:28px}h2{font-size:14px;margin:0 0 10px}h2 small{display:block;font-size:13px;font-weight:400;color:#505a65}.frame{position:relative;width:390px;height:844px;background:white;outline:1px solid #c5cbd1;border-radius:8px}img{display:block;width:390px;height:844px;border-radius:8px}.dot,.number{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:#c5222e;color:white;font:700 13px/1 system-ui;flex:none}.dot{position:absolute;transform:translate(-50%,-50%);box-shadow:0 0 0 2px white}footer{margin-top:22px;padding-top:16px;border-top:1px solid #c5cbd1}.legend-row{display:grid;grid-template-columns:22px 1fr 1fr;gap:12px;margin-bottom:12px}.legend-row p{margin:0;font-size:13px}.legend-row b{display:block;margin-bottom:2px}footer>p{font-size:13px;color:#505a65;margin:14px 0 0}</style></head><body><header><h1>${escape(pair.state.replaceAll("-"," "))} · phone · ${pair.theme}</h1><p>Rendered from the real card build with fixture data.<br>Identical product, persisted hunt and 390 × 844 host viewport on both sides.</p></header><main class="frames">${frames.join("")}</main><footer>${legend}<p>Both builds receive the same authenticated MCP snapshot and host mode. Prices are synthetic review data. Red dots are HTML overlays; the captures beneath them are unchanged.</p></footer></body></html>`;
  const file=`${pair.state}-phone-${pair.theme}.png`,page=await context.newPage();
  await page.setViewportSize({width:860,height:1300});await page.setContent(html);await page.evaluate(()=>Promise.all([...document.images].map(image=>image.decode())));await page.screenshot({path:path.join(dir,file),fullPage:true});await page.close();
  await writeFile(path.join(dir,file.replace(".png",".html")),html);files.push({file:`compare/${file}`,state:pair.state,theme:pair.theme,source:"matched real card builds"});
 }
 if(ownerPath) await copyFile(ownerPath,path.join(dir,"reference-owner-host.png"));
 return files;
}
