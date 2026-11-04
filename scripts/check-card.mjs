import { parse } from "@babel/parser";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
function walk(node, visit) {
 if(!node || typeof node!=="object") return;
 visit(node);
 for(const value of Object.values(node)) if(Array.isArray(value)) value.forEach(item=>walk(item,visit));else if(value && typeof value==="object") walk(value,visit);
}
export function checkCardBuild(config, adapter) {
 let preserved=false;
 walk(parse(config,{sourceType:"module",plugins:["typescript"]}),node=>{
  if(node.type==="ObjectProperty" && node.key.type==="Identifier" && node.key.name==="emptyOutDir") preserved=node.value.type==="BooleanLiteral" && node.value.value===false;
 });
 if(!preserved) throw new Error("Preserve emitted card controller modules alongside the HTML bundle");
 walk(parse(adapter,{sourceType:"module",plugins:["typescript"]}),node=>{
  if(node.type==="ImportSpecifier" && node.imported.type==="Identifier" && node.imported.name==="PostMessageTransport") throw new Error("Use the quiet source-checked card transport; pinned SDK transport logs secrets");
  if(node.type==="MemberExpression" && node.object.type==="Identifier" && node.object.name==="console") throw new Error("Card adapter must keep grant messages out of logs");
 });
}
export function checkCardRouting(skill, index, driver) {
 if(!skill.split("---")[1]?.includes("P07 live card") || !skill.includes("features/card.md") || !index.includes("[live card](card.md)") || !driver.includes('process.argv[2] === "p07-card"')) throw new Error("Route P07 live card through the skill header, selector, feature index and executable driver");
}
if(import.meta.url===pathToFileURL(process.argv[1]).href) { checkCardBuild(readFileSync("vite.config.ts","utf8"),readFileSync("src/card/adapter.ts","utf8")); checkCardRouting(readFileSync(".agents/skills/verify-scoat/SKILL.md","utf8"),readFileSync(".agents/skills/verify-scoat/features/README.md","utf8"),readFileSync("scripts/verify.mjs","utf8")); }
