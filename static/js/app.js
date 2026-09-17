/* ==========================================================================
   app.js - shared frontend helpers for every CAIN Keeper page.

   Exposes a single global, `CK`, with:
     CK.campaignId          id of the campaign the page belongs to ('' if none)
     CK.api(method, url, body)         fetch wrapper returning parsed JSON
     CK.toast(msg, type)               transient bottom-centre message
     CK.confirmDialog(msg)             Promise<boolean>
     CK.modal({...})                   simple modal with custom buttons
     CK.esc(text)                      HTML-escape
     CK.getPath / CK.setPath           dotted-path access into state objects
     CK.bind(root, state, onChange)    two-way binding for [data-bind] inputs
     CK.pips(el, opts)                 clickable pip/segment tracker
     CK.autosize(el)                   grow a textarea's height to fit its content
     CK.makeSaver(saveFn, delayMs)     debounced autosave (default 500 ms)
     CK.setSaveStatus(state)           header indicator
     CK.reference()                    cached /api/reference data

   Pages work on whole documents: load JSON -> mutate in memory -> PUT back,
   debounced. That keeps the page scripts small and the API tiny.
   ========================================================================== */
(function () {
  "use strict";

  const CK = window.CK = {};
  CK.campaignId = document.body.dataset.campaign || "";
  CK.campaignName = document.body.dataset.campaignName || "";

  /* ---------- Networking ------------------------------------------------ */

  /** JSON fetch wrapper. Throws on non-2xx with the server's detail text. */
  CK.api = async function (method, url, body, opts = {}) {
    const init = { method, headers: {} };
    if (body instanceof FormData) {
      init.body = body;
    } else if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    if (!res.ok) {
      let detail = res.statusText;
      try { detail = (await res.json()).detail || detail; } catch (_) {}
      if (!opts.quiet) CK.toast(detail, "error");
      throw new Error(detail);
    }
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };

  let refCache = null;
  /** Static rules data (skills, GM moves, ...) - fetched once per page. */
  CK.reference = async function () {
    if (!refCache) refCache = await CK.api("GET", "/api/reference");
    return refCache;
  };

  /* ---------- UI bits ---------------------------------------------------- */

  CK.esc = function (s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  };

  /** Escaped text with line breaks preserved as <br> - for showing saved
   * textarea content back as read-only HTML (e.g. an archived session). */
  CK.escNl = function (s) {
    return CK.esc(s).replace(/\n/g, "<br>");
  };

  CK.toast = function (msg, type = "") {
    const box = document.getElementById("toasts");
    if (!box) return;
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), type === "error" ? 5000 : 2800);
  };

  CK.confirmDialog = function (msg) {
    return Promise.resolve(window.confirm(msg));
  };

  /**
   * Modal dialog.
   *   CK.modal({ title, body (HTML string or element), buttons: [{label, cls, onClick, close}] })
   * Returns the backdrop element; call .remove() to close programmatically.
   */
  CK.modal = function ({ title = "", body = "", buttons = [], onOpen }) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    const modal = document.createElement("div");
    modal.className = "modal";
    modal.innerHTML = `<h2>${CK.esc(title)}</h2><div class="modal-body"></div><div class="modal-actions"></div>`;
    const bodyEl = modal.querySelector(".modal-body");
    if (typeof body === "string") bodyEl.innerHTML = body; else bodyEl.appendChild(body);
    const actions = modal.querySelector(".modal-actions");
    const close = () => backdrop.remove();
    buttons.forEach(b => {
      const btn = document.createElement("button");
      btn.className = "btn " + (b.cls || "");
      btn.textContent = b.label;
      btn.addEventListener("click", async () => {
        if (b.onClick) { const r = await b.onClick(modal, close); if (r === false) return; }
        if (b.close !== false) close();
      });
      actions.appendChild(btn);
    });
    backdrop.addEventListener("click", e => { if (e.target === backdrop) close(); });
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    if (onOpen) onOpen(modal, close);
    return backdrop;
  };

  /** Small prompt-style modal returning the entered string (or null). */
  CK.promptDialog = function (title, placeholder = "", initial = "") {
    return new Promise(resolve => {
      let done = false;
      const bd = CK.modal({
        title,
        body: `<input type="text" id="prompt-input" style="width:100%" placeholder="${CK.esc(placeholder)}" value="${CK.esc(initial)}">`,
        buttons: [
          { label: "Cancel", onClick: () => { done = true; resolve(null); } },
          { label: "OK", cls: "btn-accent", onClick: m => { done = true; resolve(m.querySelector("#prompt-input").value); } },
        ],
        onOpen: m => {
          const inp = m.querySelector("#prompt-input");
          inp.focus();
          inp.addEventListener("keydown", e => { if (e.key === "Enter") { done = true; resolve(inp.value); bd.remove(); } });
        },
      });
      // Clicking the backdrop closes without resolving -> treat as cancel.
      const obs = new MutationObserver(() => { if (!document.body.contains(bd) && !done) { done = true; resolve(null); } obs.disconnect(); });
      obs.observe(document.body, { childList: true });
    });
  };

  CK.setSaveStatus = function (state) {
    const el = document.getElementById("save-status");
    if (!el) return;
    el.className = "save-status " + state;
    el.textContent = { saving: "Saving…", saved: "Saved", error: "Save failed", dirty: "Unsaved" }[state] || "";
  };

  CK.clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  CK.fmtTime = iso => {
    if (!iso) return "";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  /* ---------- Auto-growing textareas ------------------------------------- */

  /**
   * Grow `el` (a <textarea>) to exactly fit its content instead of scrolling.
   * Resetting height to "auto" first lets scrollHeight shrink back down when
   * text is deleted, not just grow; CSS min-height (style.css) keeps an empty
   * box from collapsing to a sliver.
   */
  CK.autosize = function (el) {
    if (!el || el.tagName !== "TEXTAREA") return;
    el.style.height = "auto";
    // Elements are border-box (see the global "* { box-sizing: border-box }"
    // reset), so the height we set must include the border scrollHeight
    // itself doesn't count, or the last couple of pixels of text clip.
    const cs = getComputedStyle(el);
    const border = parseFloat(cs.borderTopWidth || 0) + parseFloat(cs.borderBottomWidth || 0);
    el.style.height = (el.scrollHeight + border) + "px";
  };

  // Grow while typing. Delegated on the document so it covers every textarea,
  // including the couple of one-off modal fields that skip data-bind/CK.bind
  // (see CK.bind below for textareas whose value is set programmatically).
  document.addEventListener("input", e => { if (e.target.tagName === "TEXTAREA") CK.autosize(e.target); });

  // A textarea's height was set for the WIDTH it had when last measured.
  // Anything that changes that width after the fact - resizing the window,
  // opening/closing the mobile sidebar, pinning or unpinning the dice panel
  // (which changes .main's width) - re-wraps the text into more or fewer
  // lines without re-measuring, so the box ends up too short and clips its
  // last line. Re-autosize every textarea whenever the layout might have
  // changed. Debounced so a window drag-resize doesn't thrash.
  let resizeAutosizeTimer = null;
  function autosizeAllTextareas() {
    document.querySelectorAll("textarea").forEach(CK.autosize);
  }
  window.addEventListener("resize", () => {
    clearTimeout(resizeAutosizeTimer);
    resizeAutosizeTimer = setTimeout(autosizeAllTextareas, 120);
  });
  CK.autosizeAllTextareas = autosizeAllTextareas;

  /* ---------- State helpers --------------------------------------------- */

  CK.getPath = function (obj, path) {
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
  };
  CK.setPath = function (obj, path, value) {
    const keys = path.split(".");
    let o = obj;
    for (let i = 0; i < keys.length - 1; i++) {
      if (o[keys[i]] == null) o[keys[i]] = {};
      o = o[keys[i]];
    }
    o[keys[keys.length - 1]] = value;
  };

  /**
   * Two-way bind every element with a data-bind="dotted.path" inside `root`
   * to `state`. Checkboxes -> booleans, number inputs -> numbers, everything
   * else -> strings. Calls onChange(path, value, el) after each edit.
   * Elements with data-bind-once are only initialised (no listener) - handy
   * when a page re-renders and re-binds the same root several times.
   */
  CK.bind = function (root, state, onChange) {
    root.querySelectorAll("[data-bind]").forEach(el => {
      const path = el.dataset.bind;
      const value = CK.getPath(state, path);
      if (el.type === "checkbox") el.checked = !!value;
      else if (el.type === "radio") el.checked = String(el.value) === String(value);
      else el.value = value ?? "";
      if (el.tagName === "TEXTAREA") CK.autosize(el);  // fills from data, not typing, so no "input" event fires
      if (el.dataset.bound) return;
      el.dataset.bound = "1";
      const evt = (el.tagName === "SELECT" || el.type === "checkbox" || el.type === "radio" || el.type === "date") ? "change" : "input";
      el.addEventListener(evt, () => {
        let v;
        if (el.type === "checkbox") v = el.checked;
        else if (el.type === "number") v = el.value === "" ? 0 : Number(el.value);
        else if (el.type === "radio") { if (!el.checked) return; v = el.dataset.number ? Number(el.value) : el.value; }
        else v = el.dataset.number ? Number(el.value) : el.value;
        CK.setPath(state, path, v);
        if (onChange) onChange(path, v, el);
      });
    });
  };

  /**
   * Render a clickable tracker into `el`.
   *   opts.count     number of boxes
   *   opts.value     boxes currently filled
   *   opts.onChange  (newValue) => void
   *   opts.kind      "pip" (circles) or "seg" (squares)
   *   opts.dead      number of boxes at the END that are crossed out / unusable
   *   opts.dashedFrom  index from which boxes are drawn dashed (e.g. optional XP)
   *   opts.size      "sm" | "lg" | "tall" | "wide" (css modifier)
   *   opts.readonly  no clicks
   * Clicking box i sets value to i+1, or to i if it was exactly i+1 (toggle off).
   */
  CK.pips = function (el, opts) {
    const kind = opts.kind || "pip";
    const count = Math.max(0, opts.count | 0);
    const dead = Math.max(0, opts.dead | 0);
    const usable = Math.max(0, count - dead);
    const value = CK.clamp(opts.value | 0, 0, usable);
    el.className = (kind === "seg" ? "segs" : "pips") + (opts.size ? " " + opts.size : "");
    el.innerHTML = "";
    for (let i = 0; i < count; i++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = kind;
      const isDead = i >= usable;
      if (isDead) b.classList.add("dead");
      if (i < value) b.classList.add("filled");
      if (opts.dashedFrom != null && i >= opts.dashedFrom) b.classList.add("dashed");
      b.title = isDead ? "Crossed out" : `${i + 1} / ${usable}`;
      if (!isDead && !opts.readonly) {
        b.addEventListener("click", () => {
          const nv = value === i + 1 ? i : i + 1;
          opts.onChange && opts.onChange(nv);
        });
      }
      el.appendChild(b);
    }
    return el;
  };

  /**
   * Debounced autosave. Returns { schedule(), flush(), pending }.
   * `saveFn` is an async function performing the PUT. Rapid pip clicks call
   * schedule() many times but only one write happens, 500 ms after the last.
   */
  CK.makeSaver = function (saveFn, delay = 500) {
    let timer = null, saving = false, again = false;
    async function run() {
      timer = null;
      if (saving) { again = true; return; }
      saving = true;
      CK.setSaveStatus("saving");
      try {
        await saveFn();
        CK.setSaveStatus("saved");
      } catch (e) {
        CK.setSaveStatus("error");
      } finally {
        saving = false;
        if (again) { again = false; run(); }
      }
    }
    const saver = {
      schedule() { CK.setSaveStatus("dirty"); clearTimeout(timer); timer = setTimeout(run, delay); },
      flush() { clearTimeout(timer); return run(); },
    };
    // Try to flush on tab close so the last edit isn't lost.
    window.addEventListener("beforeunload", () => { if (timer) { clearTimeout(timer); saveFn(); } });
    return saver;
  };

  /* ---------- Shell behaviour (sidebar, campaign switcher) --------------- */

  document.addEventListener("DOMContentLoaded", () => {
    const sw = document.getElementById("campaign-switch");
    if (sw) {
      sw.addEventListener("change", async () => {
        const v = sw.value;
        if (v === "__new__") {
          sw.value = CK.campaignId;
          CK.newCampaignDialog();
        } else if (v) {
          window.location.href = `/campaigns/${v}`;
        }
      });
    }
    const menu = document.getElementById("menu-toggle");
    const sidebar = document.getElementById("sidebar");
    if (menu && sidebar) {
      menu.addEventListener("click", () => sidebar.classList.toggle("open"));
      document.addEventListener("click", e => {
        if (sidebar.classList.contains("open") && !sidebar.contains(e.target) && e.target !== menu) sidebar.classList.remove("open");
      });
    }
    if (CK.campaignId) {
      try { localStorage.setItem("ck_last_campaign", CK.campaignId); localStorage.setItem("ck_last_campaign_name", CK.campaignName); } catch (_) {}
    }
  });

  /** "New Campaign" modal: only asks for a name and description. */
  CK.newCampaignDialog = function () {
    CK.modal({
      title: "New campaign",
      body: `<div class="stack">
        <label class="field"><span>Name</span><input type="text" id="nc-name" placeholder="e.g. The Verminous Hunt"></label>
        <label class="field"><span>Description</span><textarea id="nc-desc" placeholder="Optional"></textarea></label>
        <div class="hint">Starts with zero exorcists and sins. Add as many as the party needs.</div>
      </div>`,
      buttons: [
        { label: "Cancel" },
        { label: "Create", cls: "btn-accent", onClick: async m => {
          const name = m.querySelector("#nc-name").value.trim();
          if (!name) { CK.toast("A name is required", "error"); return false; }
          const c = await CK.api("POST", "/api/campaigns", { name, description: m.querySelector("#nc-desc").value });
          window.location.href = `/campaigns/${c.id}`;
        } },
      ],
      onOpen: m => m.querySelector("#nc-name").focus(),
    });
  };
})();
