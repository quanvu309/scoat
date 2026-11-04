import { z } from "zod";

export const pihut = {
 parser: "pihut-rpi5-v1",
 seller: "The Pi Hut",
 host: "thepihut.com",
 product: "https://thepihut.com/products/raspberry-pi-5",
 delivery: "https://thepihut.com/pages/delivery",
 productId: 7628874285251,
 variants: new Map<number, Readonly<{ sku: string; title: string }>>([
  [55037260890497, { sku: "SC2162", title: "1GB" }],
  [43878483198147, { sku: "SC1642", title: "2GB" }],
  [42531604922563, { sku: "SC1431", title: "4GB" }],
  [42531604955331, { sku: "SC1432", title: "8GB" }],
  [53972414431617, { sku: "SC1113", title: "16GB" }],
 ]),
 service: "royal-mail-1st-class",
 rule: "pihut-uk-delivery-table-v1",
} as const;

export type ProductUnknown = "product-format-changed" | "currency-not-gbp" | "variant-changed" | "unavailable" | "conditional-pricing" | "conflicting-product";
export type DeliveryUnknown = "delivery-rule-changed";
export type ProductReading = { kind: "ok"; pence: number; sku: string } | { kind: "unknown"; reason: ProductUnknown };

const variantSchema = z.object({ id: z.number().int(), sku: z.string(), price: z.number().int().positive(), available: z.boolean(), requires_selling_plan: z.boolean(), selling_plan_allocations: z.array(z.unknown()) });
const productSchema = z.object({ id: z.number().int(), handle: z.string(), requires_selling_plan: z.boolean(), variants: z.array(variantSchema).min(1) });

function single(html: string, marker: string): number | null {
 const first = html.indexOf(marker);
 return first === -1 || html.indexOf(marker, first + marker.length) !== -1 ? null : first + marker.length;
}

function jsonValue(html: string, start: number): unknown {
 if (html[start] !== "{") return undefined;
 let depth = 0, quoted = false, escaped = false;
 for (let index = start; index < html.length && index - start < 1048576; index++) {
  const character = html[index];
  if (quoted) {
   if (escaped) escaped = false;
   else if (character === "\\") escaped = true;
   else if (character === "\"") quoted = false;
   continue;
  }
  if (character === "\"") quoted = true;
  else if (character === "{") depth++;
  else if (character === "}" && --depth === 0) {
   if (html[index + 1] !== ";") return undefined;
   try { return JSON.parse(html.slice(start, index + 1)); } catch { return undefined; }
  }
 }
 return undefined;
}

export function readProduct(html: string, variant: number): ProductReading {
 const known = pihut.variants.get(variant);
 if (!known) return { kind: "unknown", reason: "variant-changed" };
 if (single(html, `<link rel="canonical" href="${pihut.product}"`) === null) return { kind: "unknown", reason: "product-format-changed" };
 if (single(html, "Shopify.currency = {\"active\":\"GBP\",\"rate\":\"1.0\"};") === null || single(html, "Shopify.country = \"GB\";") === null) return { kind: "unknown", reason: "currency-not-gbp" };
 const start = single(html, "_BISConfig.product = ");
 if (start === null) return { kind: "unknown", reason: "product-format-changed" };
 const parsed = productSchema.safeParse(jsonValue(html, start));
 if (!parsed.success || parsed.data.id !== pihut.productId || parsed.data.handle !== "raspberry-pi-5") return { kind: "unknown", reason: "product-format-changed" };
 const matches = parsed.data.variants.filter(item => item.id === variant);
 const [selected] = matches;
 if (matches.length !== 1 || !selected) return { kind: "unknown", reason: matches.length ? "conflicting-product" : "variant-changed" };
 if (selected.sku !== known.sku) return { kind: "unknown", reason: "variant-changed" };
 if (parsed.data.requires_selling_plan || selected.requires_selling_plan || selected.selling_plan_allocations.length) return { kind: "unknown", reason: "conditional-pricing" };
 if (!selected.available) return { kind: "unknown", reason: "unavailable" };
 return { kind: "ok", pence: selected.price, sku: selected.sku };
}

export function readDelivery(html: string): { kind: "ok"; pence: number } | { kind: "unknown"; reason: DeliveryUnknown } {
 const start = single(html, "id=\"UnitedKingdom\">");
 const end = start === null ? -1 : html.indexOf("International - European Union", start);
 if (start === null || end === -1 || end - start > 20000) return { kind: "unknown", reason: "delivery-rule-changed" };
 const tokens = html.slice(start, end).replace(/<[^>]*>/g, "|").split("|").map(token => token.replace(/\s+/g, " ").trim()).filter(Boolean);
 const text = tokens.join("|");
 if (/free|member|discount|lithium/i.test(text)) return { kind: "unknown", reason: "delivery-rule-changed" };
 const header = ["United Kingdom", "Service", "Delivery", "Estimate", "*", "Tracking Available?", "Cost"];
 if (tokens.slice(0, header.length).join("|") !== header.join("|")) return { kind: "unknown", reason: "delivery-rule-changed" };
 const rows = tokens.flatMap((token, index) => token === "Royal Mail 1st Class" ? [index] : []);
 const [row] = rows;
 if (rows.length !== 1 || row === undefined || tokens[row + 1] !== "1–2 days" || tokens[row + 2] !== "Yes") return { kind: "unknown", reason: "delivery-rule-changed" };
 const price = tokens[row + 3]?.match(/^£(\d{1,3})\.(\d{2})$/);
 if (!price || tokens[row + 4] !== "DHL Express") return { kind: "unknown", reason: "delivery-rule-changed" };
 return { kind: "ok", pence: Number(price[1]) * 100 + Number(price[2]) };
}
