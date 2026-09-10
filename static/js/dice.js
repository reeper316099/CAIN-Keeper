/* ==========================================================================
   dice.js - the persistent dice panel (right-hand side of every page).

   Public API (window.Dice):
     Dice.roll(kind, params, extra)  -> Promise<entry>   roll + log + render
     Dice.setPool({skill, bonus, hard, risky, label})    prefill the pool inputs
     Dice.setTiers({"1": .., "2-3": .., "4-6": ..}, label)
     Dice.setRoller(name)
     Dice.setMarks(n)                                     sin-mark count for resistance
     Dice.open()                                          expand / show the panel
     Dice.onRoll(fn)                                      subscribe to results

   Rolls are performed server-side (dice.py) so the roll log is the single
   source of truth. If the page belongs to a campaign the roll is written to
   that campaign's roll_history.json; otherwise it is rolled but not logged.
   ========================================================================== */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const panel = $("dice-panel");
  if (!panel) return;

  const Dice = window.Dice = {};
  const listeners = [];
  const LS = {
    get: k => { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
  };

  /* Which campaign do rolls log to? The page's campaign, else the last one
     visited (so the Library / CAT pages still log somewhere sensible). */
  const campaignId = CK.campaignId || LS.get("ck_last_campaign") || "";
  const campaignName = CK.campaignName || LS.get("ck_last_campaign_name") || "";

  const DEFAULT_TIERS = { "1": "Strongest / worst outcome", "2-3": "Moderate outcome", "4-6": "Weakest outcome" };

  /* ---------- Panel chrome: collapse / pin / mobile --------------------- */
  function applyChrome() {
    panel.classList.toggle("collapsed", LS.get("ck_dice_collapsed") === "1");
    panel.classList.toggle("floating", LS.get("ck_dice_pinned") === "0");
    $("dice-pin").classList.toggle("active", LS.get("ck_dice_pinned") !== "0");
  }
  applyChrome();
  $("dice-collapse").addEventListener("click", () => {
    LS.set("ck_dice_collapsed", panel.classList.contains("collapsed") ? "0" : "1");
    applyChrome();
  });
  $("dice-pin").addEventListener("click", () => {
    LS.set("ck_dice_pinned", LS.get("ck_dice_pinned") === "0" ? "1" : "0");
    applyChrome();
  });
  $("dice-fab").addEventListener("click", () => panel.classList.add("mobile-open"));
  $("dice-close-mobile").addEventListener("click", () => panel.classList.remove("mobile-open"));

  Dice.open = function () {
    LS.set("ck_dice_collapsed", "0");
    applyChrome();
    panel.classList.add("mobile-open");
  };

  /* ---------- Inputs ---------------------------------------------------- */
  const rollerInput = $("dice-roller");
  rollerInput.value = LS.get("ck_roller") || "GM";
  rollerInput.addEventListener("input", () => LS.set("ck_roller", rollerInput.value));
  Dice.setRoller = name => { if (name) { rollerInput.value = name; LS.set("ck_roller", name); } };
  Dice.getRoller = () => rollerInput.value.trim() || "GM";

  const hardBtn = $("dice-hard"), riskyBtn = $("dice-risky");
  hardBtn.addEventListener("click", () => hardBtn.classList.toggle("active"));
  riskyBtn.addEventListener("click", () => riskyBtn.classList.toggle("active"));
  $("dice-bonus").addEventListener("input", checkBonus);
  function checkBonus() { $("dice-bonus-warning").hidden = Number($("dice-bonus").value) <= 3; }

  Dice.setPool = function ({ skill, bonus, hard, risky, label } = {}) {
    if (skill != null) $("dice-skill").value = skill;
    if (bonus != null) $("dice-bonus").value = bonus;
    if (hard != null) hardBtn.classList.toggle("active", !!hard);
    if (risky != null) riskyBtn.classList.toggle("active", !!risky);
    if (label != null) $("dice-label").value = label;
    checkBonus();
  };

  Dice.setTiers = function (tiers, label) {
    const t = { ...DEFAULT_TIERS, ...(tiers || {}) };
    $("tier-1").value = t["1"]; $("tier-2").value = t["2-3"]; $("tier-3").value = t["4-6"];
    if (label != null) $("dice-label").value = label;
  };
  Dice.getTiers = () => ({ "1": $("tier-1").value, "2-3": $("tier-2").value, "4-6": $("tier-3").value });
  Dice.setTiers(JSON.parse(LS.get("ck_tiers") || "null") || DEFAULT_TIERS);
  ["tier-1", "tier-2", "tier-3"].forEach(id => $(id).addEventListener("input", () => LS.set("ck_tiers", JSON.stringify(Dice.getTiers()))));
  $("dice-tiers-reset").addEventListener("click", () => { Dice.setTiers(DEFAULT_TIERS); LS.set("ck_tiers", JSON.stringify(DEFAULT_TIERS)); });

  Dice.setMarks = n => { $("dice-marks").value = n; };

  /* ---------- Rolling --------------------------------------------------- */
  Dice.onRoll = fn => listeners.push(fn);

  /**
   * Perform a roll. `extra.roller` overrides the panel's roller name;
   * `extra.source` is passed through to listeners so a page can react only
   * to rolls it initiated (e.g. apply 1d3 sin to the right exorcist).
   */
  Dice.roll = async function (kind, params = {}, extra = {}) {
    const roller = extra.roller || Dice.getRoller();
    const url = campaignId ? `/api/campaigns/${campaignId}/roll` : "/api/roll";
    const entry = await CK.api("POST", url, { kind, params, roller });
    entry._source = extra.source || null;
    renderResult(entry);
    prependRecent(entry);
    listeners.forEach(fn => { try { fn(entry); } catch (e) { console.error(e); } });
    return entry;
  };

  $("dice-roll-pool").addEventListener("click", () => Dice.roll("pool", {
    skill_dice: Number($("dice-skill").value), bonus_dice: Number($("dice-bonus").value),
    hard: hardBtn.classList.contains("active"), risky: riskyBtn.classList.contains("active"),
    label: $("dice-label").value,
  }));
  $("dice-roll-risk").addEventListener("click", () => Dice.roll("risk", { tiers: Dice.getTiers(), label: $("dice-label").value || "Risk die" }));
  panel.querySelectorAll("[data-simple]").forEach(b => b.addEventListener("click", () => Dice.roll("simple", { expression: b.dataset.simple })));
  $("dice-roll-resist").addEventListener("click", () => Dice.roll("resistance", { sin_marks: Number($("dice-marks").value) }));
  $("dice-roll-rest").addEventListener("click", () => Dice.roll("rest", {}));

  /* ---------- Rendering ------------------------------------------------- */
  function faces(dice, opts = {}) {
    return `<div class="dice-faces">${dice.map(v => {
      const cls = ["die"];
      if (opts.threshold && v >= opts.threshold) cls.push("hit");
      if (v === 1 && opts.markOnes) cls.push("one");
      if (opts.big) cls.push("big");
      return `<span class="${cls.join(" ")}">${v}</span>`;
    }).join("")}</div>`;
  }

  function renderResult(e) {
    let html = "";
    const who = `<div class="hint">${CK.esc(e.roller)} · ${CK.esc(e.label)}</div>`;
    switch (e.kind) {
      case "pool": {
        const cls = e.full_success ? "good" : e.no_successes ? "bad" : "";
        html = `<div class="headline ${cls}">${e.successes} success${e.successes === 1 ? "" : "es"}${e.full_success ? " · FULL SUCCESS" : ""}</div>`
          + faces(e.dice, { threshold: e.threshold, markOnes: true })
          + `<div class="hint">${e.dice.length}d6${e.hard ? " · Hard (6s only)" : ""}${e.risky ? " · Risky: Admin rolls the risk die" : ""}${e.bonus_warning ? " · <span class='accent'>bonus dice over +3</span>" : ""}${e.no_successes ? " · <span class='accent'>no successes: store a pathos (Divine Agony)</span>" : ""}</div>`;
        break;
      }
      case "risk": {
        const cls = e.value === 1 ? "bad" : e.value <= 3 ? "warn" : "good";
        html = `<div class="row">${faces([e.value], { big: true, markOnes: true })}<div><div class="headline ${cls}">[${e.tier}] ${CK.esc(e.tier_text)}</div>`
          + (e.natural_one ? `<div class="hint accent">Natural 1: slash tension (once per scene) · slash hooks · severe attack usable</div>` : "") + `</div></div>`;
        break;
      }
      case "simple":
        html = `<div class="headline">${e.expression} = ${e.total}</div>${faces(e.dice, { big: e.dice.length === 1 })}`;
        break;
      case "resistance": {
        html = `<div class="headline ${e.success ? "good" : "bad"}">${e.success ? "KEEP CONTROL" : "GIVE UP"} · ${e.die} + ${e.sin_marks} = ${e.total}</div>`
          + faces([e.die], { big: true, markOnes: true })
          + `<div class="hint">${e.success ? "Gain a sin mark, clear all sin, permanently cross out two boxes." : "Total above 7. Sin overflow."}${e.natural_one ? " Natural 1 always succeeds." : ""}</div>`;
        break;
      }
      case "rest":
        html = `<div class="headline">Rest: ${e.dice[0]} and ${e.dice[1]}</div>${faces(e.dice, { big: true })}<div class="hint">Assign each d3 to psyche burst, stress healed, or hook slashes cleared.</div>`;
        break;
      case "trauma":
        html = `<div class="headline">−${e.stress_reduced} stress · ${e.slashes} slash${e.slashes === 1 ? "" : "es"}</div>${faces([e.stress_reduced, e.slashes], { big: true })}<div class="hint">Reduce one target's stress by ${e.stress_reduced}; inflict ${e.slashes} on the sin's execution talisman.</div>`;
        break;
      default:
        html = `<div class="headline">${CK.esc(e.summary)}</div>`;
    }
    $("dice-result").innerHTML = who + html;
  }

  const recent = $("dice-recent");
  function recentRow(e) {
    return `<div class="r"><span class="who">${CK.esc(e.roller)}</span> ${CK.esc(e.label)}: ${CK.esc(e.summary)}<span class="when">${CK.fmtTime(e.ts)}</span></div>`;
  }
  function prependRecent(e) {
    if (recent.querySelector(".hint")) recent.innerHTML = "";
    recent.insertAdjacentHTML("afterbegin", recentRow(e));
    while (recent.children.length > 8) recent.lastElementChild.remove();
  }
  async function loadRecent() {
    if (!campaignId) return;
    const link = $("dice-history-link");
    link.href = `/campaigns/${campaignId}/rolls`;
    link.hidden = false;
    try {
      const rolls = await CK.api("GET", `/api/campaigns/${campaignId}/rolls`, undefined, { quiet: true });
      const last = rolls.slice(-8).reverse();
      if (last.length) recent.innerHTML = last.map(recentRow).join("");
      else recent.innerHTML = `<span class="hint">No rolls yet in ${CK.esc(campaignName || "this campaign")}.</span>`;
    } catch (_) { /* campaign may have been deleted */ }
  }
  loadRecent();
})();
