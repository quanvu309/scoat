import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { execFileSync } from "node:child_process";
import { openCardLink } from "../scripts/story-lanes.mjs";

const exercise = async capture => {
 const harness = { opened: ["https://issuer.example/previous"] };
 let delivered;
 const message = new Promise(resolve => { delivered = resolve; });
 const evaluate = (fn, arg) => runInNewContext("(" + fn.toString() + ")(arg)", { window: { harness }, arg });
 const page = {
  async evaluate(fn, arg) { return evaluate(fn, arg); },
  async waitForFunction(fn, arg) { await message; assert.equal(evaluate(fn, arg), true); },
 };
 const button = { async click() { setImmediate(() => { harness.opened.push("https://issuer.example/new"); delivered(); }); } };
 const result = await capture(page, button);
 await message;
 return result;
};

test("card clicks return the newly delivered link when the host message arrives later", async () => {
 assert.equal(await exercise(openCardLink), "https://issuer.example/new");
 const source = execFileSync("git", ["show", "655c490:scripts/story-lanes.mjs"], { encoding: "utf8" });
 const expression = /const opened = (async \(\) => .*);/.exec(source)?.[1];
 assert.ok(expression);
 const oldCapture = async (page, button) => { await button.click(); return runInNewContext("(" + expression + ")()", { page }); };
 assert.equal(await exercise(oldCapture), "https://issuer.example/previous");
 assert.notEqual(await exercise(oldCapture), "https://issuer.example/new");
});
