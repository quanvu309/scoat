import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Agent, HuntId, Id, Money, Person, RequestKey, Result } from "../domain.js";
import type { Guide, GuideRequest, Knowledge } from "../knowledge/index.js";
import type { Control, HuntReply, HuntRequest, Hunts, HuntView } from "../hunt/index.js";
import type { Memory, MemoryReply, MemoryRequest } from "../memory/index.js";
export type CardRequest = Readonly<{
    hunt: HuntId;
    grant: Id<"AppGrant">;
}> & ({
    readonly op: "poll";
} | {
    readonly op: "act";
    readonly requestKey: RequestKey;
    readonly action: Control | {
        readonly kind: "watch";
        readonly target: Money;
    };
});
export type Contracts = {
    scoat_guide: {
        input: GuideRequest;
        output: Result<Guide>;
    };
    scoat_hunt: {
        input: HuntRequest;
        output: Result<HuntReply | {
            readonly hunts: readonly HuntView[];
        }>;
    };
    scoat_memory: {
        input: MemoryRequest;
        output: Result<MemoryReply>;
    };
    scoat_card: {
        input: CardRequest;
        output: Result<HuntView | MemoryReply>;
    };
};
export const toolCatalog = {
    scoat_guide: {
        visibility: ["model"], readOnly: true,
        description: "Get the hunt method and Scoat's facts for a shop (student scheme, what stacks, cashback, price match). " +
            "Use when the host has no prompts. You search and open pages yourself; Scoat gives the method.",
    },
    scoat_hunt: {
        visibility: ["model"], readOnly: false,
        description: "Start, list, read, record or finish a hunt for the best benefit. Record each checklist slot with " +
            "a source link and time, or a named gap. Follow the returned directive. Finish only when every row is done, " +
            "skipped by the person, or a gap. Scoat prices the result; never send totals. Reuse requestKey only to retry.",
    },
    scoat_memory: {
        visibility: ["model"], readOnly: false,
        description: "Read or update what she has (student, cards, memberships), save a finished hunt, watch it daily " +
            "for a target price by email, stop a watch, or erase her data. Watch only when she asks. Never send card numbers.",
    },
    scoat_card: {
        visibility: ["app"], readOnly: false,
        description: "Card only: poll a hunt, or send her Stop, Skip or Watch. Not for agents.",
    },
} satisfies {
    [K in keyof Contracts]: {
        visibility: readonly ("model" | "app")[];
        readOnly: boolean;
        description: string;
    };
};
export const promptCatalog = {
    prompts: ["hunt-best-benefit"],
    resources: ["scoat://releases/{release}/playbook", "scoat://releases/{release}/facts/{shop}", "scoat://releases/{release}/SKILL.md"],
    apps: ["ui://scoat/hunt.html"],
} as const;
export function schemas(): never {
    throw new Error("not implemented");
}
export function authenticate(args: {
    bearer: unknown;
}): Promise<Agent> {
    throw new Error("not implemented");
}
export function person(args: {
    grant: Id<"AppGrant">;
    hunt: HuntId;
}): Promise<Person> {
    throw new Error("not implemented");
}
export function mount(args: {
    server: McpServer;
    knowledge: Knowledge;
    hunts: Hunts;
    memory: Memory;
}): void {
    throw new Error("not implemented");
}
