const INFO_STATES = Object.freeze(["closed", "privacy", "terms"]);

const infoCopy = Object.freeze({
  privacy: Object.freeze({
    title: "Privacy",
    body: Object.freeze([
      "This landing page sets no cookies, runs no analytics or trackers and has no forms asking for personal details.",
      "The page and its fonts are served through Cloudflare, which processes standard request data such as IP addresses to deliver them.",
      "Sign up and Log in take you to Scoat’s account pages, hosted by Clerk, where your email address is used for authentication.",
    ]),
  }),
  terms: Object.freeze({
    title: "Terms",
    body: Object.freeze([
      "The receipt shown is an illustrative example, not a live price or offer.",
      "You can create an account or sign in with email through Scoat’s account pages. No purchase is made on this landing page.",
    ]),
  }),
});

function createDialogController(dialog, states, copy) {
  const title = dialog.querySelector(".sheet-title");
  const body = dialog.querySelector(".sheet-body");
  let state = "closed";

  const set = (next) => {
    if (!states.includes(next)) throw new Error(`Unknown dialog state: ${next}`);
    state = next;
    dialog.dataset.state = next;
    if (next === "closed") {
      if (dialog.open) dialog.close();
      return;
    }
    const content = copy[next];
    title.textContent = content.title;
    body.replaceChildren(
      ...content.body.map((text) => {
        const paragraph = document.createElement("p");
        paragraph.textContent = text;
        return paragraph;
      }),
    );
    if (!dialog.open) dialog.showModal();
  };

  dialog.addEventListener("close", () => {
    state = "closed";
    dialog.dataset.state = "closed";
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog || event.target.closest("[data-close]")) set("closed");
  });

  return { set, get state() { return state; } };
}

function init() {
  const infoDialog = document.getElementById("info-dialog");

  const info = createDialogController(infoDialog, INFO_STATES, infoCopy);

  document.addEventListener("click", (event) => {
    const infoTrigger = event.target.closest("[data-info]");
    if (infoTrigger) info.set(infoTrigger.dataset.info);
  });
}

init();
