import { z } from "zod";

export const agentRequestKey = z.string().min(1).max(128).regex(/^(?!person:)/).brand<"RequestKey">();
