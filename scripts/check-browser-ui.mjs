import { parse } from "@babel/parser";
import postcss from "postcss";

export function checkBrowserTokens(tokens, styles, entries) {
 const root = postcss.parse(tokens);
 for (const name of ["--background", "--foreground", "--card", "--primary", "--border", "--input", "--ring", "--ease-micro", "--ease-panel", "--duration-micro", "--duration-panel"]) {
  if (!root.nodes.some(node => node.type === "rule" && node.selector === ":root" && node.nodes.some(item => item.prop === name))) throw new Error(`landing/public/ui.css must own shared token ${name}`);
 }
 for (const [file, source] of Object.entries(styles)) postcss.parse(source).walkDecls(declaration => {
  if (declaration.prop.startsWith("--") && !declaration.prop.startsWith("--page-pad-") && root.nodes.some(node => node.nodes?.some(item => item.prop === declaration.prop))) throw new Error(`${file}: use the tokens in landing/public/ui.css instead of redefining ${declaration.prop}`);
 });
 for (const [file, source] of Object.entries(entries)) if (!source.includes('href="/ui.css"')) throw new Error(`${file}: load landing/public/ui.css before page styles`);
}

export function checkBrowserPages(files) {
 for (const [file, source] of Object.entries(files)) {
  const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
  function visit(node) {
   if (!node || typeof node !== "object") return;
   if ((node.type === "StringLiteral" && /<(?:title|form|html|p|h1|input|button)\b/.test(node.value)) || (node.type === "TemplateElement" && /<(?:title|form|html|p|h1|input|button)\b/.test(node.value.raw))) throw new Error(`${file}: render browser UI through src/browser/views.ts and sendPage from src/browser/page.ts`);
   for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
  }
  visit(ast.program);
 }
}

export function checkBrowserOutcomes(issuer, server) {
 const ast = parse(issuer, { sourceType: "module", plugins: ["typescript"] });
 function visit(node) {
  if (!node || typeof node !== "object") return;
  if (node.type === "CallExpression" && node.callee.object?.name === "res" && node.callee.property?.name === "end" && node.arguments[0]?.type === "StringLiteral") throw new Error("src/auth/issuer.ts: use completedPage or refusalPage from src/browser/page.ts for browser outcomes");
  for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object") visit(value);
 }
 visit(ast.program);
 if (server.includes('res.end("Authentication request refused")') || !server.includes("sendPage(res, refusalPage())") || !issuer.includes("browserDocument(refusalPage())")) throw new Error("src/server.ts: use refusalPage from src/browser/page.ts at the browser error boundary and provider renderError");
}

