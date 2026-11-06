import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
export default defineConfig({root:"src/card",plugins:[{name:"scoat-inline-theme-fonts",enforce:"pre",transform(code,id){if(!id.endsWith("/landing/public/ui.css")) return;return code.replace(/url\("\/fonts\/([^"]+)"\)/g,(_,name:string)=>`url("data:font/woff2;base64,${readFileSync("landing/public/fonts/"+name).toString("base64")}")`);}},viteSingleFile()],build:{outDir:"../../dist/card",emptyOutDir:false,minify:"esbuild"}});
