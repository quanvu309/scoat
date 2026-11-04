import fs from "node:fs";
import path from "node:path";
import ts from "ts5";

const root = process.argv[2] ?? "src";
const offenders = [];

const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) scan(full);
  }
};

const scan = (file) => {
  const text = fs.readFileSync(file, "utf8");
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, text);
  for (let kind = scanner.scan(); kind !== ts.SyntaxKind.EndOfFileToken; kind = scanner.scan()) {
    if (kind === ts.SyntaxKind.SingleLineCommentTrivia || kind === ts.SyntaxKind.MultiLineCommentTrivia) {
      const { line } = ts.getLineAndCharacterOfPosition(ts.createSourceFile(file, text, ts.ScriptTarget.Latest), scanner.getTokenStart());
      offenders.push(`${file}:${line + 1}`);
    }
  }
};

walk(root);
if (offenders.length > 0) {
  console.error(`Comments are not allowed in code. Put intent in names, tests or docs/.\n${offenders.join("\n")}`);
  process.exit(1);
}
