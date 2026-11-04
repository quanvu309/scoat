import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
export const controlKeysSchema = z.strictObject({ version: z.literal(1), keyId: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/), secret: z.string().regex(/^[a-f0-9]{64}$/) });
const scope = { account: z.string().min(1).max(128).brand<"AccountId">(), incarnation: z.uuid().brand<"Incarnation">(), hunt: z.string().min(1).max(128).brand<"HuntId">() };
export const actionSchema = z.discriminatedUnion("kind", [z.strictObject({kind:z.literal("stop")}),z.strictObject({kind:z.literal("skip"),row:z.string().min(1).max(128).brand<"RowId">()})]);
const actionIntentSchema = z.strictObject({ ...scope, action: actionSchema });
export const intentSchema = z.union([actionIntentSchema,z.strictObject({...scope,action:z.strictObject({kind:z.literal("hub")})})]);
const intentToken = z.strictObject({version:z.literal(1), keyId:z.string(), purpose:z.literal("intent"), intent:intentSchema});
const confirmationToken = z.strictObject({version:z.literal(1), keyId:z.string(), purpose:z.literal("confirmation"), intent:actionIntentSchema, nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/), browser:z.string().regex(/^[a-f0-9]{64}$/), deadline:z.number().int().positive()});
export type ControlIntent = z.infer<typeof intentSchema>;
export type ControlAction = z.infer<typeof actionSchema>;
type Confirmation = z.infer<typeof confirmationToken>;
const valid = new WeakSet<object>();
class Authority {
 private readonly nominal = true;
 constructor(readonly confirmation: Confirmation) { valid.add(this); Object.freeze(this); }
}
export type VerifiedControl = Authority;
export function verifiedControl(value: VerifiedControl): Confirmation {
 if (!valid.has(value)) throw new Error("Verified browser control required");
 return value.confirmation;
}
export class ControlCodec {
 private readonly keys;
 constructor(raw:unknown) { this.keys=controlKeysSchema.parse(raw); }
 private mac(value:string) { return createHmac("sha256",this.keys.secret).update(value).digest(); }
 private sign(value:unknown) { const body=Buffer.from(JSON.stringify(value)).toString("base64url"); return body+"."+this.mac(body).toString("base64url"); }
 private open(token:string):unknown {
  if (token.length>4096) throw new Error("Oversized control token");
  const parts=token.split("."); if(parts.length!==2) throw new Error("Invalid control token");
  const [body,signature]=parts; if(!body || !signature) throw new Error("Missing control token");
  const supplied=Buffer.from(signature,"base64url"), expected=this.mac(body);
  if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) throw new Error("Invalid control signature");
  return JSON.parse(Buffer.from(body,"base64url").toString("utf8"));
 }
 intent(raw:unknown) { return this.sign({version:1,keyId:this.keys.keyId,purpose:"intent",intent:intentSchema.parse(raw)}); }
 readIntent(token:string) { const value=intentToken.parse(this.open(token)); if(value.keyId!==this.keys.keyId) throw new Error("Retired control key"); return value.intent; }
 issue(raw:unknown, browser:string, databaseTime:number) {
  const nonce=randomBytes(32).toString("base64url");
  const confirmation=confirmationToken.parse({version:1,keyId:this.keys.keyId,purpose:"confirmation",intent:actionIntentSchema.parse(raw),nonce,browser:this.mac(browser).toString("hex"),deadline:Math.floor(databaseTime)+120000});
  return {token:this.sign(confirmation),nonce};
 }
 verify(token:string, browser:string, action:unknown):VerifiedControl {
  const value=confirmationToken.parse(this.open(token));
  if(value.keyId!==this.keys.keyId || value.browser!==this.mac(browser).toString("hex") || JSON.stringify(value.intent.action)!==JSON.stringify(actionSchema.parse(action))) throw new Error("Browser control binding mismatch");
  const frozen=Object.freeze({...value,intent:Object.freeze({...value.intent,action:Object.freeze(value.intent.action)})});
  return new Authority(frozen);
 }
 nonce(token:string) { return confirmationToken.parse(this.open(token)).nonce; }
 links(issuer:string,account:unknown,view:{hunt:string;rows:readonly {row:{id:string}}[]}) {
  const parsed=z.object({account:z.string(),incarnation:z.string()}).parse(account);
  const link=(action:unknown)=>issuer+"/account/control?intent="+encodeURIComponent(this.intent({...parsed,hunt:view.hunt,action}));
  return {hub:link({kind:"hub"}),stop:link({kind:"stop"}),skip:view.rows.map(row=>({row:row.row.id,url:link({kind:"skip",row:row.row.id})})),watch:{available:false,reason:"Watch requires P08 verified email and a confirmed target"}};
 }
}
