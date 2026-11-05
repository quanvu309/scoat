import { parse } from "@babel/parser";
import postcss from "postcss";
import { parse as parseHtml } from "parse5";
import { parse as parseYaml } from "yaml";

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
   if (node.type === "CallExpression" && node.callee.object?.object?.type === "ThisExpression" && node.callee.object?.property?.name === "delivery" && node.callee.property?.name === "submit") return;
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

export function checkBrowserDocument(source) {
 const nodes = [];
 function visit(node) { nodes.push(node); for (const child of node.childNodes ?? []) visit(child); }
 const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
 const owner = ast.program.body.find(node => node.type === "ExportNamedDeclaration" && node.declaration?.id?.name === "browserDocument")?.declaration;
 const template = owner?.body.body.find(node => node.type === "ReturnStatement")?.argument;
 visit(parseHtml(template?.type === "TemplateLiteral" ? template.quasis.map(node => node.value.raw).join("value") : ""));
 const viewport = nodes.find(node => node.tagName === "meta" && node.attrs.some(attr => attr.name === "name" && attr.value === "viewport"));
 if (!viewport?.attrs.some(attr => attr.name === "content" && attr.value.includes("width=device-width") && attr.value.includes("viewport-fit=cover"))) throw new Error("Use browserDocument from src/browser/page.ts for the mobile viewport and safe areas");
 if (!nodes.some(node => node.tagName === "main") || !nodes.some(node => node.tagName === "html" && node.attrs.some(attr => attr.name === "lang"))) throw new Error("Use browserDocument from src/browser/page.ts for language and the main landmark");
}

export function checkBrowserVisual({ workflow, driver, skill, index, selector }) {
 const steps = parseYaml(workflow).jobs?.browser?.steps ?? [];
 const position = steps.findIndex(step => step.run === "npm run verify -- auth-ui");
 if (position < 0 || !steps.slice(0, position).some(step => step.run === "npm run build") || !steps.slice(0, position).some(step => step.run === "npx playwright install --with-deps chromium")) throw new Error("Run npm run verify -- auth-ui after build and Chromium installation in the browser CI job");
 if (!steps.some(step => step.uses === "actions/upload-artifact@v4" && step.with?.path === "auth-ui-evidence")) throw new Error("Retain auth-ui-evidence screenshots with actions/upload-artifact@v4");
 if (!driver.includes('"./verify-browser-ui.mjs"') || !driver.includes('process.argv[2] === "auth-ui"')) throw new Error("Route verify -- auth-ui to scripts/verify-browser-ui.mjs");
 if (![skill, index, selector].every(source => source.includes("browser-ui.md")) || !skill.split("---")[1].includes("auth and connection UI")) throw new Error("Route auth and connection UI through the verify-scoat header, selector and features/browser-ui.md");
}
