const REPOSITORY_URL = "https://github.com/quanvu309/scoat";

const exampleReceipt = Object.freeze({
  kind: "example",
  caption: "Example receipt for illustration. Not a live price or offer.",
  title: "Nike trainers, size 6",
  progress: Object.freeze({ checked: 8, total: 8 }),
  currency: "GBP",
  lines: Object.freeze([
    Object.freeze({ label: "Shop price", amountMinor: 7000, tone: "price" }),
    Object.freeze({ label: "Student 10%, verify first", amountMinor: -700, tone: "discount" }),
  ]),
});

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

function formatMoney(amountMinor, currency, wholeUnits) {
  const formatter = new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: wholeUnits ? 0 : 2,
    maximumFractionDigits: wholeUnits ? 0 : 2,
  });
  return formatter.format(amountMinor / 100);
}

function receiptTotals(receipt) {
  const total = receipt.lines.reduce((sum, line) => sum + line.amountMinor, 0);
  const saved = receipt.lines.reduce((sum, line) => (line.amountMinor < 0 ? sum - line.amountMinor : sum), 0);
  return { total, saved };
}

function renderReceipt(root, receipt) {
  const slot = (name) => root.querySelector(`[data-receipt="${name}"]`);
  const { total, saved } = receiptTotals(receipt);
  slot("progress").textContent = `${receipt.progress.checked} of ${receipt.progress.total}`;
  slot("progress").setAttribute("aria-label", `${receipt.progress.checked} of ${receipt.progress.total} checked`);
  slot("title").textContent = receipt.title;
  slot("lines").replaceChildren(
    ...receipt.lines.map((line) => {
      const row = document.createElement("div");
      row.className = "receipt-line";
      row.dataset.tone = line.tone;
      const term = document.createElement("dt");
      term.textContent = line.label;
      const value = document.createElement("dd");
      value.textContent = formatMoney(line.amountMinor, receipt.currency, false);
      row.append(term, value);
      return row;
    }),
  );
  slot("total").textContent = formatMoney(total, receipt.currency, false);
  slot("saved").textContent = formatMoney(saved, receipt.currency, true);
  slot("caption").textContent = receipt.caption;
  root.dataset.kind = receipt.kind;
}

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
  const showcase = document.querySelector(".showcase");
  if (showcase) renderReceipt(showcase, exampleReceipt);

  const accessDialog = document.getElementById("access-dialog");
  const infoDialog = document.getElementById("info-dialog");
  accessDialog.querySelector("a[href]").href = REPOSITORY_URL;

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
