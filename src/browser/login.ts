const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
export function loginPage(state: string, message: string): string {
 return `<title>Sign in to Scoat</title><h1>Sign in to Scoat</h1><p>${escape(message)}</p><form method="post" action="/login/send"><input type="hidden" name="state" value="${escape(state)}"><label>Email <input name="email" type="email" autocomplete="email" required maxlength="254"></label><button>Send code</button></form><form method="post" action="/login/complete"><input type="hidden" name="state" value="${escape(state)}"><label>Code <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button>Sign in</button></form>`;
}
export function signedInPage(): string {
 return `<title>Signed in to Scoat</title><h1>You are signed in</h1><p>Connect Scoat from ChatGPT or Claude, then choose Allow.</p>`;
}
