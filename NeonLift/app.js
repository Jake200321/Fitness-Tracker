/* ===================================================================
   NeonLift — offline workout & bodyweight tracker (PWA)
   Pure vanilla JS. Data persists in localStorage on this device.
   =================================================================== */
(function () {
  "use strict";

  const STORE_KEY = "neonlift.v1";
  const KG_PER_LB = 0.45359237;

  const PALETTE = [
    "#00f0ff", "#ff2bd6", "#39ff14", "#ff9e2c", "#b14dff", "#f5ff3d",
    "#2cffd4", "#ff5c7a", "#7c8bff", "#ff7b2c"
  ];

  /* ---------- State ---------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function defaultState() {
    return {
      unit: "kg",
      exercises: [
        { id: uid(), name: "Bench Press",    color: "#00f0ff" },
        { id: uid(), name: "Military Press", color: "#ff2bd6" },
        { id: uid(), name: "Squat",          color: "#39ff14" },
        { id: uid(), name: "Deadlift",       color: "#ff9e2c" }
      ],
      // sessions: { id, exerciseId, date:'YYYY-MM-DD', weight, reps, sets }
      //   weight = working-set weight, reps = reps per set, sets = number of working sets
      sessions: [],
      // bodyweight: { id, date:'YYYY-MM-DD', weight }
      bodyweight: []
    };
  }

  // Convert any old set-array sessions into the working-set model
  function normalizeSession(s) {
    if (s && !Array.isArray(s.sets) && s.weight != null) return s; // already new format
    if (s && Array.isArray(s.sets)) {
      const w = s.sets.reduce((m, x) => Math.max(m, Number(x.weight) || 0), 0);
      const top = s.sets.find((x) => (Number(x.weight) || 0) === w) || s.sets[0] || {};
      return {
        id: s.id, exerciseId: s.exerciseId, date: s.date,
        weight: w, reps: Number(top.reps) || 5, sets: s.sets.length || 1
      };
    }
    return s;
  }

  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      // light migration / guards
      parsed.unit = parsed.unit || "kg";
      parsed.exercises = parsed.exercises || [];
      parsed.sessions = (parsed.sessions || []).map(normalizeSession);
      parsed.bodyweight = parsed.bodyweight || [];
      return parsed;
    } catch (e) {
      console.warn("Failed to load state, starting fresh", e);
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (e) {
      // private mode / quota — keep running in-memory for this session
      console.warn("Could not persist data", e);
    }
  }

  /* ---------- Helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const todayISO = () => {
    const d = new Date();
    const off = d.getTimezoneOffset();
    return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
  };

  function fmtNum(n) {
    if (n == null || isNaN(n)) return "—";
    return (Math.round(n * 10) / 10).toString().replace(/\.0$/, "");
  }

  function fmtDate(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function fmtDateLong(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  // working-set weight drives every progress graph
  const topSet = (session) => Number(session.weight) || 0;

  function sessionsFor(exId) {
    return state.sessions
      .filter((s) => s.exerciseId === exId)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }

  /* ===================================================================
     CHART ENGINE — neon SVG line charts (no dependencies)
     =================================================================== */
  function lineChart(points, color, opts) {
    // points: [{ t:Number(ms), v:Number, label:String }]  (sorted asc)
    opts = opts || {};
    const W = opts.w || 340;
    const H = opts.h || 190;
    const padL = opts.mini ? 4 : 34;
    const padR = opts.mini ? 4 : 14;
    const padT = opts.mini ? 6 : 14;
    const padB = opts.mini ? 6 : 26;
    const gid = "g" + uid();

    if (!points.length) {
      return `<div class="chart-empty">No data yet.<br>Log a session to see your line light up.</div>`;
    }

    const xs = points.map((p) => p.t);
    const ys = points.map((p) => p.v);
    let minX = Math.min(...xs), maxX = Math.max(...xs);
    let minY = Math.min(...ys), maxY = Math.max(...ys);

    // pad Y range
    if (minY === maxY) { minY -= 1; maxY += 1; }
    const yPad = (maxY - minY) * 0.18;
    minY -= yPad; maxY += yPad;
    if (minX === maxX) { minX -= 1; maxX += 1; }

    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const sx = (t) => padL + ((t - minX) / (maxX - minX)) * plotW;
    const sy = (v) => padT + (1 - (v - minY) / (maxY - minY)) * plotH;

    const pts = points.map((p) => ({ x: sx(p.t), y: sy(p.v), v: p.v, label: p.label }));

    // smooth path (Catmull-Rom -> bezier)
    const linePath = smoothPath(pts);
    const areaPath =
      linePath +
      ` L ${pts[pts.length - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)}` +
      ` L ${pts[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`;

    // gridlines + y labels (non-mini)
    let grid = "";
    if (!opts.mini) {
      const ticks = 3;
      for (let i = 0; i <= ticks; i++) {
        const val = minY + ((maxY - minY) * i) / ticks;
        const y = sy(val);
        grid += `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}" stroke="#232743" stroke-width="1" />`;
        grid += `<text x="${padL - 6}" y="${(y + 3).toFixed(1)}" text-anchor="end" fill="#5c6088" font-size="10">${fmtNum(val)}</text>`;
      }
      // x labels: first + last
      grid += `<text x="${pts[0].x.toFixed(1)}" y="${H - 8}" text-anchor="start" fill="#5c6088" font-size="10">${points[0].label}</text>`;
      if (points.length > 1) {
        grid += `<text x="${pts[pts.length - 1].x.toFixed(1)}" y="${H - 8}" text-anchor="end" fill="#5c6088" font-size="10">${points[points.length - 1].label}</text>`;
      }
    }

    // dots
    let dots = "";
    pts.forEach((p, i) => {
      const last = i === pts.length - 1;
      const r = opts.mini ? (last ? 3 : 0) : last ? 5 : 3.2;
      if (r > 0) {
        dots += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${color}" filter="url(#${gid}-glow)" />`;
        if (last && !opts.mini) {
          dots += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r + 3}" fill="none" stroke="${color}" stroke-width="1.5" opacity="0.5" />`;
        }
      }
    });

    return `
<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img">
  <defs>
    <linearGradient id="${gid}-fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="${opts.mini ? 0.28 : 0.34}" />
      <stop offset="100%" stop-color="${color}" stop-opacity="0" />
    </linearGradient>
    <filter id="${gid}-glow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="${opts.mini ? 2 : 3.4}" result="b" />
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  ${grid}
  <path d="${areaPath}" fill="url(#${gid}-fill)" stroke="none" />
  <path d="${linePath}" fill="none" stroke="${color}" stroke-width="${opts.mini ? 2.2 : 2.6}"
        stroke-linecap="round" stroke-linejoin="round" filter="url(#${gid}-glow)" />
  ${dots}
</svg>`;
  }

  function smoothPath(pts) {
    if (pts.length === 1) {
      const p = pts[0];
      return `M ${(p.x - 0.5).toFixed(1)} ${p.y.toFixed(1)} L ${(p.x + 0.5).toFixed(1)} ${p.y.toFixed(1)}`;
    }
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[i + 2] || p2;
      const t = 0.16;
      const c1x = p1.x + (p2.x - p0.x) * t;
      const c1y = p1.y + (p2.y - p0.y) * t;
      const c2x = p2.x - (p3.x - p1.x) * t;
      const c2y = p2.y - (p3.y - p1.y) * t;
      d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  }

  const isoToMs = (iso) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  };

  /* ===================================================================
     RENDER — Home
     =================================================================== */
  function render() {
    $(".unit-lbl") && $$(".unit-lbl").forEach((e) => (e.textContent = state.unit));
    $("#bw-unit").textContent = state.unit;
    renderBodyweight();
    renderExercises();
  }

  function renderBodyweight() {
    const bw = state.bodyweight.slice().sort((a, b) => a.date.localeCompare(b.date));
    const curEl = $("#bw-current");
    const deltaEl = $("#bw-delta");
    const spark = $("#bw-spark");

    if (!bw.length) {
      curEl.textContent = "—";
      deltaEl.textContent = "";
      deltaEl.className = "bw-delta";
      spark.innerHTML = `<div class="ex-empty" style="padding-top:18px">Tap + Log to record your weight.</div>`;
      return;
    }
    const latest = bw[bw.length - 1];
    curEl.textContent = fmtNum(latest.weight);

    if (bw.length > 1) {
      const prev = bw[bw.length - 2];
      const diff = latest.weight - prev.weight;
      const sign = diff > 0 ? "+" : "";
      deltaEl.textContent = `${sign}${fmtNum(diff)} ${state.unit} since ${fmtDate(prev.date)}`;
      deltaEl.className = "bw-delta " + (diff > 0 ? "up" : diff < 0 ? "down" : "");
    } else {
      deltaEl.textContent = `Logged ${fmtDate(latest.date)}`;
      deltaEl.className = "bw-delta";
    }

    const pts = bw.map((b) => ({ t: isoToMs(b.date), v: b.weight, label: fmtDate(b.date) }));
    spark.innerHTML = lineChart(pts, "#39ff14", { mini: true, w: 480, h: 64 });
  }

  function renderExercises() {
    const list = $("#exercise-list");
    if (!state.exercises.length) {
      list.innerHTML = `<p class="ex-empty">No exercises yet. Tap “+ Add” to create one.</p>`;
      return;
    }
    list.innerHTML = state.exercises
      .map((ex) => {
        const s = sessionsFor(ex.id);
        let meta, spark;
        if (s.length) {
          const last = s[s.length - 1];
          const best = Math.max(...s.map(topSet));
          meta = `<p class="ex-meta">Last <b>${fmtNum(topSet(last))} ${state.unit}</b> · Best <b>${fmtNum(best)}</b> · ${s.length} session${s.length > 1 ? "s" : ""}</p>`;
          const pts = s.map((x) => ({ t: isoToMs(x.date), v: topSet(x), label: fmtDate(x.date) }));
          spark = lineChart(pts, ex.color, { mini: true, w: 120, h: 46 });
        } else {
          meta = `<p class="ex-meta">No sessions yet</p>`;
          spark = `<div class="ex-empty" style="text-align:right">—</div>`;
        }
        return `
        <article class="ex-card" data-ex="${ex.id}" style="border-left-color:${ex.color}">
          <div>
            <p class="ex-name">${escapeHtml(ex.name)}</p>
            ${meta}
          </div>
          <div class="mini-spark">${spark}</div>
        </article>`;
      })
      .join("");
  }

  /* ===================================================================
     RENDER — Detail
     =================================================================== */
  let currentExId = null;

  function openDetail(exId) {
    currentExId = exId;
    const ex = state.exercises.find((e) => e.id === exId);
    if (!ex) return;
    $("#detail-title").textContent = ex.name;
    $("#detail-title").style.color = ex.color;

    const s = sessionsFor(exId);
    const chart = $("#detail-chart");
    const best = $("#detail-best");

    if (s.length) {
      const bestVal = Math.max(...s.map(topSet));
      best.innerHTML = `Best <b>${fmtNum(bestVal)} ${state.unit}</b>`;
      const pts = s.map((x) => ({ t: isoToMs(x.date), v: topSet(x), label: fmtDate(x.date) }));
      chart.innerHTML = lineChart(pts, ex.color, { w: 360, h: 200 });
    } else {
      best.innerHTML = "";
      chart.innerHTML = lineChart([], ex.color, {});
    }

    renderHistory(exId, ex.color);
    showView("detail");
  }

  function renderHistory(exId, color) {
    const list = $("#history-list");
    const s = sessionsFor(exId).slice().reverse(); // newest first
    if (!s.length) {
      list.innerHTML = `<p class="ex-empty">No sessions logged yet.</p>`;
      return;
    }
    list.innerHTML = s
      .map((sess) => `
        <div class="hist-row" data-session="${sess.id}">
          <div class="hist-top">
            <span class="hist-date" style="color:${color}">${fmtDateLong(sess.date)}</span>
            <button class="hist-del" data-del-session="${sess.id}" aria-label="Delete">✕</button>
          </div>
          <div class="hist-work">
            <b>${fmtNum(sess.weight)}</b> ${state.unit}<span class="x">×</span><b>${sess.reps}</b><span class="colon">:</span><b>${sess.sets}</b> set${sess.sets > 1 ? "s" : ""}
          </div>
        </div>`)
      .join("");
  }

  /* ===================================================================
     VIEW SWITCHING
     =================================================================== */
  function showView(name) {
    $$(".view").forEach((v) => v.classList.remove("active"));
    $("#view-" + name).classList.add("active");
    window.scrollTo(0, 0);
  }

  /* ===================================================================
     MODALS
     =================================================================== */
  function openModal(id) {
    $("#modal-backdrop").classList.add("show");
    $("#" + id).classList.add("show");
  }
  function closeModals() {
    $("#modal-backdrop").classList.remove("show");
    $$(".modal").forEach((m) => m.classList.remove("show"));
  }

  /* ----- Session modal ----- */
  let sessionExId = null;

  function updateWorkPreview() {
    const w = parseFloat($("#in-weight").value);
    const r = parseInt($("#in-reps").value, 10);
    const s = parseInt($("#in-sets").value, 10);
    const el = $("#work-preview");
    if (!isNaN(w) && w > 0 && !isNaN(r) && r > 0 && !isNaN(s) && s > 0) {
      el.innerHTML = `<b>${fmtNum(w)}</b> ${state.unit} × <b>${r}</b> : <b>${s}</b> set${s > 1 ? "s" : ""}`;
    } else {
      el.textContent = "Enter your working set";
    }
  }

  function openSessionModal(exId) {
    sessionExId = exId;
    const ex = state.exercises.find((e) => e.id === exId);
    $("#session-modal-title").textContent = "Log " + ex.name;
    $("#session-date").value = todayISO();
    const prev = sessionsFor(exId).slice(-1)[0]; // prefill from last session
    $("#in-weight").value = prev ? fmtNum(prev.weight) : "";
    $("#in-reps").value = prev ? prev.reps : 5;
    $("#in-sets").value = prev ? prev.sets : 3;
    updateWorkPreview();
    openModal("modal-session");
  }

  function saveSession() {
    const date = $("#session-date").value || todayISO();
    const weight = parseFloat($("#in-weight").value);
    const reps = parseInt($("#in-reps").value, 10);
    const sets = parseInt($("#in-sets").value, 10);
    if (isNaN(weight) || weight <= 0) { toast("Enter a working weight"); return; }
    if (isNaN(reps) || reps <= 0) { toast("Enter reps"); return; }
    if (isNaN(sets) || sets <= 0) { toast("Enter number of sets"); return; }
    state.sessions.push({ id: uid(), exerciseId: sessionExId, date, weight, reps, sets });
    save();
    closeModals();
    toast("Session saved");
    render();
    if (currentExId === sessionExId && $("#view-detail").classList.contains("active")) {
      openDetail(sessionExId);
    }
  }

  function wireSteppers() {
    $$("#modal-session .stepper").forEach((st) => {
      const step = parseFloat(st.dataset.step) || 1;
      const min = st.dataset.min != null ? parseFloat(st.dataset.min) : -Infinity;
      const input = st.querySelector("input");
      const bump = (delta) => {
        let v = parseFloat(input.value);
        if (isNaN(v)) v = parseFloat(input.placeholder) || 0;
        v = Math.round((v + delta) * 100) / 100;
        if (v < min) v = min;
        input.value = fmtNum(v);
        updateWorkPreview();
      };
      st.querySelector(".inc").addEventListener("click", () => bump(step));
      st.querySelector(".dec").addEventListener("click", () => bump(-step));
      input.addEventListener("input", updateWorkPreview);
    });
  }

  /* ----- Bodyweight modal ----- */
  function openBwModal() {
    $("#bw-date").value = todayISO();
    $("#bw-input").value = "";
    openModal("modal-bw");
    setTimeout(() => $("#bw-input").focus(), 300);
  }
  function saveBw() {
    const date = $("#bw-date").value || todayISO();
    const w = parseFloat($("#bw-input").value);
    if (isNaN(w) || w <= 0) {
      toast("Enter a valid weight");
      return;
    }
    // one entry per day — replace if exists
    const existing = state.bodyweight.find((b) => b.date === date);
    if (existing) existing.weight = w;
    else state.bodyweight.push({ id: uid(), date, weight: w });
    save();
    closeModals();
    toast("Weight logged");
    renderBodyweight();
  }

  /* ----- Exercise modal (add/edit) ----- */
  let editingExId = null;
  let pickedColor = PALETTE[0];

  function renderSwatches() {
    const wrap = $("#ex-swatches");
    wrap.innerHTML = PALETTE.map(
      (c) => `<div class="swatch${c === pickedColor ? " sel" : ""}" data-color="${c}" style="background:${c};box-shadow:0 0 10px ${c}"></div>`
    ).join("");
    $$(".swatch", wrap).forEach((sw) =>
      sw.addEventListener("click", () => {
        pickedColor = sw.dataset.color;
        renderSwatches();
      })
    );
  }

  function openExModal(exId) {
    editingExId = exId || null;
    if (exId) {
      const ex = state.exercises.find((e) => e.id === exId);
      $("#ex-modal-title").textContent = "Edit exercise";
      $("#ex-name").value = ex.name;
      pickedColor = ex.color;
      $("#delete-ex-btn").hidden = false;
    } else {
      $("#ex-modal-title").textContent = "Add exercise";
      $("#ex-name").value = "";
      pickedColor = PALETTE[state.exercises.length % PALETTE.length];
      $("#delete-ex-btn").hidden = true;
    }
    renderSwatches();
    openModal("modal-ex");
  }

  function saveEx() {
    const name = $("#ex-name").value.trim();
    if (!name) {
      toast("Enter a name");
      return;
    }
    if (editingExId) {
      const ex = state.exercises.find((e) => e.id === editingExId);
      ex.name = name;
      ex.color = pickedColor;
    } else {
      state.exercises.push({ id: uid(), name, color: pickedColor });
    }
    save();
    closeModals();
    render();
    if (editingExId && $("#view-detail").classList.contains("active")) openDetail(editingExId);
    toast(editingExId ? "Exercise updated" : "Exercise added");
  }

  function deleteEx() {
    if (!editingExId) return;
    const ex = state.exercises.find((e) => e.id === editingExId);
    if (!confirm(`Delete “${ex.name}” and all its sessions?`)) return;
    state.exercises = state.exercises.filter((e) => e.id !== editingExId);
    state.sessions = state.sessions.filter((s) => s.exerciseId !== editingExId);
    save();
    closeModals();
    render();
    showView("home");
    toast("Exercise deleted");
  }

  /* ----- Settings ----- */
  function setUnit(newUnit) {
    if (newUnit === state.unit) return;
    const factor = newUnit === "lbs" ? 1 / KG_PER_LB : KG_PER_LB;
    state.sessions.forEach((s) =>
      s.sets.forEach((st) => (st.weight = Math.round(st.weight * factor * 10) / 10))
    );
    state.bodyweight.forEach((b) => (b.weight = Math.round(b.weight * factor * 10) / 10));
    state.unit = newUnit;
    save();
    $$("#unit-seg button").forEach((b) => b.classList.toggle("active", b.dataset.unit === newUnit));
    render();
    toast("Converted to " + newUnit);
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `neonlift-backup-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Backup downloaded");
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.exercises || !data.sessions) throw new Error("bad file");
        state = data;
        state.bodyweight = state.bodyweight || [];
        save();
        closeModals();
        render();
        showView("home");
        toast("Data imported");
      } catch (e) {
        toast("Invalid backup file");
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!confirm("Erase ALL data and start over? This cannot be undone.")) return;
    state = defaultState();
    save();
    closeModals();
    render();
    showView("home");
    toast("All data erased");
  }

  /* ----- Toast ----- */
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  /* ===================================================================
     EVENT WIRING
     =================================================================== */
  function wire() {
    // home actions
    $("#log-bw-btn").addEventListener("click", openBwModal);
    $("#bw-card").addEventListener("click", (e) => {
      if (e.target.closest("#log-bw-btn")) return;
      // tapping card body also logs (nice for quick entry)
    });
    $("#add-ex-btn").addEventListener("click", () => openExModal(null));
    $("#settings-btn").addEventListener("click", () => openModal("modal-settings"));

    // exercise list delegation
    $("#exercise-list").addEventListener("click", (e) => {
      const card = e.target.closest(".ex-card");
      if (card) openDetail(card.dataset.ex);
    });

    // detail
    $("#back-btn").addEventListener("click", () => showView("home"));
    $("#ex-menu-btn").addEventListener("click", () => openExModal(currentExId));
    $("#log-session-btn").addEventListener("click", () => openSessionModal(currentExId));
    $("#history-list").addEventListener("click", (e) => {
      const del = e.target.closest("[data-del-session]");
      if (del) {
        e.stopPropagation();
        const id = del.dataset.delSession;
        if (confirm("Delete this session?")) {
          state.sessions = state.sessions.filter((s) => s.id !== id);
          save();
          render();
          openDetail(currentExId);
          toast("Session deleted");
        }
      }
    });

    // session modal
    wireSteppers();
    $("#save-session-btn").addEventListener("click", saveSession);

    // bw modal
    $("#save-bw-btn").addEventListener("click", saveBw);

    // ex modal
    $("#save-ex-btn").addEventListener("click", saveEx);
    $("#delete-ex-btn").addEventListener("click", deleteEx);

    // settings
    $$("#unit-seg button").forEach((b) =>
      b.addEventListener("click", () => setUnit(b.dataset.unit))
    );
    $("#export-btn").addEventListener("click", exportData);
    $("#import-btn").addEventListener("click", () => $("#import-file").click());
    $("#import-file").addEventListener("change", (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
    });
    $("#reset-btn").addEventListener("click", resetAll);

    // generic close
    $("#modal-backdrop").addEventListener("click", closeModals);
    $$("[data-close]").forEach((b) => b.addEventListener("click", closeModals));

    // init unit seg
    $$("#unit-seg button").forEach((b) => b.classList.toggle("active", b.dataset.unit === state.unit));
  }

  /* ===================================================================
     SERVICE WORKER
     =================================================================== */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  /* ---------- Go ---------- */
  wire();
  render();
})();
