import type { ControlLinksFor } from "../controls/codec.js";
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
    if (call.name === "scoat_memory") {
      if (["profile","save","watch","unwatch"].includes(call.input.op) && !principal.scopes.has("scoat:write")) throw new Error("Write scope required");
      const result = await new Memory(store.pool,issuer,watches).run({ ...principal.agent, session: principal.session },call.input);
      return { content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result };
    }
    if (call.name === "scoat_guide")
      return dispatchParsed(call);
    if (call.name === "scoat_hunt") {
      const request = toHuntRequest(call.input);
      if (
        !["list", "read"].includes(request.op) &&
        !principal.scopes.has("scoat:write")
      )
        throw new Error("Write scope required");
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
                : JSON.stringify(reply),
          },
        ],
        structuredContent: {...reply,...(controls ? {controls} : {})},
      };
    }
    try {
    const request = call.input;
    if (request.op === "open")
      return {
        content: [{ type: "text", text: "Read capability created" }],
        _meta: { "scoat/readCapability": await grants.open(principal, request.hunt) },
      };
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
                : JSON.stringify(reply),
          },
        ],
        structuredContent: {...reply,...(controls ? {controls} : {})},
      };
    }
    return {
      content: [{ type: "text", text: "Read capability updated" }],
      ...(request.op === "renew" ? {_meta:{"scoat/readCapability":result}} : {structuredContent:result}),
    };
    } catch(error) {
      return {isError:true,content:[{type:"text",text:"Card read unavailable"}],_meta:{"scoat/cardFailure":{code:error instanceof ReadGrantFailure ? error.code : "transient"}}};
    }
  };
}
