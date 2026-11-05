# Auth and connection UI

Trigger: shared browser pages, OAuth consent, enrollment, linking, browser refusals, landing account links or the connect guide.

Run `npm run build`, then `npm run verify -- auth-ui` with `SCOAT_EVIDENCE_DIR` set to an evidence directory under `~/tmp`. The driver renders every exported view from `src/browser/views.ts`, every watch refusal, shared outcomes, the landing and both guide tabs at 1440×900 and 390×844. It saves full-page screenshots and `receipt.json`. It checks horizontal overflow, one page heading, input text size, button targets, keyboard focus, browser errors, no-store, Referrer-Policy and the shared CSP. Inspect the images for hierarchy, wrapping and understandable next steps; screenshots alone do not prove those qualities.

Use `src/browser/views.ts` for browser content and `sendPage` from `src/browser/page.ts` for the document and headers. Add every new exported view to `scripts/browser-cases.mjs`. The landing and account pages share `landing/public/ui.css`; use its semantic colors, fonts and motion tokens. Keep feature layout in the corresponding stylesheet. The server-rendered forms need no client framework or toast dependency: show the result in the page reached by the native form submission.

Also run P05 for OAuth or linking routes, P06 for enrollment, Memory or erasure, P07 controls for confirmation forms and P08 for watch forms. Run the P09 acceptance story after browser changes. Shared build or CI changes also run operations. Follow each selected feature's prerequisites and performance gates.

Email entry and six-digit code views render the production `/login/send` and `/login/complete` forms with the browser-bound `state` field. The matrix covers entry, generic send refusal, accepted send or resend, generic verification refusal and signed-in completion. Expired codes, exhausted attempts and incorrect codes deliberately share the backend verification refusal; failed mail and exhausted budgets share the send refusal. Real ChatGPT, Claude, live mail and physical-phone behavior remain UNTESTED unless exercised in those environments.
