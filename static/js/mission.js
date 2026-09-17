/* ==========================================================================
   mission.js - the GM's session tracker.

   * Tension (3) and Pressure (6) tracks. Filling tension opens a GM-move
     prompt (nothing is auto-picked); applying it bumps pressure and clears
     tension. Pressure at 6 shows the "out of control" banner with a +1 CAT
     shortcut for each sin.
   * Talismans: up to six, each with a name, a length and a fill track.
   * Rest: +1 pressure, roll 2d3, then assign each d3 to an exorcist as
     psyche burst / stress healed / hook slashes cleared. Applying loads
     that exorcist, edits it and PUTs it back.
   * End session: archives a summary to mission_history.json and resets the
     live tracker (pressure is kept unless you choose to reset it).
   ========================================================================== */
(async function () {
  "use strict";
  const cid = CK.campaignId;
  const $ = id => document.getElementById(id);
  const root = $("tracker");

  const [ref, tracker] = await Promise.all([CK.reference(), CK.api("GET", `/api/campaigns/${cid}/mission`)]);
  let exorcists = await CK.api("GET", `/api/campaigns/${cid}/exorcists`);
  const saver = CK.makeSaver(() => CK.api("PUT", `/api/campaigns/${cid}/mission`, tracker));
  const save = () => saver.schedule();

  CK.bind(root, tracker, save);

  function log(text) {
    tracker.log.push({ ts: new Date().toISOString(), text });
    renderLog(); save();
  }

  /* ---------- Mission flow --------------------------------------------- */
  function renderFlow() {
    $("flow").innerHTML = ref.mission_flow.map((step, i) => `<label class="check"><input type="checkbox" data-bind="flow.${i}"> <span class="mono muted">${i + 1}.</span> ${step}</label>`).join("");
    CK.bind($("flow"), tracker, save);
  }

  /* ---------- Tension / pressure --------------------------------------- */
  function renderTracks() {
    CK.pips($("tension"), { count: 3, value: tracker.tension, kind: "seg", size: "tall", onChange: v => setTension(v) });
    $("tension-count").textContent = `${tracker.tension} / 3`;
    CK.pips($("pressure"), { count: 6, value: tracker.pressure, kind: "seg", size: "tall", onChange: v => { tracker.pressure = v; save(); renderTracks(); renderPressureBanner(); } });
    $("pressure-count").textContent = `${tracker.pressure} / 6`;
  }
  function setTension(v) {
    tracker.tension = v; save(); renderTracks();
    if (v >= 3) tensionFilled();
  }
  $("tension-slash").addEventListener("click", () => setTension(Math.min(3, tracker.tension + 1)));

  function tensionFilled() {
    let chosen = null;
    CK.modal({
      title: "Tension filled",
      body: `<p>Increase pressure by 1, then clear tension. Then make a GM move (pick one, or none):</p>
        <div class="choice-list" id="gm-moves">${ref.gm_moves.map(m => `<button class="btn" data-move="${CK.esc(m)}">${CK.esc(m)}</button>`).join("")}</div>`,
      buttons: [
        { label: "Leave tension full", cls: "btn-ghost" },
        { label: "Apply: +1 pressure, clear tension", cls: "btn-accent", onClick: () => {
          tracker.pressure = Math.min(6, tracker.pressure + 1);
          tracker.tension = 0;
          log(`Tension filled → pressure ${tracker.pressure}${chosen ? " · GM move: " + chosen : ""}`);
          renderTracks(); renderPressureBanner();
          CK.toast("Pressure increased. Remember: pressure increases slash every exorcist's hooks.");
        } },
      ],
      onOpen: m => m.querySelectorAll("[data-move]").forEach(b => b.addEventListener("click", () => {
        m.querySelectorAll("[data-move]").forEach(x => x.classList.remove("active"));
        b.classList.add("active"); chosen = b.dataset.move;
      })),
    });
  }

  async function renderPressureBanner() {
    const full = tracker.pressure >= 6;
    $("pressure-banner").hidden = !full;
    if (!full) return;
    const sins = await CK.api("GET", `/api/campaigns/${cid}/sins`);
    const box = $("sin-bumps");
    box.innerHTML = sins.length ? `<span class="hint">Suggest Sin CAT +1:</span>` + sins.map(s => `<button class="btn btn-xs" data-bump="${s.id}">${CK.esc(s.name || "Unnamed sin")} (CAT ${s.category} → ${Math.min(7, s.category + 1)})</button>`).join("")
      : `<span class="hint">No sins recorded to escalate.</span>`;
    box.querySelectorAll("[data-bump]").forEach(b => b.addEventListener("click", async () => {
      const s = sins.find(x => x.id === b.dataset.bump);
      s.category = Math.min(7, s.category + 1);
      await CK.api("PUT", `/api/campaigns/${cid}/sins/${s.id}`, s);
      log(`Out of control: ${s.name || "sin"} CAT → ${s.category}`);
      renderPressureBanner();
    }));
  }

  /* ---------- Log -------------------------------------------------------- */
  function renderLog() {
    $("log").innerHTML = tracker.log.slice().reverse().map(l => `<div class="hint"><span class="muted">${CK.fmtTime(l.ts)}</span> ${CK.esc(l.text)}</div>`).join("") || `<span class="hint">Nothing logged yet.</span>`;
  }
  $("log-add").addEventListener("click", () => { const v = $("log-input").value.trim(); if (v) { log(v); $("log-input").value = ""; } });
  $("log-input").addEventListener("keydown", e => { if (e.key === "Enter") $("log-add").click(); });

  /* ---------- Talismans ------------------------------------------------- */
  const lengthTag = n => n <= 2 ? "short" : n <= 5 ? "medium" : "long";
  function renderTalismans() {
    const box = $("talismans");
    box.innerHTML = tracker.talismans.map((t, i) => `<div class="card talisman" style="background:var(--bg)">
      <div class="head">
        <input type="text" data-bind="talismans.${i}.name" placeholder="What this talisman represents">
        <select data-bind="talismans.${i}.length" data-number="1" title="Length">${[2, 3, 4, 5, 6, 7, 8].map(n => `<option value="${n}">${n} · ${lengthTag(n)}</option>`).join("")}</select>
        <button class="btn btn-xs btn-ghost btn-danger" data-rm="${i}">✕</button>
      </div>
      <div class="row"><div data-talisman="${i}"></div><span class="count mono muted">${t.fill} / ${t.length}</span>${t.fill >= t.length ? '<span class="track-full">FILLED</span>' : ""}</div>
    </div>`).join("") || `<div class="empty" style="grid-column:1/-1">No talismans affixed.</div>`;
    CK.bind(box, tracker, path => { save(); if (path.endsWith(".length")) renderTalismans(); });
    box.querySelectorAll("[data-talisman]").forEach(el => {
      const i = Number(el.dataset.talisman);
      CK.pips(el, { count: tracker.talismans[i].length, value: tracker.talismans[i].fill, kind: "seg", size: "tall", onChange: v => { tracker.talismans[i].fill = v; save(); renderTalismans(); } });
    });
    box.querySelectorAll("[data-rm]").forEach(b => b.addEventListener("click", () => { tracker.talismans.splice(Number(b.dataset.rm), 1); save(); renderTalismans(); }));
    $("talisman-add").disabled = tracker.talismans.length >= 6;
  }
  $("talisman-add").addEventListener("click", () => {
    if (tracker.talismans.length >= 6) { CK.toast("Six talismans max", "error"); return; }
    tracker.talismans.push({ id: Math.random().toString(36).slice(2, 10), name: "", length: 3, fill: 0 }); save(); renderTalismans();
  });

  /* ---------- Rest -------------------------------------------------------- */
  $("rest").addEventListener("click", async () => {
    if (!await CK.confirmDialog("Rest as a group: increase pressure by 1 and roll 2d3?")) return;
    tracker.pressure = Math.min(6, tracker.pressure + 1);
    renderTracks(); renderPressureBanner();
    const r = await Dice.roll("rest", { label: "Rest" }, { roller: "GM", source: "rest" });
    log(`Rest: pressure ${tracker.pressure}, rolled ${r.dice[0]} and ${r.dice[1]}`);
    exorcists = await CK.api("GET", `/api/campaigns/${cid}/exorcists`);
    renderRestAssign(r.dice);
  });

  function renderRestAssign(dice) {
    const box = $("rest-assign");
    if (!exorcists.length) { box.innerHTML = `<span class="hint">No exorcists in this campaign to assign to.</span>`; return; }
    const exOpts = exorcists.map(e => `<option value="${e.id}">${CK.esc(e.identity.name || "Unnamed")}</option>`).join("");
    box.innerHTML = dice.map((n, i) => `<div class="card" style="background:var(--bg);padding:10px" data-die="${i}">
      <div class="row"><span class="die big">${n}</span>
        <select data-ex style="flex:1">${exOpts}</select></div>
      <div class="row" style="margin-top:6px">
        <select data-effect><option value="burst">Gain ${n} psyche burst</option><option value="stress">Heal ${n} stress</option><option value="hook">Clear ${n} hook slashes</option></select>
        <select data-hook hidden></select>
        <button class="btn btn-xs btn-accent" data-apply>Apply</button></div>
      <div class="hint" data-done hidden></div></div>`).join("");
    box.querySelectorAll("[data-die]").forEach(card => {
      const n = dice[Number(card.dataset.die)];
      const exSel = card.querySelector("[data-ex]"), effSel = card.querySelector("[data-effect]"), hookSel = card.querySelector("[data-hook]");
      const refreshHooks = () => {
        const ex = exorcists.find(e => e.id === exSel.value);
        hookSel.innerHTML = ex.hooks.map((h, i) => `<option value="${i}">${CK.esc(h.name || "Hook " + (i + 1))} (${h.fill}/3)</option>`).join("");
        hookSel.hidden = effSel.value !== "hook";
      };
      exSel.addEventListener("change", refreshHooks); effSel.addEventListener("change", refreshHooks); refreshHooks();
      card.querySelector("[data-apply]").addEventListener("click", async () => {
        const ex = await CK.api("GET", `/api/campaigns/${cid}/exorcists/${exSel.value}`);
        const name = ex.identity.name || "Exorcist";
        let text;
        if (effSel.value === "burst") { ex.burst.marked = Math.max(0, ex.burst.marked - n); text = `${name}: recovered ${n} psyche burst (${ex.burst.marked} marked)`; }
        else if (effSel.value === "stress") { ex.execution.current = Math.max(0, ex.execution.current - n); text = `${name}: healed ${n} stress (now ${ex.execution.current})`; }
        else { const h = ex.hooks[Number(hookSel.value)]; h.fill = Math.max(0, h.fill - n); text = `${name}: cleared ${n} slashes from hook "${h.name || "Hook"}" (${h.fill}/3)`; }
        await CK.api("PUT", `/api/campaigns/${cid}/exorcists/${ex.id}`, ex);
        exorcists = exorcists.map(e => e.id === ex.id ? ex : e);
        log(text);
        card.querySelector("[data-done]").hidden = false;
        card.querySelector("[data-done]").textContent = "✓ " + text;
        card.querySelector("[data-apply]").disabled = true;
      });
    });
  }

  /* ---------- Archive / history ---------------------------------------- */
  $("archive").addEventListener("click", () => {
    CK.modal({
      title: "End session",
      body: `<div class="stack">
        <label class="field"><span>Summary</span><textarea id="arch-summary" placeholder="What happened this session?"></textarea></label>
        <label class="check"><input type="checkbox" id="arch-reset"> Also reset pressure to 0 (new hunt)</label>
        <div class="hint">Saves a summary to mission history and clears flow, tension, talismans and the log. Remember each exorcist's end-of-session checklist on their sheet.</div>
      </div>`,
      buttons: [
        { label: "Cancel" },
        { label: "Archive session", cls: "btn-accent", onClick: async m => {
          await saver.flush();
          const r = await CK.api("POST", `/api/campaigns/${cid}/mission/archive`, {
            summary: m.querySelector("#arch-summary").value, reset_pressure: m.querySelector("#arch-reset").checked });
          Object.assign(tracker, r.tracker);
          CK.bind(root, tracker); renderAll();
          CK.toast("Session archived", "ok");
        } },
      ],
    });
  });

  const truncate = (s, n) => (s && s.length > n) ? s.slice(0, n).trimEnd() + "…" : (s || "");

  async function renderHistory() {
    const hist = await CK.api("GET", `/api/campaigns/${cid}/mission/history`);
    $("history").innerHTML = hist.slice().reverse().map(h => `<div class="history-item clickable" data-history="${h.id}" tabindex="0" role="button">
      <div class="row between"><b>${CK.esc(h.session_name || "Untitled session")}</b><span class="muted">${CK.fmtTime(h.ended)}</span></div>
      <div class="hint">${CK.esc(truncate(h.summary, 140) || "No summary.")}</div>
      <div class="row" style="margin-top:4px"><span class="tag">pressure ${h.pressure_final}</span><span class="tag">${h.flow_completed}/7 steps</span><span class="tag">${(h.talismans || []).length} talisman${(h.talismans || []).length === 1 ? "" : "s"}</span>${h.notes ? '<span class="tag">has notes</span>' : ""}</div>
    </div>`).join("") || `<span class="hint">No archived sessions yet.</span>`;
    $("history").querySelectorAll("[data-history]").forEach(el => {
      const open = () => openHistoryDetail(hist.find(h => h.id === el.dataset.history));
      el.addEventListener("click", open);
      el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    });
  }

  /** Full detail view for one archived session: everything the compact
   * list row leaves out (full summary/notes text, every mission-flow step,
   * every talisman, the complete session log). */
  function openHistoryDetail(h) {
    if (!h) return;
    const flowRows = ref.mission_flow.map((step, i) => {
      const done = Array.isArray(h.flow) ? !!h.flow[i] : i < h.flow_completed;  // old entries: no per-step data, best effort
      return `<div class="row" style="gap:6px"><span class="${done ? "accent" : "muted"}">${done ? "✓" : "○"}</span><span>${CK.esc(step)}</span></div>`;
    }).join("");
    const talismanRows = (h.talismans || []).map(t =>
      `<div class="hint">${CK.esc(t.name || "Unnamed talisman")} — ${t.fill}/${t.length}${t.fill >= t.length ? " (filled)" : ""}</div>`
    ).join("") || `<span class="hint">None affixed.</span>`;
    const logRows = (h.log || []).slice().reverse().map(l =>
      `<div class="hint"><span class="muted">${CK.fmtTime(l.ts)}</span> ${CK.esc(l.text)}</div>`
    ).join("") || `<span class="hint">Nothing logged.</span>`;

    CK.modal({
      title: h.session_name || "Untitled session",
      body: `<div class="stack">
        <div class="hint">${CK.fmtTime(h.started)} → ${CK.fmtTime(h.ended)} · pressure ${h.pressure_final}</div>
        <div class="field"><span>Summary</span><div class="rule-text">${CK.escNl(h.summary) || "No summary."}</div></div>
        <div class="field"><span>Notes</span><div class="rule-text">${CK.escNl(h.notes) || "No notes."}</div></div>
        <div class="field"><span>Mission flow</span>${flowRows}</div>
        <div class="field"><span>Talismans</span>${talismanRows}</div>
        <div class="field"><span>Session log</span><div class="stack" style="gap:2px;max-height:220px;overflow-y:auto">${logRows}</div></div>
      </div>`,
      buttons: [{ label: "Close" }],
    });
  }

  function renderAll() { renderFlow(); renderTracks(); renderPressureBanner(); renderLog(); renderTalismans(); renderHistory(); }
  renderAll();
})();
