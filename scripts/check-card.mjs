import { parse } from "@babel/parser";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
function walk(node, visit) {
 if(!node || typeof node!=="object") return;
 visit(node);
 for(const value of Object.values(node)) if(Array.isArray(value)) value.forEach(item=>walk(item,visit));else if(value && typeof value==="object") walk(value,visit);
}
export function checkCardBuild(config, adapter, manifest) {
 let preserved=false;
 walk(parse(config,{sourceType:"module",plugins:["typescript"]}),node=>{
  if(node.type==="ObjectProperty" && node.key.type==="Identifier" && node.key.name==="emptyOutDir") preserved=node.value.type==="BooleanLiteral" && node.value.value===false;
 });
 if(!preserved) throw new Error("Preserve emitted card controller modules alongside the HTML bundle");
 const adapterAst=parse(adapter,{sourceType:"module",plugins:["typescript"]});
 let receive;
 walk(adapterAst,node=>{
  if(node.type==="ImportSpecifier" && node.imported.type==="Identifier" && node.imported.name==="PostMessageTransport") throw new Error("Use the quiet source-checked card transport; pinned SDK transport logs secrets");
  if(node.type==="MemberExpression" && node.object.type==="Identifier" && node.object.name==="console") throw new Error("Card adapter must keep grant messages out of logs");
  if(node.type==="ClassProperty" && node.key.name==="receive") receive=node.value;
 });
 const first=receive?.body?.body?.[0], event=receive?.params?.[0]?.name;
 const property=(node,object,name)=>node?.type==="MemberExpression" && !node.computed && node.object.type===object && node.property.name===name;
 if(!event || first?.type!=="IfStatement" || first.alternate || first.test.type!=="BinaryExpression" || first.test.operator!=="!==" || !property(first.test.left,"Identifier","source") || first.test.left.object.name!==event || !property(first.test.right,"ThisExpression","source") || first.consequent.type!=="ReturnStatement" || first.consequent.argument) throw new Error("Reject foreign message sources before parsing or dispatching card messages");
 if(manifest?.devDependencies?.vite!=="6.4.5") throw new Error("Pin the verified Vite 6.4.5 patch; prior 6.4 releases contain disclosed development-server vulnerabilities");
}
export function checkCardRouting(skill, index, driver, documentation) {
 if(!skill.split("---")[1]?.includes("P07 live card") || !skill.includes("features/card.md") || !index.includes("[live card](card.md)") || !driver.includes('process.argv[2] === "p07-card"')) throw new Error("Route P07 live card through the skill header, selector, feature index and executable driver");
 if(!documentation?.host.includes("| Fresh same-account browser Stop/Skip and atomic replay |") || !documentation.host.includes("| Live React card, bridge, polling, grant rotation and native controls |") || !documentation.notes.includes("**createController**") || !documentation.notes.includes("**VerifiedControl**") || /\*\*(mountCard|inspect)\*\*/.test(documentation.notes) || index.includes("watches and the live card remain outside")) throw new Error("Document the implemented P07 card and browser controls; keep P01 fixture limitations historical");
 const lines=documentation.agents.split("\n"),first=lines.findIndex(line=>line.startsWith("| Risk |")),last=lines.findLastIndex(line=>line.startsWith("|"));
 if(first<0 || !/^\|\s*-+\s*\|\s*-+\s*\|\s*-+\s*\|$/.test(lines[first+1]??"") || lines.slice(first,last+1).some(line=>!line.startsWith("|"))) throw new Error("Keep every foundation enforcement row in one continuous Markdown table with its delimiter directly after the header");
}
export function checkCardRenewal(source) {
 let renewals=0;
 walk(parse(source,{sourceType:"module",plugins:["typescript"]}),node=>{
  if(node.type!=="BlockStatement") return;
  node.body.forEach((statement,index)=>{
   const assignment=statement.expression,call=assignment?.right?.argument;
   if(assignment?.type!=="AssignmentExpression" || assignment.right.type!=="AwaitExpression" || call?.type!=="CallExpression" || call.callee.type!=="MemberExpression" || call.callee.property.name!=="capability" || call.arguments[0]?.value!=="renew") return;
   renewals++;
   const prior=node.body[index-1]?.expression;
   if(assignment.left.name!=="capability" || prior?.type!=="AssignmentExpression" || prior.operator!=="=" || prior.left.name!=="capability" || prior.right.type!=="Identifier" || prior.right.name!=="undefined") throw new Error("Discard the prior read capability before awaiting renewal; a lost response must reopen through authenticated MCP");
  });
 });
 if(renewals!==1) throw new Error("Keep one serialized renewal boundary with explicit prior-capability disposal");
}
export function checkCardProjection(source) {
 const paths=new Set();
 const memberPath=node=>node?.type==="Identifier"?node.name:node?.type==="MemberExpression" && !node.computed?memberPath(node.object)+"."+node.property.name:"";
 walk(parse(source,{sourceType:"module",plugins:["typescript","jsx"]}),node=>{
  if(node.type==="MemberExpression") paths.add(memberPath(node));
 });
 for(const path of ["slot.completion.proof","view.final.quote","value.steps","value.reason"]) if(!paths.has(path)) throw new Error("Render slot proofs, the finished quote, and status steps and reasons from the canonical view: "+path);
}
export function checkCardApp(main,renderer,adapter,controller,metadata) {
 if(!renderer.includes('if(watching) setNotice("")')) throw new Error("Clear pending browser approval copy after a confirmed Watch receipt");
 if(!renderer.includes('event.preventDefault()') || !renderer.includes('bridge.openLink(url)') || /window\.open/.test(renderer)) throw new Error("Route card links through the host open-link request");
 if(!renderer.includes('bridge.controls(view.hunt)') || !renderer.includes('void control("watch")') || !renderer.includes('void control("stop")') || !adapter.includes('return await bridge.read(hunt,capability.grant)')) throw new Error("Fetch authenticated controls through tools/call before Watch or Stop confirmation");
 if(!adapter.includes('app.sendMessage(') || !adapter.includes('message?.text') || !adapter.includes('app.updateModelContext(') || !adapter.includes('supported?.text') || !adapter.includes('supported?.structuredContent') || !renderer.includes('"watch-requested":"stop-requested"')) throw new Error("Negotiate chat and model context channels and report pending approvals honestly");
 if(!adapter.includes('applyHostStyleVariables(context.styles.variables)') || !adapter.includes('app.onhostcontextchanged=hostContext') || !adapter.includes('context?.safeAreaInsets?.[side]') || !adapter.includes('context?.containerDimensions') || !adapter.includes('autoResize:true') || !adapter.includes('availableDisplayModes:["inline"]')) throw new Error("Apply host styles, safe areas and dimensions with SDK sizing and inline display mode");
 if(!main.includes('compareViews(active.value.view,result.data.value.view)') || !main.includes('app.ontoolinput=') || !main.includes('<WaitingCard product={label}/>') || !renderer.includes('controller.current?.receive(initial)') || !controller.includes('receive(snapshot:Snapshot)')) throw new Error("Apply pushed same-hunt results and tool input without restarting the card");
 let context;
 walk(parse(controller,{sourceType:"module",plugins:["typescript"]}),node=>{if(node.type==="FunctionDeclaration" && node.id?.name==="modelContext") context=node;});
 if(!context || /\b(?:controls|grant|_meta|capability)\b/.test(controller.slice(context.start,context.end))) throw new Error("Keep grants and browser control URLs out of model context");
 if(!metadata.includes('prefersBorder:false') || !metadata.includes('frameDomains: [], baseUriDomains: []')) throw new Error("Publish borderless app resource metadata with explicit least-privilege CSP");
}
export function checkCardExperience(main, renderer, adapter, style, html) {
 if(!html.includes("font-src data:;")) throw new Error("Allow the card’s embedded fonts through its data-only font policy");
 if(!main.includes('import "../../landing/public/ui.css"')) throw new Error("Load shared Scoat tokens in the card bundle");
 if(!renderer.includes('view.best') || !renderer.includes('view.progress.resolved') || !renderer.includes('aria-valuenow={view.progress.resolved}')) throw new Error("Render the canonical best quote and persisted progress");
 if(!adapter.includes('app.getHostContext()?.theme') || !adapter.includes('app.getHostCapabilities()?.message')) throw new Error("Negotiate host theme and message capability before Refine");
 if(!main.includes('memoryOutput.safeParse(raw.structuredContent)') || !main.includes('receipt.data.value.kind==="watching" && watchHunt===active?.value.view.hunt')) throw new Error("Show Watch active only for a canonical receipt bound to this hunt");
 if(/Scoat benefit hunt|Stop new discovery|Seller unknown|Checklist 0\/8|Open browser controls/.test(renderer) || !renderer.includes("How we checked")) throw new Error("Use shopper copy and disclose evidence without repeated pending rows");
 if(!renderer.includes('className="shop primary"') || !renderer.includes('alternatives.slice(0,2)') || !renderer.includes('className={"progress-line"+(offline?" progress-paused":"")}') || !renderer.includes('<h1>{productName(view.intent.product)}')) throw new Error("Keep one shop action with the price, two compact alternatives, the product and one coherent connection status");
 if(!renderer.includes('className="connection-note" role="alert"') || !renderer.includes("Can't reach Scoat right now.") || !renderer.includes('priceEvidence.proof.observedAt') || !renderer.includes('Showing the price saved at ${savedAt}.') || !renderer.includes('new Intl.DateTimeFormat(undefined,{hour:"2-digit",minute:"2-digit"})') || !renderer.includes('const label=offline?"Paused"') || !style.includes('.progress-paused .progress-count{color:var(--connection-foreground)}') || !renderer.includes('hero-stale')) throw new Error("Explain connection loss once, timestamp the saved price and distinguish stale results");
 if(!renderer.includes('className="watch-label">Price alerts on') || !renderer.includes("we'll email you if it drops.") || !style.includes('.watch-note svg,.watch-label{color:var(--primary)}') || !style.includes('h1:has(+.watch-note){margin-block-end:8px}') || /Pause search|Search paused/.test(renderer) || !renderer.includes('Stop search') || !renderer.includes('price-difference')) throw new Error("Confirm price alerts without repeating the product, the real Stop action and alternative price differences");
 if(!style.includes('.controls>button{border-color:var(--border)') || !style.includes('opacity:.45') || !style.includes('.controls>.quiet{background:transparent;border-color:transparent;color:var(--muted-foreground);font-weight:500;margin-left:auto}') || !renderer.includes('!offline && !watching && (hero || controls?.watch.available) && <button') || !renderer.includes('!offline && !finished && <button className="quiet"') || !renderer.includes('<Mark kind="edit"/>') || !renderer.includes('<Mark kind="stop"/>')) throw new Error("Give secondary actions a visible affordance and distinct disabled states");
 if(/font-size:(?:[0-9]|1[0-2])px/.test(style) || /THE DEAL LEDGER|backed by the details|Good deals start|Pausing keeps your results/.test(renderer)) throw new Error("Keep card copy lean and supporting text at least 13px");
 if(!style.includes('prefers-reduced-motion:no-preference') || !style.includes('var(--duration-micro)') || !style.includes('var(--ease-panel)')) throw new Error("Use shared motion tokens with reduced-motion support");
}
if(import.meta.url===pathToFileURL(process.argv[1]).href) { checkCardApp(...["src/card/main.tsx","src/card/renderer.tsx","src/card/adapter.ts","src/card/index.ts","src/mcp/index.ts"].map(file=>readFileSync(file,"utf8"))); checkCardExperience(readFileSync("src/card/main.tsx","utf8"),readFileSync("src/card/renderer.tsx","utf8"),readFileSync("src/card/adapter.ts","utf8"),readFileSync("src/card/style.css","utf8"),readFileSync("src/card/index.html","utf8")); checkCardBuild(readFileSync("vite.config.ts","utf8"),readFileSync("src/card/adapter.ts","utf8"),JSON.parse(readFileSync("package.json","utf8"))); checkCardRenewal(readFileSync("src/card/index.ts","utf8")); checkCardInitialState(readFileSync("src/card/index.ts","utf8"),readFileSync("src/card/renderer.tsx","utf8")); checkCardProjection(readFileSync("src/card/renderer.tsx","utf8")); checkCardRouting(readFileSync(".agents/skills/verify-scoat/SKILL.md","utf8"),readFileSync(".agents/skills/verify-scoat/features/README.md","utf8"),readFileSync("scripts/verify.mjs","utf8"),{host:readFileSync("docs/host-support.md","utf8"),notes:readFileSync("docs/implementation-notes.md","utf8"),agents:readFileSync("AGENTS.md","utf8")}); }
export function checkCardInitialState(controller, renderer) {
 const nodes=[];walk(parse(controller,{sourceType:"module",plugins:["typescript"]}),node=>nodes.push(node));
 const owner=nodes.find(node=>node.type==="FunctionDeclaration" && node.id?.name==="initialState");
 const ownerText=owner?controller.slice(owner.start,owner.end):"";
 if(!owner || !/final\.kind==="finished"/.test(ownerText) || ownerText.indexOf("finished")>ownerText.indexOf("Connecting")) throw new Error("One initialState owner states a finished snapshot before any connecting message");
 const states=nodes.filter(node=>node.type==="VariableDeclarator" && node.id?.name==="state");
 if(states.length!==1 || states[0].init?.type!=="CallExpression" || states[0].init.callee.name!=="initialState") throw new Error("The controller starts from initialState");
 const renderNodes=[];walk(parse(renderer,{sourceType:"module",plugins:["typescript","jsx"]}),node=>renderNodes.push(node));
 if(renderNodes.some(node=>node.type==="StringLiteral" && node.value==="Connecting…")) throw new Error("The renderer derives its first state from initialState, not its own connecting literal");
 const initial=renderNodes.find(node=>node.type==="CallExpression" && node.callee.name==="useState" && renderer.slice(node.start,node.end).includes("initialState(initial,bridge)"));
 if(!initial) throw new Error("The renderer derives its first state from initialState");
}
