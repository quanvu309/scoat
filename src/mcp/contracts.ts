import { agentRequestKey as key } from "../hunt/request-key.js";
import { z } from "zod";
import type { HuntRequest } from "../hunt/index.js";
import { nonempty } from "../hunt/evidence.js";
import { huntInput } from "./index.js";

const hunt = z.string().brand<"HuntId">();

export function parseHuntRequest(raw: unknown): HuntRequest {
  return toHuntRequest(huntInput.parse(raw));
}
export function toHuntRequest(request: z.infer<typeof huntInput>): HuntRequest {
  if (request.op === "list")
    return {
      op: "list",
      ...(request.after === undefined ? {} : { after: request.after }),
      ...(request.limit === undefined ? {} : { limit: request.limit }),
    };
  if (request.op === "start")
    return {
      ...request,
      requestKey: key.parse(request.requestKey),
      intent: {
        ...request.intent,
        product:
          request.intent.product.kind === "url"
            ? {
                kind: "url",
                url: z
                  .string()
                  .brand<"PublicHttpsUrl">()
                  .parse(request.intent.product.url),
              }
            : request.intent.product,
      },
    };
  if (request.op === "read")
    return { ...request, hunt: hunt.parse(request.hunt) };
  if (request.op === "record")
    return {
      ...request,
      hunt: hunt.parse(request.hunt),
      requestKey: key.parse(request.requestKey),
      outcome:
        request.outcome.kind === "found"
          ? { ...request.outcome, offers: nonempty(request.outcome.offers) }
          : request.outcome.kind === "none"
            ? {
                kind: "none",
                checked: request.outcome.checked,
                proof: nonempty(request.outcome.proof),
                ...(request.outcome.seller === undefined
                  ? {}
                  : { seller: request.outcome.seller }),
              }
            : request.outcome,
      row: z.string().brand<"RowId">().parse(request.row),
      expected: z.number().brand<"RowRevision">().parse(request.expected),
    };
  return {
    ...request,
    hunt: hunt.parse(request.hunt),
    requestKey: key.parse(request.requestKey),
  };
}
