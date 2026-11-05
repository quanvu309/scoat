import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";

const css = ["ui.css", "account.css"].map(file => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");
const brand = readFileSync(new URL("brand.svg", import.meta.url), "utf8");
const styleHash = createHash("sha256").update(css).digest("base64");
export const browserPolicy = `default-src 'none'; font-src data:; style-src 'sha256-${styleHash}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;

export function browserDocument(content: string): string {
 const title = /<title>([^<]+)<\/title>/.exec(content)?.[1] ?? "Scoat";
 const heading = /<h1>([^<]+)<\/h1>/.exec(content)?.[1] ?? title;
 const body = content.replace(/<title>[^<]+<\/title>/, "").replace(/<h1>[^<]+<\/h1>/, "");
 return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="color-scheme" content="light"><meta name="theme-color" content="#ffffff"><title>${title} · Scoat</title><style>${css}</style></head><body class="account-page"><header class="account-header"><a class="account-brand" href="https://scoat.net/" aria-label="Scoat home">${brand}<span>Scoat</span></a></header><main class="account-main"><section class="account-card" aria-labelledby="page-title"><h1 id="page-title">${heading}</h1><div class="account-content">${body}</div></section></main></body></html>`;
}

export function pageHead(res: ServerResponse, status: number, headers: Readonly<Record<string, string | readonly string[]>> = {}): void {
 res.statusCode = status;
 for (const [name, value] of Object.entries(headers)) res.setHeader(name, Array.isArray(value) ? [...value] : value);
 res.setHeader("content-type", "text/html; charset=utf-8");
 res.setHeader("cache-control", "no-store");
 res.setHeader("referrer-policy", "same-origin");
 const policy = res.getHeader("content-security-policy");
 const formAction = typeof policy === "string" ? /(?:^|; )form-action ([^;]+)/.exec(policy)?.[1] : undefined;
 res.setHeader("content-security-policy", formAction ? browserPolicy.replace("form-action 'self'", "form-action " + formAction) : browserPolicy);
}

export function sendPage(res: ServerResponse, content: string): void {
 pageHead(res, res.statusCode);
 res.end(browserDocument(content));
}

export function refusalPage(): string {
 return `<title>Request expired</title><p>This request could not be confirmed.</p><a class="ui-button" href="https://scoat.net/connect/">Start again</a>`;
}

export function completedPage(kind: "link" | "memory"): string {
 return kind === "link"
  ? `<title>Your sign-ins are linked</title><p>Return to your chat and sign in again.</p><a class="ui-button" href="https://scoat.net/connect/">Connection guide</a>`
  : `<title>Command approved</title><p>Your exact command is approved. Return to the chat where you started and submit it again to apply the change.</p>`;
}
