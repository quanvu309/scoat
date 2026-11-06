export async function postWatchForm(page, values) {
 const response = page.waitForResponse(reply => reply.request().isNavigationRequest() && reply.request().method() === "POST" && new URL(reply.url()).pathname === "/account/watch");
 const loaded = page.waitForEvent("domcontentloaded");
 await page.evaluate(entries => {
  const form = document.createElement("form");
  form.method = "post";
  form.action = "/account/watch";
  for (const [name, value] of entries) {
   const input = document.createElement("input");
   input.type = "hidden"; input.name = name; input.value = value; form.append(input);
  }
  document.body.append(form);
  form.submit();
 }, values);
 await Promise.all([response, loaded]);
 return page.locator("body").innerText();
}
