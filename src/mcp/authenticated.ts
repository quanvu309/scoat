import { z } from "zod";
import { Hunts } from "../hunt/index.js";
import type { HuntStore } from "../hunt/store.js";
import { Knowledge } from "../knowledge/index.js";
import type { Principal } from "../auth/identity.js";
import { ReadGrants } from "../auth/grants.js";
import { dispatch, toolCatalog } from "./index.js";
import type { ToolName } from "./index.js";
import { parseHuntRequest } from "./contracts.js";

export function authenticatedDispatch(store: HuntStore, principal: Principal) {
  const hunts = new Hunts({
    store,
    knowledge: new Knowledge(),
    profileOf: async () => ({ student: "unknown", cards: [], memberships: [] }),
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
  return async (name: ToolName, raw: unknown) => {
    toolCatalog[name].input.parse(raw);
    if (name === "scoat_guide" || name === "scoat_memory")
      return dispatch(name, raw);
    if (name === "scoat_hunt") {
      const request = parseHuntRequest(raw);
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
      return {
        isError: !reply.ok,
        content: [
          {
            type: "text",
            text:
              reply.ok && "view" in reply.value
                ? reply.value.view.text
                : JSON.stringify(reply),
          },
        ],
        structuredContent: reply,
      };
    }
    const request = toolCatalog.scoat_card.input.parse(raw);
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
          hunt: z.string().brand<"HuntId">().parse(request.hunt),
        },
        now: now(),
      });
      return {
        isError: !reply.ok,
        content: [
          {
            type: "text",
            text:
              reply.ok && "view" in reply.value
                ? reply.value.view.text
                : JSON.stringify(reply),
          },
        ],
        structuredContent: reply,
      };
    }
    return {
      content: [{ type: "text", text: "Read capability updated" }],
      structuredContent: result,
    };
  };
}
