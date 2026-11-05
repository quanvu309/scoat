import { browserDocument } from "./page.js";
import { emailEntry, emailCode, signedIn } from "./views.js";

export function loginPage(state: string, message: string): string {
 const content = message === "Check your email for a code. Enter it below." || message === "That code could not be verified. Try again or request a new code."
  ? emailCode({ state, invalid: message === "That code could not be verified. Try again or request a new code." })
  : emailEntry({ state, failed: message === "A code could not be sent. Try again later." });
 return browserDocument(content);
}
export function signedInPage(): string {
 return browserDocument(signedIn());
}
