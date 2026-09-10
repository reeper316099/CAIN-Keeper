/* ==========================================================================
   sin.js - renders and autosaves one sin sheet (Recorded Manifestation).

   Execution threshold = 8 + campaign Pressure + Sin CAT (category I-VII =
   1-7). Pressure is read from the campaign's mission tracker on load.
   ========================================================================== */
(async function () {
  "use strict";
  const cid = CK.campaignId, sid = window.SIN_ID;
  const $ = id => document.getElementById(id);
  const sheet = $("sheet");
  const ROMAN = ["0", "I", "II", "III", "IV", "V", "VI", "VII"];

  const [sin, mission] = await Promise.all([
    CK.api("GET", `/api/campaigns/${cid}/sins/${sid}`),
    CK.api("GET", `/api/campaigns/${cid}/mission`),
  ]);
  const saver = CK.makeSaver(() => CK.api("PUT", `/api/campaigns/${cid}/sins/${sid}`, sin));
  function save() { saver.schedule(); renderExecution(); }
  const rollerName = () => sin.name || "Sin";
  const threshold = () => 8 + (mission.pressure || 0) + (sin.category || 0);

  CK.bind(sheet, sin, () => {
    save();
    $("sheet-title").textContent = sin.name || "Recorded Manifestation";
    renderTraumas(false);
  });
  $("use-as-roller").addEventListener("click", () => { Dice.setRoller(rollerName()); Dice.open(); });

  /* ---------- Vital card pickers --------------------------------------- */
  function renderPickers() {
    const fp = $("form-picker");
    fp.innerHTML = ["I", "II", "III"].map(f => `<button class="btn btn-sm ${sin.form === f ? "active" : ""}" data-form="${f}">${f}</button>`).join("");
    fp.querySelectorAll("[data-form]").forEach(b => b.addEventListener("click", () => { sin.form = b.dataset.form; save(); renderPickers(); }));
    const cp = $("cat-picker");
    cp.innerHTML = [1, 2, 3, 4, 5, 6, 7].map(n => `<button class="btn btn-sm ${sin.category === n ? "active" : ""}" data-cat="${n}" title="CAT ${n}">${ROMAN[n]}</button>`).join("");
    cp.querySelectorAll("[data-cat]").forEach(b => b.addEventListener("click", () => { sin.category = Number(b.dataset.cat); save(); renderPickers(); }));
  }

  /* ---------- Traumas ---------------------------------------------------- */
  function renderTraumas(rebuild = true) {
    const root = $("traumas");
    if (rebuild) {
      root.innerHTML = sin.traumas.map((t, i) => `<div class="row">
        <span class="mono muted">${i + 1}.</span>
        <input type="text" data-bind="traumas.${i}" placeholder="Trauma ${i + 1}" style="flex:1;min-width:160px">
        <button class="btn btn-xs" data-trauma="${i}" title="Reduce stress 1d3 / inflict 1d3 slashes">Use trauma</button></div>`).join("");
      CK.bind(root, sin, () => { save(); renderTraumas(false); });
      root.querySelectorAll("[data-trauma]").forEach(b => b.addEventListener("click", async () => {
        const i = Number(b.dataset.trauma);
        const r = await Dice.roll("trauma", { label: `Trauma: ${sin.traumas[i] || "#" + (i + 1)}` }, { roller: Dice.getRoller(), source: "trauma" });
        const box = $("trauma-result");
        box.hidden = false;
        box.innerHTML = `Reduce one target's stress by <b>${r.stress_reduced}</b>; inflict <b>${r.slashes}</b> slash${r.slashes === 1 ? "" : "es"} on the sin.
          <button class="btn btn-xs" id="apply-slashes">Apply ${r.slashes} slash${r.slashes === 1 ? "" : "es"} to execution</button>`;
        $("apply-slashes").addEventListener("click", () => { sin.execution.slashes = Math.min(threshold(), sin.execution.slashes + r.slashes); save(); box.hidden = true; });
      }));
    }
    root.querySelectorAll("[data-trauma]").forEach(b => { b.disabled = !sin.traumas[b.dataset.trauma].trim(); });
    renderResolution();
  }

  /* ---------- Execution ------------------------------------------------- */
  function renderExecution() {
    const t = threshold();
    CK.pips($("execution"), { count: t, value: sin.execution.slashes, kind: "seg", onChange: v => { sin.execution.slashes = v; save(); } });
    $("execution-count").textContent = `${Math.min(sin.execution.slashes, t)} / ${t}`;
    $("threshold-note").textContent = `8 + pressure ${mission.pressure || 0} + CAT ${sin.category} = ${t}`;
    $("retreat-note").hidden = !(sin.execution.slashes >= 4 && sin.execution.slashes < t);
    $("execution-full").hidden = sin.execution.slashes < t;
    $("heal-2d3").disabled = sin.execution.slashes < t;
  }
  $("slash-1").addEventListener("click", () => { sin.execution.slashes = Math.min(threshold(), sin.execution.slashes + 1); save(); });
  async function heal(expr) {
    const r = await Dice.roll("simple", { expression: expr, label: `${rollerName()} heals` }, { roller: rollerName() });
    sin.execution.slashes = Math.max(0, sin.execution.slashes - r.total); save();
    CK.toast(`Healed ${r.total} slash${r.total === 1 ? "" : "es"}`);
  }
  $("heal-1d3").addEventListener("click", () => heal("1d3"));
  $("heal-2d3").addEventListener("click", () => heal("2d3"));

  function renderResolution() {
    const hasTrauma = sin.traumas.some(t => t.trim());
    const root = $("resolution");
    root.innerHTML = [["executed", "Execute"], ["failed", "Fail"], ["spared", "Spare"]].map(([k, l]) =>
      `<button class="btn btn-sm ${sin.resolution === k ? "active" : ""}" data-res="${k}" ${k === "spared" && !hasTrauma ? "disabled" : ""}>${l}</button>`).join("")
      + `<button class="btn btn-sm btn-ghost" data-res="">Unresolved</button>`;
    root.querySelectorAll("[data-res]").forEach(b => b.addEventListener("click", () => {
      sin.resolution = b.dataset.res || null;
      if (sin.resolution === "executed" && !sin.executed_date) { sin.executed_date = new Date().toISOString().slice(0, 10); CK.bind(sheet, sin); }
      save(); renderResolution();
    }));
  }

  /* ---------- Extra tracks ---------------------------------------------- */
  function renderTracks() {
    const root = $("tracks");
    root.innerHTML = sin.tracks.map((t, i) => `<div class="talisman">
      <div class="head"><input type="text" data-bind="tracks.${i}.name" placeholder="Track ${i + 1}">
        <input type="number" min="1" max="12" data-bind="tracks.${i}.length" title="Length"><span></span></div>
      <div data-track="${i}"></div></div>`).join("");
    CK.bind(root, sin, path => { save(); if (path.endsWith(".length")) renderTracks(); });
    root.querySelectorAll("[data-track]").forEach(el => {
      const i = Number(el.dataset.track);
      CK.pips(el, { count: sin.tracks[i].length, value: sin.tracks[i].fill, kind: "seg", onChange: v => { sin.tracks[i].fill = v; save(); renderTracks(); } });
    });
  }

  /* ---------- Reaction die wiring -------------------------------------- */
  const TABLES = {
    attack: { label: "Attack", tiers: { "1": "5 stress (severe attack usable)", "2-3": "3 stress", "4-6": "2 stress" } },
    complicate: { label: "Complicate", tiers: { "1": "6 talisman complication", "2-3": "4 talisman complication", "4-6": "2 action complication" } },
    threaten: { label: "Threaten", tiers: { "1": "1 injury", "2-3": "5 stress", "4-6": "3 stress" } },
    improvise: { label: "Improvise", tiers: { "1": "Strongest reaction", "2-3": "Strong reaction", "4-6": "Weaker (6 = weakest) reaction" } },
  };
  sheet.querySelectorAll("[data-react]").forEach(b => b.addEventListener("click", async () => {
    const t = TABLES[b.dataset.react];
    Dice.setTiers(t.tiers, t.label);
    Dice.open();
    const r = await Dice.roll("risk", { tiers: t.tiers, label: t.label }, { roller: rollerName(), source: "reaction" });
    if (r.natural_one) CK.toast(`Rolled a 1: severe attack available (once a scene)${sin.severe_attack ? ": " + sin.severe_attack : ""}`, "error");
  }));

  renderPickers(); renderTraumas(); renderExecution(); renderTracks();
  Dice.setRoller(rollerName());
})();
