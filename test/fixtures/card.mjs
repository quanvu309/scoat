import { fixture, viewArgs, offer, gbp } from "./hunt.mjs";
import { renderView, priceQuotes } from "../../dist/hunt/index.js";
import { ControlCodec } from "../../dist/controls/codec.js";
export function cardSnapshot() {
 const inputs=fixture();
 const long="SYNTHETIC very long independent seller name for a narrow card "+"International ".repeat(8);
 const unknown=offer("unknown-delivery-price","price",{seller:long,amount:gbp(5500)});
 const quotes=priceQuotes({...inputs,offers:[...inputs.offers,unknown]});
 const args=viewArgs(quotes);
 args.rows[0].slots[0].completion={kind:"pending"};
 const view=renderView({...args,offers:[...inputs.offers,unknown]});
 const codec=new ControlCodec({version:1,keyId:"card-fixture",secret:"a".repeat(64)});
 return {ok:true,value:{view},controls:codec.links("https://scoat.example.com",{account:"synthetic",incarnation:"00000000-0000-4000-8000-000000000001"},view)};
}
