import { ContractBreach, refusal, repairFor } from "./results.js";
import type { ControlLinksFor } from "../controls/codec.js";
import { MemoryRefusal } from "../memory/contracts.js";
import { Memory } from "../memory/index.js";
import { watchEntry } from "../memory/watches.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Hunts } from "../hunt/index.js";
import type { HuntStore } from "../hunt/store.js";
import { Knowledge } from "../knowledge/index.js";
import type { Principal } from "../auth/issuer.js";
import { ReadGrants, ReadGrantFailure } from "../auth/grants.js";
import { dispatchParsed } from "./index.js";
import type { ToolCall } from "./index.js";
import { toHuntRequest } from "./contracts.js";

export function authenticatedDispatch(store: HuntStore, principal: Principal, issuer: string, links?: ControlLinksFor, watches = false) {
  const controlsFor = (view: Parameters<ControlLinksFor>[2] & Parameters<typeof watchEntry>[2]) => links ? { ...links(issuer, principal.agent, view), watch: watchEntry(watches ? issuer : null, principal.agent.account, view) } : undefined;
  const controlText = (controls: ReturnType<typeof controlsFor>) => controls ? "\nBrowser controls: " + controls.hub + "\n" + (controls.watch.available ? "Watch price: " + controls.watch.url : "Price watch unavailable: " + controls.watch.reason) : "";
  const hunts = new Hunts({
    store,
    knowledge: new Knowledge(process.env.SCOAT_KNOWLEDGE_DIRECTORY),
  });
  const grants = new ReadGrants(store.pool);
  const now = () =>
    z.string().brand<"UtcInstant">().parse(new Date().toISOString());
  return async (call: ToolCall): Promise<CallToolResult> => {
    if ("requestKey" in call.input && !principal.scopes.has("scoat:write")) return refusal("scope-required", "This connection was approved without write access.", "Reconnect Scoat and approve write access, then repeat the call.", { kind: "reconnect-with-write-access" });
    if (call.name === "scoat_memory") {
      try {
        const value = await new Memory(store.pool,issuer,watches).run({ ...principal.agent, session: principal.session },call.input);
        const text = value.kind === "confirmation-required" ? "Proposal only. Open the browser link and approve the exact command; nothing has been applied." : value.kind === "unwatched" ? "Watch cancelled immediately. Already submitted mail may still arrive: " + ("mayStillArrive" in value ? value.mayStillArrive : 0) + "." : value.kind === "watch-unavailable" && "explanation" in value ? value.explanation : value.kind === "unfinished" ? "Finish the hunt before saving or watching it." : value.kind === "profile" ? "Approved profile updated." : value.kind === "saved" && "item" in value ? "Approved finished result saved." : "Account memory: " + value.kind + ".";
        return { content: [{ type: "text", text }], structuredContent: { ok: true, value } };
      } catch (error) {
        if (!(error instanceof MemoryRefusal)) throw error;
        const next = error.code === "invalid-cursor" ? "Read the collection again without after." : error.code === "missing-item" ? "Read saved items and select an available item." : error.code === "key-reused" ? "Repeat the original payload or use a new request key." : error.code === "expired" ? "Propose the command again with a new request key and confirm it in the browser." : "Reconnect and propose a new command in this session.";
        return refusal(error.code, "Memory request refused: " + error.code + ".", next, error.code === "key-reused" ? { kind: "repeat-original-or-new-key" } : { kind: "none" });
      }
    }
    if (call.name === "scoat_guide")
      return dispatchParsed(call);
    if (call.name === "scoat_hunt") {
      const request = toHuntRequest(call.input);
      const reply = await hunts.run({
        agent: principal.agent,
        request,
        now: now(),
      });
      const controls=reply.ok && "view" in reply.value ? controlsFor(reply.value.view) : undefined;
      return {
        isError: !reply.ok,
        content: [
          {
            type: "text",
            text:
              reply.ok && "view" in reply.value
                ? reply.value.view.text+controlText(controls)
                : reply.ok ? "Recent shopping hunts." : reply.error.message + " " + reply.error.next,
          },
        ],
        structuredContent: {...reply,...(!reply.ok ? { error: { ...reply.error, repair: repairFor(call, reply.error) } } : {}),...(controls ? {controls} : {})},
      };
    }
    const issued = (capability: Awaited<ReturnType<ReadGrants["open"]>>): CallToolResult => ({
      content: [{ type: "text", text: "Private read capability issued until " + capability.expiresAt.toISOString() + "." }],
      structuredContent: { ok: true, value: { capability: "issued", expiresAt: capability.expiresAt.toISOString() } },
      _meta: { "scoat/readCapability": capability },
    });
    try {
    const request = call.input;
    if (request.op === "open") return issued(await grants.open(principal, request.hunt));
    const result = await grants.use(
      principal,
      request.hunt,
      request.grant,
      request.op,
    );
    if (request.op === "read") {
      const reply = await hunts.run({
        agent: principal.agent,
        request: {
          op: "read",
          hunt: request.hunt,
        },
        now: now(),
      });
      const controls=reply.ok && "view" in reply.value ? controlsFor(reply.value.view) : undefined;
      return {
        isError: !reply.ok,
        content: [
          {
            type: "text",
            text:
              reply.ok && "view" in reply.value
                ? reply.value.view.text+controlText(controls)
                : reply.ok ? "Recent shopping hunts." : reply.error.message + " " + reply.error.next,
          },
        ],
        structuredContent: {...reply,...(!reply.ok ? { error: { ...reply.error, repair: repairFor({ name: "scoat_hunt", input: { op: "read", hunt: request.hunt } }, reply.error) } } : {}),...(controls ? {controls} : {})},
      };
    }
    if (request.op === "renew") {
      if (!result.grant || !result.expiresAt) throw new ContractBreach();
      return issued({ grant: result.grant, expiresAt: result.expiresAt });
    }
    return { content: [{ type: "text", text: "Read capability revoked." }], structuredContent: { ok: true, value: { revoked: true } } };
    } catch(error) {
      if (!(error instanceof ReadGrantFailure)) throw error;
      return refusal(error.code, "Card read capability " + error.code + ".", error.code === "expired" ? "Open a fresh card capability through this authenticated connection." : "Reopen the hunt through an authorized connection.", { kind: "none" });
    }
  };
}
