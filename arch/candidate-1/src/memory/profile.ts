import type { AccountId, Agent, Person, Profile, RequestKey, Result, Revision } from "../domain.js";

export type ProfileChange =
  | { readonly kind: "student"; readonly value: Profile["student"] }
  | { readonly kind: "card" | "membership"; readonly name: string; readonly action: "add" | "remove" };
/** Owns private declarations. No card numbers, bank tokens or student verification documents. */
export class Profiles {
  read(args: { account: AccountId }): Promise<Profile> {
    // TODO Fold per-actor declarations; absent student is unknown, never assumed eligible.
    throw new Error("not implemented");
  }
  change(args: { actor: Agent | Person; requestKey: RequestKey; basis: Revision; change: ProfileChange }): Promise<Result<Profile>> {
    // TODO Append idempotently. Membership/card sets use observed-remove semantics from basis;
    // TODO concurrent additions survive. Student declaration uses causal order then stable event ID.
    throw new Error("not implemented");
  }
  erase(args: { account: AccountId }): Promise<void> {
    throw new Error("not implemented");
  }
}
