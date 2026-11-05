const ACCESS_STATES = Object.freeze(["closed", "signup", "login"]);
const INFO_STATES = Object.freeze(["closed", "privacy", "terms"]);

const accessCopy = Object.freeze({
  signup: Object.freeze({
    title: "Sign up opens soon",
    body: Object.freeze([
      "Scoat is getting ready for early access. Accounts are not open yet, so there is nothing to fill in and this page does not ask for your email.",
      "Follow the project on GitHub to see how it is coming along.",
    ]),
  }),
  login: Object.freeze({
    title: "Log in opens soon",
    body: Object.freeze([
      "Accounts are not open yet, so there is nothing to log in to. Early access is being prepared.",
      "Follow the project on GitHub to see how it is coming along.",
    ]),
  }),
});

const infoCopy = Object.freeze({
  privacy: Object.freeze({
    title: "Privacy",
    body: Object.freeze([
      "This preview page sets no cookies, runs no analytics or trackers and has no forms asking for personal details.",
      "The page and its fonts are served through Cloudflare, which processes standard request data such as IP addresses to deliver them.",
    ]),
  }),
  terms: Object.freeze({
    title: "Terms",
    body: Object.freeze([
      "This page is an early preview of Scoat. The receipt shown is an illustrative example, not a live price or offer.",
      "No service is offered on this page yet: nothing is sold and no accounts can be created.",
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
  const accessDialog = document.getElementById("access-dialog");
  const infoDialog = document.getElementById("info-dialog");

  const access = createDialogController(accessDialog, ACCESS_STATES, accessCopy);
  const info = createDialogController(infoDialog, INFO_STATES, infoCopy);

  document.addEventListener("click", (event) => {
    const accessTrigger = event.target.closest("[data-access]");
    if (accessTrigger) {
      access.set(accessTrigger.dataset.access);
      return;
    }
    const infoTrigger = event.target.closest("[data-info]");
    if (infoTrigger) info.set(infoTrigger.dataset.info);
  });
}

init();
