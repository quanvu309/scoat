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
 if(first<0 || lines.slice(first,last+1).some(line=>!line.startsWith("|"))) throw new Error("Keep every foundation enforcement row in one continuous Markdown table");
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
if(import.meta.url===pathToFileURL(process.argv[1]).href) { checkCardBuild(readFileSync("vite.config.ts","utf8"),readFileSync("src/card/adapter.ts","utf8"),JSON.parse(readFileSync("package.json","utf8"))); checkCardRenewal(readFileSync("src/card/index.ts","utf8")); checkCardProjection(readFileSync("src/card/renderer.tsx","utf8")); checkCardRouting(readFileSync(".agents/skills/verify-scoat/SKILL.md","utf8"),readFileSync(".agents/skills/verify-scoat/features/README.md","utf8"),readFileSync("scripts/verify.mjs","utf8"),{host:readFileSync("docs/host-support.md","utf8"),notes:readFileSync("docs/implementation-notes.md","utf8"),agents:readFileSync("AGENTS.md","utf8")}); }
