import { watchRefusalReasons } from "../dist/memory/watches.js";

const confirmation = "preview-confirmation";
const target = { seller: "The Pi Hut", url: "https://thepihut.com/products/raspberry-pi-5", sku: "SC1159", variant: 42565468733635 };
const prepared = { kind: "ready", hunt: "hunt-preview", target, suggestedPence: 7500, recipient: null, otherActive: 0 };
const observation = { kind: "comparable", itemPence: 7800, deliveryPence: 350, amountPence: 8150 };
const recipient = { address: "r***@example.com", previous: null, moving: false, moveRecipient: false, otherActive: 0 };
const issued = { state: "Searching", finished: false, forms: [{ token: confirmation, nonce: "preview-nonce", action: { kind: "stop" } }, { token: confirmation, nonce: "preview-skip", action: { kind: "skip", row: "student" } }] };
export const browserCases = [
 { id: "consent", view: "consent", args: [{ params: { client_id: "scoat-chatgpt", scope: "scoat:read scoat:write" } }, "preview-csrf", { name: "ChatGPT", origin: "https://chatgpt.com" }] },
 { id: "consent-claude", view: "consent", args: [{ params: { client_id: "scoat-claude", scope: "scoat:read" } }, "preview-csrf", { name: "Claude", origin: "https://claude.ai" }] },
 { id: "enroll", view: "enroll", args: [confirmation] },
 { id: "link", view: "link", args: [confirmation] },
 { id: "control", view: "control", args: [{ hunt: "hunt-preview" }, issued, { available: true }, "https://mcp.scoat.net", { account: "preview-account" }] },
 { id: "control-finished", view: "control", args: [{ hunt: "hunt-preview" }, { ...issued, state: "Finished", finished: true, forms: [] }, { available: true }, "https://mcp.scoat.net", { account: "preview-account" }] },
 { id: "erase", view: "erase", args: ["preview-status-secret-save-before-confirming", confirmation] },
 { id: "erase-status", view: "eraseStatus", args: [] },
 { id: "verified-email", view: "verifiedEmail", args: [] },
 { id: "watch-unavailable", view: "watchUnavailable", args: [prepared, { kind: "unknown", reason: "network" }, "/account/watch?account=preview&hunt=preview"] },
 { id: "watch-confirm", view: "watchConfirm", args: [prepared, 1793880000000, observation, recipient, "75.00", confirmation] },
 { id: "watch-move", view: "watchConfirm", args: [prepared, 1793880000000, observation, { ...recipient, previous: "o***@example.com", moving: true, moveRecipient: true, otherActive: 2 }, "75.00", confirmation] },
 { id: "watch-active", view: "watchActive", args: [{ watch: "watch-preview", targetPence: 7500, baselinePence: 8150, movedWatches: 0 }] },
 { id: "watch-active-moved", view: "watchActive", args: [{ watch: "watch-preview", targetPence: 7500, baselinePence: 8150, movedWatches: 2 }] },
 { id: "unsubscribe", view: "unsubscribe", args: ["preview-unsubscribe"] },
 { id: "unsubscribed", view: "unsubscribed", args: [{ kind: "unsubscribed", mayStillArrive: 0 }] },
 { id: "unsubscribed-submitted", view: "unsubscribed", args: [{ kind: "unsubscribed", mayStillArrive: 1 }] },
 { id: "unsubscribe-inactive", view: "unsubscribed", args: [{ kind: "inactive" }] },
 { id: "memory", view: "memory", args: ['{"op":"profile","name":"Student","country":"GB"}', confirmation] },
 ...watchRefusalReasons.map(reason => ({ id: "watch-refusal-" + reason, view: "watchRefusalPage", args: [reason, "/account/watch?account=preview&hunt=preview"] })),
 { id: "watch-target-correction", view: "watchRefusalPage", args: ["invalid-target", null, { confirmation, moveRecipient: true }] },
 { id: "refusal", view: "refusalPage", args: [] },
 { id: "link-completed", view: "completedPage", args: ["link"] },
 { id: "memory-completed", view: "completedPage", args: ["memory"] },
];
