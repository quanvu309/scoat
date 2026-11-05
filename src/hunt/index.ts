import { randomUUID } from "node:crypto";
import { z } from "zod";
import { digest, StoreFailure } from "./postgres.js";
import type { Snapshot, Scope, Tx } from "./postgres.js";
import { nonempty, offerIdSchema, compatibilitySchema, parseEvidence, validateProof } from "./evidence.js";
import { priceQuotes, pickBest } from "./pricing.js";
import { renderView } from "./view.js";
import type { AccountScope } from "../domain.js";
import type { Agent, Compatibility, Failure, HuntId, Instant, Intent, NonEmpty, Offer, OfferInput, Person, Profile, Proof, Quote, ReadyLink, ReleaseId, RequestKey, Result, RowId, RowRevision, Selection, } from "../domain.js";
import type { Knowledge, Release, Row } from "../knowledge/index.js";
import type { Delivery } from "../delivery/index.js";
import type { HuntStore } from "./store.js";
export type CheckOutcome = {
    readonly kind: "checking";
} | {
    readonly kind: "found";
    readonly offers: NonEmpty<OfferInput>;
} | {
    readonly kind: "none";
    readonly checked: string;
    readonly seller?: string;
    readonly proof: NonEmpty<Proof>;
} | {
    readonly kind: "gap";
    readonly reason: string;
};
export type HuntRequest = { readonly op: "compatibility"; readonly requestKey: RequestKey; readonly hunt: HuntId; readonly evidence: Compatibility } | {
    readonly op: "start";
    readonly requestKey: RequestKey;
    readonly intent: Intent;
    readonly profile: Profile | null;
} | {
    readonly op: "read";
    readonly hunt: HuntId;
} | {
    readonly op: "list"; readonly after?: HuntId; readonly limit?: number;
} | {
    readonly op: "record";
    readonly requestKey: RequestKey;
    readonly hunt: HuntId;
    readonly row: RowId;
    readonly slot: number;
    readonly expected: RowRevision;
    readonly outcome: CheckOutcome;
} | {
    readonly op: "finish";
    readonly requestKey: RequestKey;
    readonly hunt: HuntId;
    readonly selection: Selection | null;
};
export type Control = {
    readonly kind: "stop";
} | {
    readonly kind: "skip";
    readonly row: RowId;
};
export type SlotCompletion = { readonly kind: "pending" } | { readonly kind: "checked"; readonly checked?: string; readonly proof: NonEmpty<Proof>; readonly offers: readonly Offer["id"][] } | { readonly kind: "gap"; readonly reason: string };
export type RowView = Readonly<{
    row: Row;
    revision: RowRevision;
    skippedBy: "person" | null;
    slots: readonly Readonly<{ slot: number; seller: string | null; completion: SlotCompletion }>[];
}>;
export type HuntView = Readonly<{
    hunt: HuntId;
    release: ReleaseId;
    intent: Intent;
    profile: Profile;
    rows: NonEmpty<RowView>;
    offers: readonly Offer[];
    quotes: readonly Quote[];
    gaps: readonly string[];
    progress: {
        readonly resolved: number;
        readonly total: number;
    };
    best: Quote | null;
    final: {
        readonly kind: "open";
    } | {
        readonly kind: "finished";
        readonly quote: Quote | null;
    };
    stopRequested: boolean;
    ready: ReadyLink | null;
    directive: {
        readonly kind: "continue";
        readonly rows: NonEmpty<RowId>;
    } | {
        readonly kind: "name-gaps-and-finish";
        readonly rows: readonly RowId[];
    } | {
        readonly kind: "finish";
    } | {
        readonly kind: "complete";
    };
    text: string;
}>;
export type HuntResult<T> = Result<T> & { readonly current?: HuntView };
export type HuntReply = Readonly<{
    view: HuntView;
}>;
export { checkEvidence, assertRecordAllowed } from "./evidence.js";
export { priceQuotes, pickBest } from "./pricing.js";
export { finishable, renderView } from "./view.js";
function failure(code: Failure["code"], message: string): { readonly ok: false; readonly error: Failure } { return { ok: false, error: { code, message, next: "Read current hunt and submit a new request key with fresh evidence" } }; }
function projection(state: Snapshot, now: string, selection: Selection | null = null): HuntView {
    if (state.final) return state.final;
    const rows = state.release.rows.map(recipe => {
        const row = state.rows.find(r => r.row === recipe.id);
        if (!row) throw new Error("Missing canonical row");
        return { row: recipe, revision: row.revision, slots: row.slots, skippedBy: row.skippedByPerson ? "person" as const : null };
    });
    const evidenceGaps: string[] = [];
    const currentOffers = state.offers.filter(offer => {
        try { const { id, row, ...input } = offer; parseEvidence(input,{ intent: state.hunt.intent, seller: offer.seller, now, release: state.release }); return true; }
        catch { evidenceGaps.push(offer.id + ": evidence no longer current"); return false; }
    });
    const currentIds = new Set(currentOffers.map(offer => offer.id));
    const compatibility = state.compatibility.filter(entry => {
        try { entry.proof.forEach(proof => validateProof(proof,now)); return entry.offers.every(id => currentIds.has(id)); }
        catch { evidenceGaps.push("Compatibility evidence no longer current"); return false; }
    });
    const quotes = priceQuotes({ offers: currentOffers, compatibility, release: state.release, intent: state.hunt.intent, now, selection });
    return renderView({ evidenceGaps, hunt: state.hunt.id, release: state.release, intent: state.hunt.intent, profile: state.hunt.profile, rows, offers: state.offers, quotes, final: state.hunt.final, stopRequested: state.hunt.stopRequestedAt !== null, ready: null });
}
export class Hunts {
    constructor(private readonly deps: { store: HuntStore; knowledge: Knowledge; delivery: Delivery; profileOf: (agent: Agent) => Promise<Profile> }) {}
    private async execute<T>(scope: Scope, run: (tx: Tx) => Promise<Result<T>>): Promise<Result<T>> {
        try { return await this.deps.store.transact(scope, async tx => {
            const reply = await run(tx);
            await tx.receipt(reply);
            return reply;
        }); } catch (error) {
            if (error instanceof StoreFailure) return failure(error.code, error.message);
            throw error;
        }
    }
    async run({ agent, request, now }: { agent: Agent; request: HuntRequest; now: Instant }): Promise<HuntResult<HuntReply | { readonly hunts: readonly HuntView[]; readonly next?: HuntId | null }>> {
        let start: { release: Release; profile: Profile } | null = null;
        if (request.op === "start") {
            try {
                const replay = await this.deps.store.transact({ ...agent, hunt: null, accountFence: "shared", huntFence: "shared", rows: [] }, tx => tx.priorReceipt({ key: request.requestKey, digest: digest(request) }));
                if (replay !== null) return replay as HuntResult<HuntReply>;
            } catch (error) {
                if (error instanceof StoreFailure) return failure(error.code,error.message);
                throw error;
            }
            start = { release: await this.deps.knowledge.read({ release: "latest" }), profile: request.profile ?? await this.deps.profileOf(agent) };
        }
        const scope: Scope = { ...agent, hunt: "hunt" in request ? request.hunt : null, accountFence: "shared", huntFence: request.op === "finish" || request.op === "compatibility" ? "exclusive" : "shared", rows: request.op === "record" ? [request.row] : [], ...("requestKey" in request ? { request: { key: request.requestKey, digest: digest(request) } } : {}) };
        return this.execute<HuntReply | { readonly hunts: readonly HuntView[]; readonly next?: HuntId | null }>(scope, async tx => {
            if (request.op === "list") {
                const hunts = [];
                const ids = await tx.ids(request.after, (request.limit ?? 20) + 1);
                for (const id of ids.slice(0,request.limit ?? 20)) { const state = await tx.snapshot(id); if (state) hunts.push(projection(state,now)); }
                return { ok: true, value: { hunts, next: ids.length > (request.limit ?? 20) ? hunts.at(-1)?.hunt ?? null : null } };
            }
            if (request.op === "start") {
                if (!start) throw new Error("Missing start inputs");
                const id = z.string().brand<"HuntId">().parse(randomUUID());
                await tx.create({ id, account: agent.account, release: start.release.id, intent: request.intent, profile: start.profile, startedAt: now, stopRequestedAt: null, final: { kind: "open" } }, start.release, start.release.rows.map(row => ({ hunt: id, row: row.id, revision: z.number().brand<"RowRevision">().parse(0), skippedByPerson: null, slots: row.slots.map(slot => ({ slot, seller: null, completion: { kind: "pending" } })) })));
                const state = await tx.snapshot(id);
                if (!state) throw new Error("Missing created hunt");
                return { ok: true, value: { view: projection(state,now) } };
            }
            const state = await tx.snapshot(request.hunt);
            if (!state) return failure("missing","Hunt unavailable");
            if (request.op === "read") return { ok: true, value: { view: projection(state,now) } };
            if (state.final) return failure("conflict","Hunt is finished");
            if (request.op === "record") {
                const row = state.rows.find(row => row.row === request.row);
                if (!row) return failure("invalid","Unknown row");
                if (row.revision !== request.expected || row.skippedByPerson) return { ok: false, error: { code: "conflict", message: "Row revision changed or person skipped", next: "Use the coherent current view and a new request key" }, current: projection(state,now) };
                if (!row.slots.some(slot => slot.slot === request.slot)) return failure("invalid","Unknown slot");
                if (state.hunt.stopRequestedAt && request.outcome.kind === "found") return failure("forbidden","Stop refuses every found outcome");
                const outcome = request.outcome;
                let offers: Offer[] = [];
                let completion: SlotCompletion;
                let seller: string | null = null;
                try {
                    if (outcome.kind === "found") {
                        offers = nonempty(outcome.offers).map(raw => {
                            const input = parseEvidence(raw,{ intent: state.hunt.intent, seller: raw.seller, now, release: state.release });
                            return { ...input, id: offerIdSchema.parse(randomUUID()), row: request.row };
                        });
                        seller = offers[0]?.seller ?? null;
                        if (offers.some(o => o.seller !== seller)) throw new Error("Slot must have one seller");
                        completion = { kind: "checked", proof: nonempty(offers.map(o => o.proof)), offers: offers.map(o => o.id) };
                    } else if (outcome.kind === "none") {
                        seller = outcome.seller ?? state.hunt.intent.shop;
                        if (state.release.rows.find(recipe => recipe.id === row.row)?.place === "other-sellers" && !outcome.seller) throw new Error("Checked other seller requires explicit seller identity");
                        completion = { kind: "checked", checked: z.string().trim().min(1).parse(outcome.checked), proof: nonempty(outcome.proof.map(p => validateProof(p,now))), offers: [] };
                    }
                    else if (outcome.kind === "gap") completion = { kind: "gap", reason: z.string().trim().min(1).parse(outcome.reason) };
                    else completion = { kind: "pending" };
                } catch (error) { return failure("invalid",String(error)); }
                await tx.replaceOffers(request.hunt,request.row,request.slot,offers);
                await tx.putRow({ ...row, revision: z.number().brand<"RowRevision">().parse(row.revision + 1), slots: row.slots.map(slot => slot.slot === request.slot ? { slot: request.slot, completion, seller } : slot) });
            } else if (request.op === "compatibility") {
                let evidence: Compatibility;
                try {
                    evidence = compatibilitySchema.parse(request.evidence);
                    priceQuotes({ offers: state.offers.filter(offer => evidence.offers.includes(offer.id)), release: state.release, intent: state.hunt.intent, now, selection: null, compatibility: [evidence] });
                } catch (error) { return failure("unproven",String(error)); }
                await tx.compatible(request.hunt,evidence);
            } else {
                const view = projection(state,now);
                if (view.progress.resolved !== view.progress.total) return failure("incomplete","Canonical slots remain unresolved");
                let selected;
                try { selected = projection(state,now,request.selection); } catch (error) { return failure("unproven",String(error)); }
                const quote = pickBest(selected.quotes);
                const final = { ...selected, final: { kind: "finished" as const, quote }, directive: { kind: "complete" as const } };
                const hunt = { ...state.hunt, final: { kind: "finished" as const, quote, at: now } };
                const rendered = renderView({ ...final, release: state.release });
                await tx.putHunt(hunt,rendered);
            }
            const fresh = await tx.snapshot(request.hunt);
            if (!fresh) throw new Error("Lost hunt");
            return { ok: true, value: { view: projection(fresh,now) } };
        });
    }
    async control({ person, hunt, requestKey, control, now }: { person: Person; hunt: HuntId; requestKey: RequestKey; control: Control; now: Instant }): Promise<Result<HuntReply>> {
        return this.execute({ ...person, hunt, accountFence: "shared", huntFence: control.kind === "stop" ? "exclusive" : "shared", rows: control.kind === "skip" ? [control.row] : [], request: { key: requestKey, digest: digest({ hunt, control }) } }, async tx => {
            const state = await tx.snapshot(hunt);
            if (!state) return failure("missing","Hunt unavailable");
            if (state.final) return failure("conflict","Hunt is finished");
            if (control.kind === "stop") await tx.putHunt({ ...state.hunt, stopRequestedAt: now });
            else {
                const row = state.rows.find(row => row.row === control.row);
                if (!row) return failure("invalid","Unknown row");
                if (!row.skippedByPerson) await tx.putRow({ ...row, skippedByPerson: now, revision: z.number().brand<"RowRevision">().parse(row.revision+1) });
            }
            const fresh = await tx.snapshot(hunt);
            if (!fresh) throw new Error("Lost hunt");
            return { ok: true, value: { view: projection(fresh,now) } };
        });
    }
    async inspect({ person, hunt, now }: { person: Person; hunt: HuntId; now?: Instant }): Promise<Result<HuntView>> {
        const reply = await this.run({ agent: { ...person, kind: "agent", client: "trusted-inspect" }, request: { op: "read", hunt }, now: now ?? z.iso.datetime().brand<"UtcInstant">().parse(new Date().toISOString()) });
        return reply.ok && "view" in reply.value ? { ok: true, value: reply.value.view } : reply.ok ? failure("missing","Missing view") : reply;
    }
    async finished({ account, hunt }: { account: AccountScope; hunt: HuntId }): Promise<Result<HuntView>> {
        return this.execute({ ...account, hunt, accountFence: "shared", huntFence: "shared", rows: [] }, async tx => {
            const state = await tx.snapshot(hunt);
            return state?.final ? { ok: true, value: state.final } : failure("incomplete","No finished snapshot");
        });
    }
    async erase({ account }: { account: AccountScope }): Promise<void> {
        await this.deps.store.transact({ ...account, hunt: null, accountFence: "exclusive", huntFence: "exclusive", rows: [] }, tx => tx.erase());
    }
}
export type { Failure };
