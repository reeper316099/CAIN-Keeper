/* Blasphemy Library page: edit the 12 (or more) shared entries. Autosaves
   the whole library document to PUT /api/library. */
(async function () {
  "use strict";
  const lib = await CK.api("GET", "/api/library");
  const saver = CK.makeSaver(() => CK.api("PUT", "/api/library", lib));
  const root = document.getElementById("entries");
  const save = () => saver.schedule();

  function powerRow(ei, pi, p) {
    return `<div class="power" data-power="${pi}">
      <div class="head">
        <input type="text" placeholder="Power name" data-bind="entries.${ei}.powers.${pi}.name">
        <input type="text" placeholder="Tags (e.g. Instant, Short)" data-bind="entries.${ei}.powers.${pi}.tags">
        <span></span>
        <button class="btn btn-xs btn-ghost btn-danger" data-rm-power="${ei}:${pi}" title="Remove power">✕</button>
      </div>
      <textarea placeholder="Description" data-bind="entries.${ei}.powers.${pi}.description"></textarea>
    </div>`;
  }

  function render() {
    root.innerHTML = lib.entries.map((e, i) => `<div class="card stack" data-entry="${i}">
      <div class="row between">
        <input type="text" placeholder="Blasphemy name" data-bind="entries.${i}.name" style="flex:1;font-weight:600;font-size:15px">
        <button class="btn btn-xs btn-ghost btn-danger" data-rm-entry="${i}" title="Remove entry">✕</button>
      </div>
      <label class="field"><span>Description</span><textarea data-bind="entries.${i}.description" placeholder="Describe the registered psychic phenomena"></textarea></label>
      <div class="field"><span>Passive</span>
        <input type="text" placeholder="Passive name" data-bind="entries.${i}.passive.name">
        <textarea placeholder="Passive description" data-bind="entries.${i}.passive.description"></textarea>
        <label class="check"><input type="checkbox" data-bind="entries.${i}.passive.track_enabled"> Passive has a 3-segment fill track</label>
      </div>
      <div class="field"><span>Powers (${e.powers.length})</span>
        <div class="stack" data-powers="${i}">${e.powers.map((p, pi) => powerRow(i, pi, p)).join("")}</div>
        <div><button class="btn btn-sm" data-add-power="${i}">+ Add power</button></div>
      </div>
    </div>`).join("");
    CK.bind(root, lib, save);
    root.querySelectorAll("[data-add-power]").forEach(b => b.addEventListener("click", () => {
      lib.entries[b.dataset.addPower].powers.push({ name: "", tags: "", description: "" }); save(); render();
    }));
    root.querySelectorAll("[data-rm-power]").forEach(b => b.addEventListener("click", () => {
      const [ei, pi] = b.dataset.rmPower.split(":").map(Number);
      lib.entries[ei].powers.splice(pi, 1); save(); render();
    }));
    root.querySelectorAll("[data-rm-entry]").forEach(b => b.addEventListener("click", async () => {
      const e = lib.entries[b.dataset.rmEntry];
      if (!await CK.confirmDialog(`Remove "${e.name || "this entry"}" from the library?`)) return;
      lib.entries.splice(Number(b.dataset.rmEntry), 1); save(); render();
    }));
  }

  document.getElementById("add-entry").addEventListener("click", () => {
    lib.entries.push({ id: Math.random().toString(36).slice(2, 10), name: `Blasphemy ${lib.entries.length + 1}`,
      description: "", passive: { name: "", description: "", track_enabled: false }, powers: [] });
    save(); render();
  });
  render();
})();
