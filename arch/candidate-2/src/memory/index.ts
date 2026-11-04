import type { Failure, Human, HuntId, Id, Pence, Principal, Product, Profile, RequestId, Revision } from "../core/index.js";
export interface SavedItem { readonly id: Id<"saved">; readonly product: Product; readonly hunt: HuntId; readonly target: Pence | null }
export interface MemoryView { readonly revision: Revision; readonly profile: Profile; readonly saved: readonly SavedItem[] }
export type MemoryChange = { readonly kind: "profile"; readonly profile: Profile }
  | { readonly kind: "save"; readonly hunt: HuntId; readonly target: Pence | null }
  | { readonly kind: "forget-item"; readonly id: Id<"saved"> }
  | { readonly kind: "erase-account" };
/** One account across OAuth hosts. Actor identity comes from auth, never tool arguments. */
export class Memory {
  async read(principal: Principal): Promise<MemoryView> { throw new Error("not implemented"); }
  /** CAS prevents cross-host profile loss; retries dedupe before revision validation.
   * Deletion immediately tombstones account, invalidates sessions/links and cancels watches;
   * durable cascade erases journals, receipts, saved items, addresses and queued mail.
   * Worker generation checks prevent resurrection; backup expiry follows deletion policy.
   */
  async change(input: { human: Human; requestId: RequestId; expected: Revision; change: MemoryChange }): Promise<MemoryView | { readonly kind: "erased" } | Failure> {
    throw new Error("not implemented");
  }
}
