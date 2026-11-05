import { withDatabase } from "./durable-database.mjs";
import { cardFixture } from "./card-fixture.mjs";
await withDatabase(async url=>{const fixture=await cardFixture(url);console.log(JSON.stringify({url:fixture.url}));try{await new Promise(resolve=>{process.once("SIGTERM",resolve);process.once("SIGINT",resolve);});}finally{await fixture.close();}});
