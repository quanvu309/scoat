const choices = [...document.querySelectorAll("[data-host]")];
const panels = [...document.querySelectorAll("[data-host-panel]")];
const picker = document.querySelector("[data-host-picker]");

function selectHost(id) {
  const selected = choices.find(choice => choice.dataset.host === id) ?? choices[0];
  for (const choice of choices) {
    const active = choice === selected;
    choice.setAttribute("aria-selected", String(active));
    choice.tabIndex = active ? 0 : -1;
  }
  for (const panel of panels) panel.hidden = panel.id !== selected.dataset.host;
}

picker.setAttribute("role", "tablist");
for (const choice of choices) {
  choice.setAttribute("role", "tab");
  choice.setAttribute("aria-controls", choice.dataset.host);
  choice.addEventListener("click", event => {
    event.preventDefault();
    history.replaceState(null, "", choice.hash);
    selectHost(choice.dataset.host);
  });
  choice.addEventListener("keydown", event => {
    const current = choices.indexOf(choice);
    const next = { ArrowRight: (current + 1) % choices.length, ArrowLeft: (current + choices.length - 1) % choices.length, Home: 0, End: choices.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    choices[next].focus();
    choices[next].click();
  });
}
for (const panel of panels) {
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", `choose-${panel.id}`);
  panel.tabIndex = 0;
}
selectHost(location.hash.slice(1));
addEventListener("hashchange", () => selectHost(location.hash.slice(1)));

for (const button of document.querySelectorAll("[data-copy]")) {
  button.hidden = false;
  button.addEventListener("click", async () => {
    const field = document.getElementById(button.dataset.copy);
    const status = document.getElementById(`${button.dataset.copy}-status`);
    try {
      await navigator.clipboard.writeText(field.value);
      status.textContent = button.dataset.copy === "server-url" ? "Connection URL copied." : "First prompt copied.";
    } catch {
      field.focus();
      field.select();
      status.textContent = "Text selected. Use your device’s Copy command.";
    }
  });
}
