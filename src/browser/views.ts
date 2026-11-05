import { connectionLifetimeSeconds } from "../auth/config.js";
import type { PreparedWatch, WatchRefusalReason } from "../memory/watches.js";
import { watchRefusalText, watchLimits, watchUrl } from "../memory/watches.js";
import { cleanShopUrl, observationSchema } from "../delivery/index.js";
import type { z } from "zod";
type Observation = z.infer<typeof observationSchema>;
const escapeHtml = (value: string) => value.replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;").replaceAll(">","&gt;");
const escape = escapeHtml;
const pounds = (pence: number) => "GBP " + (pence / 100).toFixed(2);
type EmailEntry = { email: string; csrf: string; action: `/${string}`; state: "ready" | "mail-failed" };
type EmailCode = {
 email: string;
 csrf: string;
 challenge: string;
 verifyAction: `/${string}`;
 resendAction: `/${string}`;
 changeEmailHref: `/${string}`;
 state: "ready" | "invalid" | "resent" | "expired" | "too-many-attempts";
};
export function emailEntry(input: EmailEntry): string {
 const failed = input.state === "mail-failed";
 return `<title>${failed ? "Let’s try sending that again" : "Welcome to Scoat"}</title><p>Sign in or create your account with your email. We’ll send you a six-digit code. No password to remember.</p>${failed ? '<div class="account-notice" role="alert"><strong>Your code couldn’t be sent</strong><p>Check your email address and try again. You haven’t been signed in.</p></div>' : ""}<form method="post" action="${escapeHtml(input.action)}"><input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}"><label for="email">Email address</label><input id="email" type="email" name="email" autocomplete="email" inputmode="email" autocapitalize="none" spellcheck="false" maxlength="254" value="${escapeHtml(input.email)}" placeholder="you@example.com" required><button>${failed ? "Try sending again" : "Continue with email"}</button></form><p class="account-help account-after-form">Keep this page open. You’ll enter the code here.</p>`;
}
export function emailCode(input: EmailCode): string {
 const inactive = input.state === "expired" || input.state === "too-many-attempts";
 const title = input.state === "expired" ? "Your code has expired" : input.state === "too-many-attempts" ? "Let’s use a new code" : "Check your email";
 const notice = input.state === "expired" ? "Codes expire after 10 minutes. Request a new one below to continue." : input.state === "too-many-attempts" ? "There have been too many attempts. For your security, this code can’t be used again. Request a new code to continue." : input.state === "invalid" ? "That code didn’t match. Check the six digits in your latest email and try again." : input.state === "resent" ? "A new code is on its way. Use the code in your latest email." : "";
 const hidden = `<input type="hidden" name="csrf" value="${escapeHtml(input.csrf)}"><input type="hidden" name="challenge" value="${escapeHtml(input.challenge)}">`;
 return `<title>${title}</title><p>${inactive ? "Continue signing in to" : "Enter the six-digit code sent to"}<br><strong>${escapeHtml(input.email)}</strong></p>${notice ? `<div class="account-notice" role="${input.state === "resent" ? "status" : "alert"}">${notice}</div>` : ""}${inactive ? "" : `<form method="post" action="${escapeHtml(input.verifyAction)}">${hidden}<label for="code">Six-digit code</label><input class="account-code" id="code" type="text" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" aria-describedby="code-help" required${input.state === "invalid" ? ' aria-invalid="true"' : ""}><p id="code-help" class="account-help">Your code works once and expires in 10 minutes.</p><button>Verify and continue</button></form>`}<div class="account-resend"><p class="account-help">${inactive ? "Need a fresh code?" : "No email? Check your spam folder, or send a new code."}</p><form method="post" action="${escapeHtml(input.resendAction)}">${hidden}<button class="account-secondary">${inactive ? "Send a new code" : "Resend code"}</button></form><p><a href="${escapeHtml(input.changeEmailHref)}">Use a different email</a></p></div>`;
}
export function eraseStatus() {
 return `<title>Check your erasure result</title><p>Enter the status secret you saved before erasing your account. You do not need to sign in. Completed results remain available for 24 hours.</p><form method="post" action="/account/erase-status"><label>Status secret <input type="password" name="status" maxlength="128" required autocomplete="off"></label><button>Check erasure result</button></form>`;
}
export function watchActive(activated: {watch:string;targetPence:number;baselinePence:number;movedWatches:number}) {
 return `<title>Watch active</title><h1>Watch active</h1><p>Watch ${escapeHtml(activated.watch)} checks the public delivered price daily. An alert needs a price at or below ${pounds(activated.targetPence)} and strictly below the ${pounds(activated.baselinePence)} baseline.</p>${activated.movedWatches ? `<p>Alerts for your ${activated.movedWatches} other active ${activated.movedWatches === 1 ? "watch" : "watches"} now go to the same verified address.</p>` : ""}<p>Every alert email has a one-step unsubscribe link.</p>`;
}
export function unsubscribe(token: string) {
 return `<title>Stop Scoat watch</title><h1>Stop this price watch?</h1><p>Stopping cancels future checks and any alert not yet submitted. An alert already handed to the mail provider may still arrive.</p><form method="post" action="/watch/unsubscribe?token=${escapeHtml(token)}"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button>Stop watching</button></form>`;
}
export function unsubscribed(result: {kind:string;mayStillArrive?:number}) {
 return result.kind === "unsubscribed" ? `<title>Watch stopped</title><h1>Watch stopped</h1><p>No new checks or alerts will start.${result.mayStillArrive ? " One alert was already handed to the mail provider and may still arrive." : ""}</p>` : `<title>Watch not active</title><h1>This watch is not active</h1><p>No further alerts will start from this link.</p>`;
}
export function consent(details: {params:{scope?:unknown}}, csrf: string, client: {name:string;origin:string;refreshAllowed:boolean}) {
 const scopes = String(details.params.scope).split(" ");
 return `<title>Connect to ${escapeHtml(client.name)}</title><p>You’re almost ready. Let ${escapeHtml(client.name)} use Scoat in your chats.</p><div class="account-notice"><span class="account-eyebrow">YOU ARE CONNECTING</span><strong class="account-client">${escapeHtml(client.name)}</strong><span>${escapeHtml(client.origin)}</span></div><p>This connection can:</p><ul class="account-permissions">${scopes.includes("scoat:read") ? "<li>View your hunts and saved shopping results</li>" : ""}${scopes.includes("scoat:write") ? "<li>Run hunts and save changes you request</li>" : ""}${client.refreshAllowed ? `<li>Stay signed in for up to ${connectionLifetimeSeconds / (24 * 60 * 60)} days and renew access while you’re away, until you disconnect or delete your account</li>` : ""}</ul><p class="account-help">Only allow access if you started this connection. After you decide, you’ll return to your chat app.</p><form class="account-decisions" method="post"><input type="hidden" name="csrf" value="${escapeHtml(csrf)}"><button name="decision" value="allow">Allow</button><button name="decision" value="deny">Deny</button></form>`;
}
export function control(intent: {hunt:string}, issued: {state:string;finished:boolean;forms:readonly {token:string;nonce:string;action:{kind:"stop"}|{kind:"skip";row:string}}[]}, watches: {available:boolean}|undefined, issuer: string, actual: {account:string}) {
 return `<title>Manage this hunt</title><p>Choose what Scoat should do next.</p><div class="account-notice"><strong>${escape(issued.state)}</strong><p class="account-help">Hunt ${escape(intent.hunt)}</p></div><p>Stop prevents Scoat from accepting new discoveries. To stop your chat app or agent too, return to that app.</p>${watches?.available && issued.finished ? `<p><a href="${escape(watchUrl(issuer,actual.account,intent.hunt))}">Watch this finished hunt's price</a></p>` : ""}`+issued.forms.map(form=>{
          const label=form.action.kind === "stop" ? "Stop accepting new discoveries" : "Skip row "+form.action.row;
          return `<form method="post" action="/account/control"><input type="hidden" name="confirmation" value="${form.token}"><input type="hidden" name="csrf" value="${form.nonce}"><input type="hidden" name="action" value="${escape(JSON.stringify(form.action))}"><button>${escape(label)}</button></form>`;
        }).join("");
}
export function erase(status: string, confirmation: string) {
 return `<title>Erase your Scoat account</title><p>This permanently removes your saved results, profiles, hunts and Scoat sign-ins.</p><div class="account-notice"><strong>Save your status secret first</strong><p>You can use it for 24 hours to check the result if this page closes. Scoat keeps a private record for 31 days to prevent old sign-in requests from recreating your account. Your sign-in provider’s account and emails already delivered are outside Scoat deletion. Backup deletion is handled through the recovery process.</p></div><p>Save this status secret before confirming: <code>${status}</code></p><p>If the response is lost, <a href="/account/erase-status">check the erasure result</a> with your saved secret.</p><form method="post" action="/account/erase"><input type="hidden" name="confirmation" value="${confirmation}"><button name="decision" value="erase">Erase this account</button></form>`;
}
export function verifiedEmail() {
 return `<title>Verified email required</title><h1>Verified email required</h1><p>Your sign-in provider did not confirm a verified email address for this account. No watch was activated and no email will be sent.</p>`;
}
export function watchUnavailable(prepared: Extract<PreparedWatch,{kind:"ready"}>, observation: Extract<Observation,{kind:"unknown"}>, retry: string) {
 return `<title>Watch unavailable</title><h1>Watch cannot start</h1><p>The public price for ${escapeHtml(cleanShopUrl(prepared.target))} is unknown (${escapeHtml(observation.reason)}). No active price promise was created and no email will be sent.</p><p><a href="${escapeHtml(retry)}">Try again later</a></p>`;
}
export function watchConfirm(prepared: Extract<PreparedWatch,{kind:"ready"}>, observedAt: number, observation: Extract<Observation,{kind:"comparable"}>, recipient: {address:string;previous:string|null;moving:boolean;moveRecipient:boolean;otherActive:number}, suggested: string, confirmation: string) {
 return `<title>Confirm Scoat price watch</title><h1>Confirm price watch</h1><dl><dt>Item</dt><dd>Raspberry Pi 5, SKU ${escapeHtml(prepared.target.sku)}, variant ${prepared.target.variant}, quantity one</dd><dt>Seller</dt><dd>${escapeHtml(prepared.target.seller)}: <a href="${escapeHtml(cleanShopUrl(prepared.target))}">${escapeHtml(cleanShopUrl(prepared.target))}</a></dd><dt>Observed</dt><dd>${new Date(observedAt).toISOString()} from the public product and delivery pages</dd><dt>Item price</dt><dd>${pounds(observation.itemPence)}</dd><dt>Delivery</dt><dd>${pounds(observation.deliveryPence)} UK Royal Mail 1st Class, non-member, non-lithium</dd><dt>Public delivered baseline</dt><dd>${pounds(observation.amountPence)}</dd><dt>Alerts go to</dt>${watchRecipient(recipient)}<p>Scoat checks once a day for up to ${watchLimits.days} days and emails when the delivered public price is at or below your target and strictly below the baseline and any earlier alert. Student, coupon, cashback, rewards and member prices never count. At most ${watchLimits.active} active watches per account. Confirm within ${watchLimits.freshObservationSeconds / 60} minutes or start again.</p><form id="watch-confirm" method="post" action="/account/watch"><input type="hidden" name="confirmation" value="${confirmation}"><p><label for="watch-target">Your target delivered price (GBP)</label> <input id="watch-target" name="target" inputmode="decimal" required pattern="[0-9]{1,6}([.][0-9]{1,2})?" value="${suggested}"></p><button name="decision" value="watch">Start watching</button></form>`;
}
export function memory(display: string, confirmation: string) {
 return `<title>Review your saved change</title><p>Your chat asked to make this change to your saved Scoat information. Review the exact details before approving.</p><pre>${display}</pre><form method="post" action="/account/memory"><input type="hidden" name="confirmation" value="${confirmation}"><button name="decision" value="allow">Approve exact command</button></form>`;
}
export function link(confirmation: string) {
 return `<title>Add another sign-in</title><p>Keep your hunts and saved results in this account, and add another way to sign in.</p><div class="account-notice"><strong>Next, sign in with the account you want to add.</strong><p>For your security, you’ll verify it again. If that sign-in already has hunts or other linked sign-ins, Scoat cannot combine the accounts here.</p></div><form method="post" action="/account/link"><input type="hidden" name="confirmation" value="${confirmation}"><button>Sign in with the identity to add</button></form>`;
}
export function enroll(confirmation: string) {
 return `<title>Welcome to Scoat</title><p>Your sign-in is verified. Create your Scoat account to keep your hunts and saved results together.</p><div class="account-notice"><strong>One account for your shopping</strong><p>Next, you’ll review what your chat app can access before the connection is completed.</p></div><form method="post" action="/account/enroll"><input type="hidden" name="confirmation" value="${confirmation}"><button name="decision" value="enroll">Create account</button></form>`;
}
export function watchRefusalPage(reason: WatchRefusalReason, retry: string | null, correction: Readonly<{ confirmation: string; moveRecipient: boolean }> | null = null) {
  if (reason === "invalid-target" && correction) return `<title>Correct your watch target</title><h1>Correct your watch target</h1><p>${escapeHtml(watchRefusalText[reason])}</p><p>Your recipient choice is unchanged.</p><form method="post" action="/account/watch"><input type="hidden" name="confirmation" value="${escapeHtml(correction.confirmation)}"><input type="hidden" name="decision" value="watch">${correction.moveRecipient ? '<input type="hidden" name="recipient" value="move">' : ""}<label>Your target delivered price (GBP)<input name="target" inputmode="decimal" required pattern="[0-9]{1,6}(\\.[0-9]{1,2})?" maxlength="16"></label><button>Confirm price watch</button></form>`;
  const recovery = reason === "already-watching" || reason === "watch-limit" ? "Stop a watch from the link in its alert email or ask your agent to unwatch it, then start again." : reason === "service-unconfigured" || reason === "unfinished" || reason === "no-exact-supported-variant" || reason === "ambiguous-variant" ? "No price watch can start for this hunt." : "";
  const again = retry ? `<p><a href="${escapeHtml(retry)}">Start again with a fresh public price</a></p>` : "<p>Choose Watch price again from your hunt card or hunt text to start with a fresh public price.</p>";
  return `<title>Price watch not started</title><h1>Price watch not started</h1><p>${escapeHtml(watchRefusalText[reason])}</p>${recovery ? `<p>${escapeHtml(recovery)}</p>` : ""}${again}`;
}

function watchRecipient(recipient: {address:string;previous:string|null;moving:boolean;moveRecipient:boolean;otherActive:number}) {
 const masked = escapeHtml(recipient.address);
 return recipient.moveRecipient && recipient.previous
  ? `<dd>${masked} (verified by your sign-in provider)</dd></dl><p><strong>Your sign-in provider verified a different address. Your ${recipient.otherActive} other active ${recipient.otherActive === 1 ? "watch alerts" : "watches alert"} ${escapeHtml(recipient.previous)} now.</strong> Scoat sends every watch alert for this account to one verified address. Starting this watch moves alerts for all ${recipient.otherActive + 1} watches to ${masked}; an alert already handed to the mail provider may still arrive at the old address.</p><p><label><input type="checkbox" name="recipient" value="move" form="watch-confirm" required> Send alerts for all my watches to ${masked}</label></p>`
  : `<dd>${masked} (verified by your sign-in provider)${recipient.moving && recipient.previous ? `; replaces ${escapeHtml(recipient.previous)}, which has no other active watch` : ""}</dd></dl>`;
}
