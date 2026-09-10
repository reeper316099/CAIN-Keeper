/* ==========================================================================
   exorcist.js - renders and autosaves one exorcist sheet.

   Flow: GET the exorcist JSON -> keep it in `ex` -> every edit mutates `ex`
   and calls save() (debounced PUT of the whole document).

   Derived values (never stored, always recomputed from `ex`):
     CAT          suggested from missions survived unless overridden
     psyche max   ceil(CAT / 2)
     execution    6 - active injuries (brink-of-death counts as an injury)
     sin cap      10 printed boxes - crossed out - (extra blasphemies)
     XP to advance base (8) + extra blasphemies
   ========================================================================== */
(async function () {
  "use strict";

  const cid = CK.campaignId;
  const eid = window.EXORCIST_ID;
  const $ = id => document.getElementById(id);
  const sheet = $("sheet");

  const [ex, ref, library] = await Promise.all([
    CK.api("GET", `/api/campaigns/${cid}/exorcists/${eid}`),
    CK.reference(),
    CK.api("GET", "/api/library"),
  ]);

  const saver = CK.makeSaver(() => CK.api("PUT", `/api/campaigns/${cid}/exorcists/${eid}`, ex));
  /** Persist + refresh all derived displays. Call after any mutation. */
  function save() { saver.schedule(); renderDerived(); }

  /* ---------- Derived values ------------------------------------------- */
  const suggestCat = missions => ref.cat_thresholds.filter(t => missions >= t).length;
  function derive() {
    const cat = ex.cat.override ? CK.clamp(ex.cat.value, 0, 5) : suggestCat(ex.cat.missions_survived);
    const injuries = ex.injuries.filter(i => i.active).length + (ex.brink.active ? 1 : 0);
    const extraBlasphemies = Math.max(0, ex.blasphemies.length - 1);
    return {
      cat,
      psycheMax: Math.ceil(cat / 2),
      injuries,
      execMax: Math.max(0, ex.execution.base_max - injuries),
      extraBlasphemies,
      sinCap: Math.max(0, ex.sin_track.base_cap - ex.sin_track.crossed_out - extraBlasphemies),
      xpMax: Math.max(1, ex.advancement.xp_base_max + extraBlasphemies),
      sinMarks: ex.sin_marks.filter(m => m.gained).length,
      skillsAtCap: Object.values(ex.skills).filter(v => v >= 3).length,
    };
  }

  /* ---------- Static bindings (inputs that never re-render) ------------- */
  CK.bind(sheet, ex, () => {
    save();
    $("sheet-title").textContent = ex.identity.name || "Registered Exorcist";
    document.title = `${ex.identity.name || "Exorcist"} · ${CK.campaignName}`;
  });

  $("use-as-roller").addEventListener("click", () => { Dice.setRoller(ex.identity.name || "Exorcist"); Dice.open(); CK.toast(`Rolling as ${ex.identity.name || "Exorcist"}`); });

  /* ---------- Photo ------------------------------------------------------ */
  function renderPhoto() {
    const p = ex.identity.photo;
    $("photo").innerHTML = p ? `<img src="/uploads/${cid}/${CK.esc(p)}?t=${Date.now()}" alt="ID photo">` : "Click to add<br>ID photo";
    $("photo-remove").hidden = !p;
  }
  $("photo").addEventListener("click", () => $("photo-input").click());
  $("photo-input").addEventListener("change", async () => {
    const file = $("photo-input").files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    const r = await CK.api("POST", `/api/campaigns/${cid}/exorcists/${eid}/photo`, fd);
    ex.identity.photo = r.photo;
    renderPhoto();
    CK.toast("Photo uploaded", "ok");
  });
  $("photo-remove").addEventListener("click", async () => {
    await CK.api("DELETE", `/api/campaigns/${cid}/exorcists/${eid}/photo`);
    ex.identity.photo = null;
    renderPhoto();
  });

  /* ---------- CAT / Psyche / Burst -------------------------------------- */
  function renderCat() {
    const d = derive();
    $("cat-badge").innerHTML = `${d.cat}<small>CAT</small>`;
    $("cat-suggested").textContent = suggestCat(ex.cat.missions_survived);
    const picker = $("cat-picker");
    picker.innerHTML = [0, 1, 2, 3, 4, 5].map(n => `<button class="btn btn-sm ${d.cat === n ? "active" : ""}" data-cat="${n}" ${ex.cat.override ? "" : "disabled"}>${n}</button>`).join("");
    picker.querySelectorAll("[data-cat]").forEach(b => b.addEventListener("click", () => { ex.cat.value = Number(b.dataset.cat); save(); }));
    CK.pips($("psyche"), { count: Math.max(d.psycheMax, 0), value: ex.psyche.current, size: "lg",
      onChange: v => { ex.psyche.current = v; save(); } });
    $("psyche-count").textContent = `${CK.clamp(ex.psyche.current, 0, d.psycheMax)} / ${d.psycheMax}`;
    CK.pips($("burst"), { count: 3, value: ex.burst.marked, size: "lg", onChange: v => { ex.burst.marked = v; save(); } });
    $("burst-count").textContent = `${ex.burst.marked} marked`;
  }
  $("roll-psyche").addEventListener("click", () => {
    Dice.setRoller(ex.identity.name || "Exorcist");
    Dice.setPool({ skill: derive().psycheMax, bonus: 0, hard: false, risky: false, label: "Psyche" });
    Dice.open();
  });
  $("burst-spend").addEventListener("click", () => {
    if (ex.burst.marked >= 3) { CK.toast("All three burst pips are already marked. Rest to recover.", "error"); return; }
    ex.burst.marked += 1; save();
    CK.toast("Burst marked: use your powers or gain +1D");
  });
  $("burst-sin").addEventListener("click", async () => {
    const r = await Dice.roll("simple", { expression: "1d3", label: "Burst → sin" }, { roller: ex.identity.name || "Exorcist", source: "burst-sin" });
    ex.sin_track.current += r.total;
    save();
    CK.toast(`Gained ${r.total} sin instead of marking burst`);
  });

  /* ---------- Execution / Sin ------------------------------------------- */
  function renderExecution() {
    const d = derive();
    CK.pips($("execution"), { count: ex.execution.base_max, dead: d.injuries, value: ex.execution.current, kind: "seg", size: "tall",
      onChange: v => { ex.execution.current = v; save(); } });
    $("execution-count").textContent = `${CK.clamp(ex.execution.current, 0, d.execMax)} / ${d.execMax}`;
    $("execution-full").hidden = !(d.execMax > 0 && ex.execution.current >= d.execMax);
  }
  function renderSin() {
    const d = derive();
    CK.pips($("sin-track"), { count: ex.sin_track.base_cap, dead: ex.sin_track.base_cap - d.sinCap, value: ex.sin_track.current, size: "lg",
      onChange: v => { ex.sin_track.current = v; save(); } });
    const cur = CK.clamp(ex.sin_track.current, 0, d.sinCap);
    $("sin-count").textContent = `${cur} / ${d.sinCap}`;
    $("sin-cap-note").textContent = d.extraBlasphemies ? `(${d.extraBlasphemies} box${d.extraBlasphemies > 1 ? "es" : ""} crossed out by extra blasphemies)` : "";
    $("sin-overflow").hidden = !(d.sinCap > 0 && ex.sin_track.current >= d.sinCap);
    Dice.setMarks(d.sinMarks);
  }
  /* Sin mark slots hold text inputs, so they are rendered separately from
     renderSin() (which runs after every save) to avoid stealing focus. */
  function renderSinMarks() {
    const marks = $("sin-marks");
    marks.innerHTML = ex.sin_marks.map((m, i) => `<div class="card" style="background:var(--bg);padding:10px">
      <label class="check" style="margin-bottom:6px"><input type="checkbox" data-bind="sin_marks.${i}.gained"> Sin mark ${i + 1}</label>
      <textarea data-bind="sin_marks.${i}.text" placeholder="Evolve with an advance"></textarea>
    </div>`).join("");
    CK.bind(marks, ex, save);
  }
  $("roll-resist").addEventListener("click", async () => {
    const d = derive();
    const r = await Dice.roll("resistance", { sin_marks: d.sinMarks, label: "Sin resistance" }, { roller: ex.identity.name || "Exorcist", source: "resist" });
    if (!r.success) { CK.toast("Resistance failed: give up.", "error"); return; }
    if (!await CK.confirmDialog(`Kept control (${r.total}). Apply: gain a sin mark, clear all sin, cross out two boxes?`)) return;
    const free = ex.sin_marks.find(m => !m.gained);
    if (free) free.gained = true; else CK.toast("All three sin marks already gained", "error");
    ex.sin_track.current = 0;
    ex.sin_track.crossed_out += 2;
    save();
    CK.bind(sheet, ex);  // refresh the crossed-out input
    renderAll();
  });

  /* ---------- Skills ----------------------------------------------------- */
  function renderSkills() {
    const d = derive();
    const root = $("skills");
    root.innerHTML = ref.skills.map(s => `<div class="skill-row">
      <span class="sk">${s}</span><div data-skill="${s}"></div>
      <button class="btn btn-xs" data-roll-skill="${s}">Roll</button></div>`).join("");
    root.querySelectorAll("[data-skill]").forEach(el => {
      const s = el.dataset.skill;
      CK.pips(el, { count: 3, value: ex.skills[s], onChange: v => {
        if (v === 3 && ex.skills[s] < 3 && d.skillsAtCap >= 2) { CK.toast("Only two skills may be at 3.", "error"); return; }
        ex.skills[s] = v; save(); renderSkills();
      } });
    });
    root.querySelectorAll("[data-roll-skill]").forEach(b => b.addEventListener("click", () => {
      const s = b.dataset.rollSkill;
      Dice.setRoller(ex.identity.name || "Exorcist");
      Dice.setPool({ skill: ex.skills[s], bonus: 0, hard: false, risky: false, label: s[0].toUpperCase() + s.slice(1) });
      Dice.open();
    }));
    $("skills-cap").textContent = `${d.skillsAtCap} / 2 skills at 3`;
    CK.pips($("improvements"), { count: 6, value: ex.improvements, onChange: v => { ex.improvements = v; save(); renderSkills(); } });
    $("improvements-count").textContent = `${ex.improvements} / 6`;
  }

  /* ---------- Health ----------------------------------------------------- */
  function renderHealth() {
    const inj = $("injuries");
    inj.innerHTML = ex.injuries.map((it, i) => `<div class="row">
      <input type="checkbox" data-bind="injuries.${i}.active" title="Injury ${i + 1} active">
      <input type="text" data-bind="injuries.${i}.text" placeholder="Injury ${i + 1}" style="flex:1"></div>`).join("");
    CK.bind(inj, ex, () => { save(); renderExecution(); });
    const brink = $("brink");
    if (ex.visitation_rights) {
      brink.innerHTML = `<div class="row"><input type="checkbox" data-bind="brink.active" title="Brink of death">
        <input type="text" data-bind="brink.text" placeholder="Brink of death · any more harm will cause instant death" style="flex:1"></div>`;
      CK.bind(brink, ex, () => { save(); renderExecution(); });
    } else {
      brink.innerHTML = `<div class="hint">4th injury box locked · gain it if visitation rights have been acquired.</div>`;
      if (ex.brink.active) { ex.brink.active = false; save(); }
    }
    const hooks = $("hooks");
    hooks.innerHTML = ex.hooks.map((h, i) => `<div class="row">
      <input type="text" data-bind="hooks.${i}.name" placeholder="Name hook ${i + 1}" style="flex:1;min-width:140px">
      <div data-hook="${i}"></div>
      <span class="track-full" data-hook-full="${i}" hidden>FULL: erase &amp; resolve</span></div>`).join("");
    CK.bind(hooks, ex, save);
    hooks.querySelectorAll("[data-hook]").forEach(el => {
      const i = Number(el.dataset.hook);
      CK.pips(el, { count: 3, value: ex.hooks[i].fill, kind: "seg", onChange: v => { ex.hooks[i].fill = v; save(); renderHealth(); } });
      hooks.querySelector(`[data-hook-full="${i}"]`).hidden = ex.hooks[i].fill < 3;
    });
    CK.pips($("pathos"), { count: 3, value: ex.pathos, onChange: v => { ex.pathos = v; save(); } });
  }
  sheet.querySelector('[data-bind="visitation_rights"]').addEventListener("change", renderHealth);

  /* ---------- Advancement ------------------------------------------------ */
  function renderAdvancement() {
    const d = derive();
    CK.pips($("xp"), { count: d.xpMax, value: ex.advancement.xp, dashedFrom: 4, onChange: v => { ex.advancement.xp = v; save(); } });
    $("xp-count").textContent = `${ex.advancement.xp} / ${d.xpMax}`;
    $("xp-note").textContent = d.extraBlasphemies ? `+${d.extraBlasphemies} from extra blasphemies = ${d.xpMax}` : "";
    CK.pips($("advances"), { count: 3, value: ex.advancement.advances, size: "lg", onChange: v => { ex.advancement.advances = v; save(); } });
  }
  function cashAdvances() {
    const d = derive();
    let cashed = 0;
    while (ex.advancement.xp >= d.xpMax) {
      ex.advancement.xp -= d.xpMax;
      if (ex.advancement.advances < 3) { ex.advancement.advances += 1; cashed++; }
      else CK.toast("Advances are full (3). Spend one before cashing more.", "error");
    }
    return cashed;
  }
  $("cash-advance").addEventListener("click", () => {
    const n = cashAdvances();
    CK.toast(n ? `Cashed ${n} advance${n > 1 ? "s" : ""}` : "XP track isn't full yet");
    save(); renderAdvancement();
  });
  $("end-session").addEventListener("click", () => {
    const c = ex.advancement.checklist;
    const gained = [c.survived, c.first_agenda, c.bolded_agenda, c.injury_or_affliction].filter(Boolean).length;
    ex.advancement.xp += gained;
    const cashed = cashAdvances();
    Object.keys(c).forEach(k => c[k] = false);
    ex.pathos = 0;
    save(); CK.bind(sheet, ex); renderAll();
    CK.toast(`+${gained} XP${cashed ? `, cashed ${cashed} advance${cashed > 1 ? "s" : ""}` : ""}. Checklist and pathos cleared.`, "ok");
  });

  /* ---------- Kit -------------------------------------------------------- */
  function renderKit() {
    CK.pips($("kp"), { count: Math.max(0, ex.kit.points_max), value: ex.kit.points_current, dashedFrom: 5, onChange: v => { ex.kit.points_current = v; save(); renderKit(); } });
    $("kp-count").textContent = `${ex.kit.points_current} / ${ex.kit.points_max}`;
    const items = $("kit-items");
    items.innerHTML = ex.kit.items.map((it, i) => `<div class="list-row" style="grid-template-columns: 1fr 64px 1.4fr auto auto">
      <input type="text" data-bind="kit.items.${i}.name" placeholder="Item">
      <input type="number" min="0" data-bind="kit.items.${i}.kp" title="KP cost">
      <input type="text" data-bind="kit.items.${i}.description" placeholder="Description">
      <button class="btn btn-xs" data-use="${i}" title="Spend this item's KP">Pull out</button>
      <button class="btn btn-xs btn-ghost btn-danger rm" data-rm="${i}">✕</button></div>`).join("") || `<div class="hint">No kit items.</div>`;
    CK.bind(items, ex, save);
    items.querySelectorAll("[data-use]").forEach(b => b.addEventListener("click", () => {
      const it = ex.kit.items[b.dataset.use];
      if (ex.kit.points_current < it.kp) { CK.toast("Not enough kit points", "error"); return; }
      ex.kit.points_current -= it.kp; save(); renderKit();
      CK.toast(`Pulled out ${it.name || "item"} (−${it.kp} KP)`);
    }));
    items.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { ex.kit.items.splice(Number(b.dataset.rm), 1); save(); renderKit(); }));
    const log = $("scrip-log");
    log.innerHTML = ex.kit.scrip_log.slice(-8).reverse().map(l => `<div class="hint"><span class="${l.delta >= 0 ? "accent" : ""}">${l.delta >= 0 ? "+" : ""}${l.delta}</span> ${CK.esc(l.note)} <span class="muted">· ${CK.fmtTime(l.ts)}</span></div>`).join("");
  }
  $("kit-add").addEventListener("click", () => { ex.kit.items.push({ name: "", kp: 1, description: "" }); save(); renderKit(); });
  $("kp-refill").addEventListener("click", () => { ex.kit.points_current = ex.kit.points_max; save(); renderKit(); });
  function scrip(sign) {
    const delta = sign * Math.abs(Number($("scrip-delta").value) || 0);
    if (!delta) return;
    ex.kit.scrip += delta;
    ex.kit.scrip_log.push({ ts: new Date().toISOString(), delta, note: $("scrip-note").value.trim() });
    $("scrip-note").value = "";
    save(); CK.bind(sheet, ex); renderKit();
  }
  $("scrip-gain").addEventListener("click", () => scrip(1));
  $("scrip-lose").addEventListener("click", () => scrip(-1));

  /* ---------- Agenda ----------------------------------------------------- */
  function renderAgenda() {
    const items = $("agenda-items");
    items.innerHTML = ex.agenda.items.map((it, i) => `<div class="list-row" style="grid-template-columns: auto 1fr auto">
      <button class="btn btn-xs ${it.bolded ? "active" : ""}" data-bold="${i}" title="Bolded items are kept between missions"><b>B</b></button>
      <input type="text" data-bind="agenda.items.${i}.text" placeholder="Agenda item" style="${it.bolded ? "font-weight:700" : ""}">
      <button class="btn btn-xs btn-ghost btn-danger rm" data-rm="${i}">✕</button></div>`).join("") || `<div class="hint">No agenda items.</div>`;
    CK.bind(items, ex, save);
    items.querySelectorAll("[data-bold]").forEach(b => b.addEventListener("click", () => { const it = ex.agenda.items[b.dataset.bold]; it.bolded = !it.bolded; save(); renderAgenda(); }));
    items.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { ex.agenda.items.splice(Number(b.dataset.rm), 1); save(); renderAgenda(); }));
    const ab = $("agenda-abilities");
    ab.innerHTML = ex.agenda.abilities.map((a, i) => `<div class="power">
      <div class="head" style="grid-template-columns:1fr auto"><input type="text" data-bind="agenda.abilities.${i}.name" placeholder="Ability name">
      <button class="btn btn-xs btn-ghost btn-danger" data-rm="${i}">✕</button></div>
      <textarea data-bind="agenda.abilities.${i}.description" placeholder="Description"></textarea></div>`).join("") || `<div class="hint">No abilities yet.</div>`;
    CK.bind(ab, ex, save);
    ab.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { ex.agenda.abilities.splice(Number(b.dataset.rm), 1); save(); renderAgenda(); }));
    $("ability-add").disabled = ex.agenda.abilities.length >= 5;
  }
  $("agenda-add").addEventListener("click", () => { ex.agenda.items.push({ text: "", bolded: false }); save(); renderAgenda(); });
  $("ability-add").addEventListener("click", () => {
    if (ex.agenda.abilities.length >= 5) { CK.toast("5 abilities max", "error"); return; }
    ex.agenda.abilities.push({ name: "", description: "" }); save(); renderAgenda();
  });

  /* ---------- Blasphemy -------------------------------------------------- */
  function powerHtml(path, p, i, removable) {
    return `<div class="power ${p.known ? "known" : ""}">
      <div class="head">
        <input type="text" data-bind="${path}.${i}.name" placeholder="Power name">
        <input type="text" data-bind="${path}.${i}.tags" placeholder="Tags (Instant, Short…)">
        <label class="check" title="Only 2 starting powers are known"><input type="checkbox" data-bind="${path}.${i}.known"> known</label>
        ${removable ? `<button class="btn btn-xs btn-ghost btn-danger" data-rm-power="${path}:${i}">✕</button>` : "<span></span>"}
      </div>
      <textarea data-bind="${path}.${i}.description" placeholder="Description"></textarea>
    </div>`;
  }
  function renderBlasphemies() {
    const up = $("universal-powers");
    up.innerHTML = ex.universal_powers.map((p, i) => powerHtml("universal_powers", p, i, false)).join("");
    CK.bind(up, ex, save);

    const libOptions = library.entries.map(e => `<option value="${CK.esc(e.name)}"></option>`).join("");
    const root = $("blasphemies");
    root.innerHTML = `<datalist id="lib-names">${libOptions}</datalist>` + ex.blasphemies.map((b, i) => `<div class="card" style="background:var(--bg)">
      <div class="card-head">
        <div class="row" style="flex:1">
          <input type="text" list="lib-names" data-bind="blasphemies.${i}.name" placeholder="Blasphemy name (pick from library or type)" style="flex:1;font-weight:600;font-size:15px;min-width:200px">
          <button class="btn btn-xs" data-import="${i}" title="Copy passive + powers from the library entry with this name">Import from library</button>
        </div>
        <div class="right">${i > 0 ? `<span class="tag">extra · −1 sin box · +1 XP</span>` : `<span class="tag">primary</span>`}
          <button class="btn btn-xs btn-ghost btn-danger" data-rm-blasphemy="${i}">Remove</button></div>
      </div>
      <div class="stack">
        <textarea data-bind="blasphemies.${i}.description" placeholder="Describe registered psychic phenomena."></textarea>
        <div class="field"><span>Passive</span>
          <div class="row"><input type="text" data-bind="blasphemies.${i}.passive.name" placeholder="Passive name" style="flex:1">
            <label class="check"><input type="checkbox" data-bind="blasphemies.${i}.passive.track_enabled"> fill track</label>
            <div data-passive-track="${i}" ${b.passive.track_enabled ? "" : "hidden"}></div></div>
          <textarea data-bind="blasphemies.${i}.passive.description" placeholder="Passive description"></textarea>
        </div>
        <div class="field"><span>Observed powers · ${b.powers.filter(p => p.known).length} known of ${b.powers.length}</span>
          <div class="stack">${b.powers.map((p, pi) => powerHtml(`blasphemies.${i}.powers`, p, pi, true)).join("")}</div>
          <div><button class="btn btn-sm" data-add-power="${i}">+ Add power</button></div>
        </div>
      </div>
    </div>`).join("");
    CK.bind(root, ex, (path) => { save(); if (path.endsWith("track_enabled") || path.endsWith(".known")) renderBlasphemies(); });
    root.querySelectorAll("[data-passive-track]").forEach(el => {
      const i = Number(el.dataset.passiveTrack);
      CK.pips(el, { count: 3, value: ex.blasphemies[i].passive.track_fill, kind: "seg", onChange: v => { ex.blasphemies[i].passive.track_fill = v; save(); renderBlasphemies(); } });
    });
    root.querySelectorAll("[data-add-power]").forEach(b => b.addEventListener("click", () => {
      ex.blasphemies[b.dataset.addPower].powers.push({ name: "", tags: "", description: "", known: false }); save(); renderBlasphemies();
    }));
    root.querySelectorAll("[data-rm-power]").forEach(b => b.addEventListener("click", () => {
      const [path, i] = b.dataset.rmPower.split(":");
      CK.getPath(ex, path).splice(Number(i), 1); save(); renderBlasphemies();
    }));
    root.querySelectorAll("[data-import]").forEach(b => b.addEventListener("click", () => importFromLibrary(Number(b.dataset.import))));
    root.querySelectorAll("[data-rm-blasphemy]").forEach(b => b.addEventListener("click", async () => {
      if (ex.blasphemies.length <= 1) { CK.toast("An exorcist needs at least one blasphemy.", "error"); return; }
      if (!await CK.confirmDialog("Remove this blasphemy from the sheet?")) return;
      ex.blasphemies.splice(Number(b.dataset.rmBlasphemy), 1); save(); renderAll();
    }));
  }
  function importFromLibrary(i) {
    const b = ex.blasphemies[i];
    const entry = library.entries.find(e => e.name.trim().toLowerCase() === (b.name || "").trim().toLowerCase());
    if (!entry) { CK.toast("No library entry with that name. Define it on the Blasphemy Library page first.", "error"); return; }
    b.library_id = entry.id;
    if (!b.description) b.description = entry.description;
    b.passive.name = entry.passive.name;
    b.passive.description = entry.passive.description;
    b.passive.track_enabled = !!entry.passive.track_enabled;
    const existing = new Set(b.powers.map(p => p.name.trim().toLowerCase()));
    let added = 0;
    entry.powers.forEach(p => { if (!existing.has(p.name.trim().toLowerCase())) { b.powers.push({ name: p.name, tags: p.tags, description: p.description, known: false }); added++; } });
    save(); renderBlasphemies();
    CK.toast(`Imported passive and ${added} power${added === 1 ? "" : "s"} from the library`, "ok");
  }
  $("blasphemy-add").addEventListener("click", () => {
    const options = library.entries.map(e => `<button class="btn" data-pick="${e.id}">${CK.esc(e.name)}</button>`).join("");
    CK.modal({
      title: "Add a blasphemy",
      body: `<p class="hint">Costs an Advance. Adding one crosses out a sin box (−1 overflow cap) and increases XP to advance by +1 automatically. You have ${ex.advancement.advances} advance${ex.advancement.advances === 1 ? "" : "s"} banked.</p>
        <label class="check" style="margin-bottom:8px"><input type="checkbox" id="spend-adv" ${ex.advancement.advances > 0 ? "checked" : "disabled"}> Spend an advance now</label>
        <div class="choice-list">${options}<button class="btn" data-pick="">Blank entry (free text)</button></div>`,
      buttons: [{ label: "Cancel" }],
      onOpen: (m, close) => m.querySelectorAll("[data-pick]").forEach(btn => btn.addEventListener("click", () => {
        if (m.querySelector("#spend-adv").checked) ex.advancement.advances = Math.max(0, ex.advancement.advances - 1);
        const entry = library.entries.find(e => e.id === btn.dataset.pick);
        const b = { id: Math.random().toString(36).slice(2, 10), name: entry ? entry.name : "", library_id: entry ? entry.id : null,
          description: "", passive: { name: "", description: "", track_enabled: false, track_fill: 0 }, powers: [] };
        ex.blasphemies.push(b);
        if (entry) importFromLibrary(ex.blasphemies.length - 1);
        save(); renderAll(); close();
      })),
    });
  });

  /* ---------- Render everything ------------------------------------------ */
  function renderDerived() { renderCat(); renderExecution(); renderSin(); renderAdvancement(); }
  function renderAll() {
    renderPhoto(); renderCat(); renderSkills(); renderExecution(); renderSin(); renderSinMarks();
    renderHealth(); renderAdvancement(); renderKit(); renderAgenda(); renderBlasphemies();
  }
  renderAll();
  Dice.setRoller(ex.identity.name || Dice.getRoller());
})();
