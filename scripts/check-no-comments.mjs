import postcss from "postcss";
import { parse as html } from "parse5";
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import { parseDocument } from "yaml";

export function checkComments(file, source) {
  if (/\.[cm]?[jt]sx?$/.test(file)) {
    const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
    if (ast.comments.length) throw new Error(`${file}: comments forbidden; put explanations in docs`);
  } else if (/\.css$/.test(file)) {
    postcss.parse(source).walkComments(()=>{throw new Error(`${file}: comments forbidden`);});
  } else if (/\.html$/.test(file)) {
    function visit(node) {
      if(node.nodeName==="#comment") throw new Error(`${file}: comments forbidden`);
      if(node.tagName==="script") checkComments("inline.js",(node.childNodes??[]).map(child=>child.value??"").join(""));
      if(node.tagName==="style") checkComments("inline.css",(node.childNodes??[]).map(child=>child.value??"").join(""));
      for(const child of node.childNodes??[]) visit(child);
      if(node.content) visit(node.content);
    }
    visit(html(source));
  } else if (/\.ya?ml$/.test(file)) {
    const doc = parseDocument(source, { keepSourceTokens: true });
    if (doc.errors.length) throw doc.errors[0];
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "comment") throw new Error(`${file}: comments forbidden; put explanations in docs`);
      for (const [key, value] of Object.entries(node)) if (key !== "context") {
        if (Array.isArray(value)) value.forEach(visit); else visit(value);
      }
    };
    visit(doc.contents?.srcToken);
    if (doc.comment || doc.commentBefore) throw new Error(`${file}: comments forbidden; put explanations in docs`);
  } else if (/\.json$/.test(file)) JSON.parse(source);
  else if (/\.sql$/.test(file)) {
    const tokens = source.match(/'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\//g) ?? [];
    if (tokens.some(token => token.startsWith("--") || token.startsWith("/*"))) throw new Error(`${file}: comments forbidden; put explanations in docs`);
  }
}
export function checkTree(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git", "design", "arch"].includes(entry.name)) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) checkTree(full);
    else if (/\.(?:[cm]?[jt]sx?|ya?ml|json|sql|css|html)$/.test(full)) checkComments(full, fs.readFileSync(full, "utf8"));
  }
}
if (process.argv[1]?.endsWith("check-no-comments.mjs")) checkTree(process.argv[2] ?? ".");
