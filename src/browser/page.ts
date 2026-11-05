import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { ServerResponse } from "node:http";

const css = ["ui.css", "account.css"].map(file => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");
const brand = readFileSync(new URL("brand.svg", import.meta.url), "utf8");
const styleHash = createHash("sha256").update(css).digest("base64");
export const browserPolicy = `default-src 'none'; style-src 'sha256-${styleHash}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`;

export function browserDocument(content: string): string {
 const title = /<title>([^<]+)<\/title>/.exec(content)?.[1] ?? "Scoat";
 const body = content.replace(/<title>[^<]+<\/title>/, "").replace(/<h1>[^<]+<\/h1>/, "");
 return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><meta name="color-scheme" content="light"><meta name="theme-color" content="#ffffff"><title>${title} · Scoat</title><style>${css}</style></head><body class="account-page"><header class="account-header"><a class="account-brand" href="https://scoat.net/" aria-label="Scoat home">${brand}<span>Scoat</span></a><a class="account-home" href="https://scoat.net/connect/">Connection guide <span aria-hidden="true">↗</span></a></header><main class="account-main"><aside class="account-context"><span class="account-eyebrow">YOUR SHOPPING, CONNECTED</span><h2>A good deal.<br> A clear choice.</h2><p>Scoat brings the search, the evidence and the next step to your chat.</p><ol class="account-journey" aria-label="Connection steps"><li>Sign in to your account</li><li>Review and confirm</li><li>Continue in your chat</li></ol></aside><section class="account-card" aria-labelledby="page-title"><div class="account-card-label"><span class="account-dot" aria-hidden="true"></span> SCOAT ACCOUNT</div><h1 id="page-title">${title}</h1><div class="account-content">${body}</div><div class="account-footnote">Only confirm actions you started. You can close this page to cancel.</div></section></main><footer class="account-footer"><span>Scoat · Made for considered choices.</span><span>Private by default. You decide what happens next.</span></footer></body></html>`;
}

export function pageHead(res: ServerResponse, status: number, headers: Readonly<Record<string, string | readonly string[]>> = {}): void {
 res.statusCode = status;
 for (const [name, value] of Object.entries(headers)) res.setHeader(name, Array.isArray(value) ? [...value] : value);
 res.setHeader("content-type", "text/html; charset=utf-8");
 res.setHeader("cache-control", "no-store");
 res.setHeader("referrer-policy", "same-origin");
 res.setHeader("content-security-policy", browserPolicy);
}

export function sendPage(res: ServerResponse, content: string): void {
 pageHead(res, res.statusCode);
 res.end(browserDocument(content));
}

export function refusalPage(): string {
 return `<title>Let’s start that again</title><p>This request could not be confirmed. It may have expired, or it may belong to a different browser session.</p><div class="account-notice"><strong>Start with a fresh link</strong><p>Return to the chat or page where you started, then open a fresh Scoat link.</p></div><a class="ui-button" href="https://scoat.net/connect/">Back to the connection guide</a>`;
}

export function completedPage(kind: "link" | "memory"): string {
 return kind === "link"
  ? `<title>Your sign-ins are linked</title><p>You can now use either sign-in for the same Scoat account.</p><div class="account-notice"><strong>One more step</strong><p>Return to your chat and sign in again to continue with your account.</p></div><a class="ui-button" href="https://scoat.net/connect/">Connection guide</a>`
  : `<title>Command approved</title><p>Your exact command is approved. Return to the chat where you started and submit it again to apply the change.</p>`;
}
