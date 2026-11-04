import type { HuntId, Id, Money, RequestKey, RowId } from "../domain.js";
import type { HuntView } from "../hunt/index.js";
export type CardState = {
    readonly kind: "running";
    readonly view: HuntView;
} | {
    readonly kind: "done";
    readonly view: HuntView;
} | {
    readonly kind: "offline";
    readonly lastView: HuntView;
    readonly retryInMs: number;
};
export interface CardBridge {
    call(args: {
        name: "scoat_card";
        arguments: unknown;
    }): Promise<unknown>;
    openLink(url: string): Promise<void>;
}
export function mountCard(args: {
    root: HTMLElement;
    bridge: CardBridge;
    hunt: HuntId;
    grant: Id<"AppGrant">;
    initial: HuntView;
}): () => void {
    throw new Error("not implemented");
}
export type CardAction = {
    readonly kind: "stop";
    readonly requestKey: RequestKey;
} | {
    readonly kind: "skip";
    readonly requestKey: RequestKey;
    readonly row: RowId;
} | {
    readonly kind: "watch";
    readonly requestKey: RequestKey;
    readonly target: Money;
} | {
    readonly kind: "open-ready-link";
};
