import type { ControlCodec } from "../controls/codec.js";
import { Memory } from "../memory/index.js";
import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Hunts } from "../hunt/index.js";
import type { HuntStore } from "../hunt/store.js";
import { Knowledge } from "../knowledge/index.js";
import type { Principal } from "../auth/issuer.js";
import { ReadGrants } from "../auth/grants.js";
import { dispatchParsed } from "./index.js";
import type { ToolCall } from "./index.js";
import { toHuntRequest } from "./contracts.js";

export function authenticatedDispatch(store: HuntStore, principal: Principal, issuer: string, codec?: ControlCodec) {
  const hunts = new Hunts({
    store,
    knowledge: new Knowledge(process.env.SCOAT_KNOWLEDGE_DIRECTORY),
    delivery: {
      readyLink: async () => {
        throw new Error("Live delivery requires separate verification");
      },
      recheck: async () => {
        throw new Error("Live delivery requires separate verification");
      },
      email: async () => {
        throw new Error("Mail unavailable");
      },
    },
  });
  const grants = new ReadGrants(store.pool);
  const now = () =>
    z.string().brand<"UtcInstant">().parse(new Date().toISOString());
  return async (call: ToolCall): Promise<CallToolResult> => {
    if (call.name === "scoat_memory") {
      if (["profile","save"].includes(call.input.op) && !principal.scopes.has("scoat:write")) throw new Error("Write scope required");
      const result = await new Memory(store.pool,issuer).run({ ...principal.agent, session: principal.session },call.input);
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
      const controls=reply.ok && "view" in reply.value ? codec?.links(issuer,principal.agent,reply.value.view) : undefined;
      return {
        isError: !reply.ok,
        content: [
          {
            type: "text",
            text:
              reply.ok && "view" in reply.value
                ? reply.value.view.text+(controls ? "\nBrowser controls: "+controls.hub+"\n"+controls.watch.reason : "")
                : JSON.stringify(reply),
          },
        ],
        structuredContent: {...reply,...(controls ? {controls} : {})},
      };
    }
    const request = call.input;
    if (request.op === "open")
      return {
        content: [{ type: "text", text: "Read capability created" }],
        structuredContent: await grants.open(principal, request.hunt),
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
      const controls=reply.ok && "view" in reply.value ? codec?.links(issuer,principal.agent,reply.value.view) : undefined;
      return {
        isError: !reply.ok,
        content: [
          {
            type: "text",
            text:
              reply.ok && "view" in reply.value
                ? reply.value.view.text+(controls ? "\nBrowser controls: "+controls.hub+"\n"+controls.watch.reason : "")
                : JSON.stringify(reply),
          },
        ],
        structuredContent: {...reply,...(controls ? {controls} : {})},
      };
    }
    return {
      content: [{ type: "text", text: "Read capability updated" }],
      structuredContent: result,
    };
  };
}
