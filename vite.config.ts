import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
export default defineConfig({root:"src/card",plugins:[viteSingleFile()],build:{outDir:"../../dist/card",emptyOutDir:false,minify:"esbuild"}});
