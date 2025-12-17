// Theme Toggle 
const themeBtn = document.getElementById("themeToggle");

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("vitalstream_theme", theme);
  if (themeBtn) themeBtn.textContent = theme === "dark" ? "☀️ Light" : "🌙 Dark";
}

(function initTheme() {
  const saved = localStorage.getItem("vitalstream_theme");
  if (saved === "light" || saved === "dark") setTheme(saved);
  else setTheme("light"); // default light
})();

if (themeBtn) {
  themeBtn.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme || "light";
    setTheme(current === "dark" ? "light" : "dark");
  });
}

// Utilities
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function nowMs() { return Date.now(); }
function fmtTime(ms) {
  const d = new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
// Normal-ish noise (Box–Muller)
function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Simple toast feedback (INFO310: immediate feedback)
const toastEl = document.getElementById("toast");
let toastTimer = null;
function toast(msg) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.textContent = ""; }, 2500);
}

// DS: RingBuffer (Queue)
class RingBuffer {
  constructor(capacity) {
    this.capacity = capacity;
    this.arr = new Array(capacity);
    this.head = 0; // index of oldest
    this.size = 0;
  }
  push(x) {
    const idx = (this.head + this.size) % this.capacity;
    this.arr[idx] = x;
    if (this.size < this.capacity) this.size++;
    else this.head = (this.head + 1) % this.capacity; // overwrite oldest
  }
  toArray() {
    const out = [];
    for (let i = 0; i < this.size; i++) {
      out.push(this.arr[(this.head + i) % this.capacity]);
    }
    return out;
  }
  last() {
    if (this.size === 0) return null;
    return this.arr[(this.head + this.size - 1) % this.capacity];
  }
}

// DS: Stack (Undo)
class Stack {
  constructor() { this.arr = []; }
  push(x) { this.arr.push(x); }
  pop() { return this.arr.length ? this.arr.pop() : null; }
  isEmpty() { return this.arr.length === 0; }
}

// DS: PriorityQueue (Binary Heap)
class PriorityQueue {
  // compare: return <0 if a higher priority than b
  constructor(compareFn) {
    this.heap = [];
    this.compare = compareFn || ((a, b) => a.priority - b.priority || a.ts - b.ts);
  }
  isEmpty() { return this.heap.length === 0; }
  push(item) {
    this.heap.push(item);
    this._siftUp(this.heap.length - 1);
  }
  pop() {
    if (this.heap.length === 0) return null;
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length && last) {
      this.heap[0] = last;
      this._siftDown(0);
    }
    return top;
  }
  _siftUp(i) {
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.compare(this.heap[i], this.heap[p]) < 0) {
        [this.heap[i], this.heap[p]] = [this.heap[p], this.heap[i]];
        i = p;
      } else break;
    }
  }
  _siftDown(i) {
    const n = this.heap.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let best = i;
      if (l < n && this.compare(this.heap[l], this.heap[best]) < 0) best = l;
      if (r < n && this.compare(this.heap[r], this.heap[best]) < 0) best = r;
      if (best !== i) {
        [this.heap[i], this.heap[best]] = [this.heap[best], this.heap[i]];
        i = best;
      } else break;
    }
  }
  toSortedArray(limit = 12) {
    const copy = new PriorityQueue(this.compare);
    copy.heap = this.heap.slice();
    const out = [];
    while (!copy.isEmpty() && out.length < limit) out.push(copy.pop());
    return out;
  }
}

// DS: HashTable (Chaining)
class SimpleHashTable {
  constructor(bucketCount = 53) {
    this.buckets = Array.from({ length: bucketCount }, () => []);
  }
  _hash(key) {
    const s = String(key);
    let h = 5381;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) + h) + s.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h) % this.buckets.length;
  }
  set(key, value) {
    const idx = this._hash(key);
    const bucket = this.buckets[idx];
    for (const pair of bucket) {
      if (pair[0] === key) { pair[1] = value; return; }
    }
    bucket.push([key, value]);
  }
  get(key) {
    const idx = this._hash(key);
    for (const [k, v] of this.buckets[idx]) if (k === key) return v;
    return undefined;
  }
  keys() {
    const out = [];
    for (const b of this.buckets) for (const [k] of b) out.push(k);
    return out;
  }
}

// Domain Model
class PatientState {
  constructor(id, label, baseline) {
    this.id = id;
    this.label = label;
    this.baseline = baseline;

    this.hr = new RingBuffer(60);
    this.spo2 = new RingBuffer(60);
    this.temp = new RingBuffer(60);

    this.eventActiveUntil = 0;
  }
}

function defaultRules() {
  return {
    hrHigh: 120,
    hrCritical: 150,
    spo2Low: 92,
    spo2Critical: 86,
    tempHigh: 100.4,
    tempCritical: 102.0
  };
}

function loadRules() {
  try {
    const raw = localStorage.getItem("vitalstream_rules");
    if (!raw) return defaultRules();
    const parsed = JSON.parse(raw);
    const r = defaultRules();
    for (const k of Object.keys(r)) if (parsed[k] != null) r[k] = parsed[k];
    return r;
  } catch {
    return defaultRules();
  }
}

function saveRulesToStorage(rules) {
  localStorage.setItem("vitalstream_rules", JSON.stringify(rules));
}

// Simulation
function generateVitals(patient, tMs) {
  const inEvent = tMs < patient.eventActiveUntil;
  const event = inEvent ? { hr: +40, spo2: -8, temp: +1.6 } : { hr: 0, spo2: 0, temp: 0 };

  const hr = clamp(patient.baseline.hr + event.hr + randn() * 3, 45, 210);
  const spo2 = clamp(patient.baseline.spo2 + event.spo2 + randn() * 0.6, 70, 100);
  const temp = clamp(patient.baseline.temp + event.temp + randn() * 0.12, 95, 106);

  return { hr, spo2, temp, inEvent };
}

// Alerts (rules evaluation) 
function evaluateRules(rules, sample, patientId) {
  const alerts = [];

  // priority: 1 critical, 2 warn (lower = higher priority)
  if (sample.hr >= rules.hrCritical) {
    alerts.push({ priority: 1, type: "HR", msg: `Critical HR: ${sample.hr.toFixed(0)} bpm (≥ ${rules.hrCritical})`, patientId });
  } else if (sample.hr >= rules.hrHigh) {
    alerts.push({ priority: 2, type: "HR", msg: `High HR: ${sample.hr.toFixed(0)} bpm (≥ ${rules.hrHigh})`, patientId });
  }

  if (sample.spo2 <= rules.spo2Critical) {
    alerts.push({ priority: 1, type: "SpO₂", msg: `Critical SpO₂: ${sample.spo2.toFixed(0)}% (≤ ${rules.spo2Critical})`, patientId });
  } else if (sample.spo2 <= rules.spo2Low) {
    alerts.push({ priority: 2, type: "SpO₂", msg: `Low SpO₂: ${sample.spo2.toFixed(0)}% (≤ ${rules.spo2Low})`, patientId });
  }

  if (sample.temp >= rules.tempCritical) {
    alerts.push({ priority: 1, type: "Temp", msg: `Critical Fever: ${sample.temp.toFixed(1)}°F (≥ ${rules.tempCritical})`, patientId });
  } else if (sample.temp >= rules.tempHigh) {
    alerts.push({ priority: 2, type: "Temp", msg: `Fever: ${sample.temp.toFixed(1)}°F (≥ ${rules.tempHigh})`, patientId });
  }

  return alerts;
}

// Charts (Canvas)
function drawLineChart(canvas, series, opts) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  // grid
  ctx.strokeStyle = "rgba(120,120,120,0.25)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 5; i++) {
    const y = (h * i) / 5;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }

  // label
  ctx.fillStyle = "rgba(120,120,120,0.9)";
  ctx.font = "12px ui-monospace, Menlo, monospace";
  ctx.fillText(opts.label, 10, 18);

  if (!series || series.length < 2) return;

  const minY = opts.minY, maxY = opts.maxY;
  const pad = 10;
  const xStep = (w - pad * 2) / (series.length - 1);

  // line
  ctx.strokeStyle = "rgba(37,99,235,0.9)";
  if (document.documentElement.dataset.theme === "dark") {
    ctx.strokeStyle = "rgba(96,165,250,0.95)";
  }
  ctx.lineWidth = 2;

  ctx.beginPath();
  for (let i = 0; i < series.length; i++) {
    const x = pad + i * xStep;
    const yNorm = (series[i] - minY) / (maxY - minY);
    const y = h - pad - yNorm * (h - pad * 2);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// App State 
const patients = new SimpleHashTable();
patients.set("P1", new PatientState("P1", "Patient A", { hr: 78, spo2: 96, temp: 98.6 }));
patients.set("P2", new PatientState("P2", "Patient B", { hr: 82, spo2: 97, temp: 98.8 }));
patients.set("P3", new PatientState("P3", "Patient C", { hr: 72, spo2: 98, temp: 98.4 }));

let selectedPatientId = "P1";
let rules = loadRules();
const undo = new Stack();

let timer = null;
let runLog = [];
let metrics = { total: 0, tp: 0, fp: 0 };

// alert history + PQ
let alertHistory = []; // keep last N seconds
let alertPQ = new PriorityQueue();

// DOM
const patientSelect = document.getElementById("patientSelect");
const liveVitals = document.getElementById("liveVitals");
const alertsEl = document.getElementById("alerts");

const mTotal = document.getElementById("mTotal");
const mTP = document.getElementById("mTP");
const mFP = document.getElementById("mFP");

const btnStart = document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");
const btnInject = document.getElementById("btnInject");
const btnUndo = document.getElementById("btnUndo");
const btnSaveRules = document.getElementById("btnSaveRules");
const btnExport = document.getElementById("btnExport");

const canvasHR = document.getElementById("chartHR");
const canvasSPO2 = document.getElementById("chartSPO2");
const canvasTEMP = document.getElementById("chartTEMP");

function getPatient() { return patients.get(selectedPatientId); }

// UI Helpers
function syncRuleInputs() {
  const map = [
    ["hrHigh", "hrHigh", "int"],
    ["hrCritical", "hrCritical", "int"],
    ["spo2Low", "spo2Low", "int"],
    ["spo2Critical", "spo2Critical", "int"],
    ["tempHigh", "tempHigh", "float"],
    ["tempCritical", "tempCritical", "float"],
  ];
  for (const [id, key] of map) {
    const el = document.getElementById(id);
    if (el) el.value = rules[key];
  }
}

function bindRuleInputs() {
  const bind = (id, key, type) => {
    const el = document.getElementById(id);
    if (!el) return;

    el.addEventListener("change", () => {
      undo.push({ ...rules }); // stack snapshot
      rules[key] = type === "float" ? parseFloat(el.value) : parseInt(el.value, 10);
      toast("Rule updated (Undo available).");
      renderAll();
    });
  };

  bind("hrHigh", "hrHigh", "int");
  bind("hrCritical", "hrCritical", "int");
  bind("spo2Low", "spo2Low", "int");
  bind("spo2Critical", "spo2Critical", "int");
  bind("tempHigh", "tempHigh", "float");
  bind("tempCritical", "tempCritical", "float");
}

function renderVitals() {
  const p = getPatient();
  const lastHR = p.hr.last();
  const lastS = p.spo2.last();
  const lastT = p.temp.last();
  const eventActive = nowMs() < p.eventActiveUntil;

  liveVitals.innerHTML = `
    <div class="item"><div class="label">HR</div><div class="val">${lastHR ? lastHR.toFixed(0) : "—"} bpm</div></div>
    <div class="item"><div class="label">SpO₂</div><div class="val">${lastS ? lastS.toFixed(0) : "—"} %</div></div>
    <div class="item"><div class="label">Temp</div><div class="val">${lastT ? lastT.toFixed(1) : "—"} °F</div></div>
    <div class="item"><div class="label">Event</div><div class="val">${eventActive ? "ACTIVE" : "none"}</div></div>
  `;
}

function renderCharts() {
  const p = getPatient();
  drawLineChart(canvasHR, p.hr.toArray(), { minY: 40, maxY: 200, label: "Heart Rate (bpm)" });
  drawLineChart(canvasSPO2, p.spo2.toArray(), { minY: 75, maxY: 100, label: "SpO₂ (%)" });
  drawLineChart(canvasTEMP, p.temp.toArray(), { minY: 96, maxY: 104, label: "Temp (°F)" });
}

function rebuildAlertPQ() {
  alertPQ = new PriorityQueue();
  for (const a of alertHistory) alertPQ.push(a);
}

function renderAlerts() {
  alertsEl.innerHTML = "";

  const top = alertPQ.toSortedArray(12);
  if (top.length === 0) {
    const empty = document.createElement("div");
    empty.className = "muted small";
    empty.textContent = "No alerts yet. Click Start, or Inject Event, or lower thresholds.";
    alertsEl.appendChild(empty);
    return;
  }

  for (const a of top) {
    const div = document.createElement("div");
    div.className = "alert";
    const badgeClass = a.priority === 1 ? "critical" : "warn";
    const badgeLabel = a.priority === 1 ? "CRITICAL" : "WARN";

    div.innerHTML = `
      <div class="top">
        <div>${a.patientId} • ${a.type}</div>
        <div class="badge ${badgeClass}">${badgeLabel}</div>
      </div>
      <div class="msg">${a.msg}</div>
      <div class="meta">time ${fmtTime(a.ts)} • ${a.inEvent ? "true event" : "no event"}</div>
    `;
    alertsEl.appendChild(div);
  }
}

function renderMetrics() {
  mTotal.textContent = String(metrics.total);
  mTP.textContent = String(metrics.tp);
  mFP.textContent = String(metrics.fp);
}

function renderAll() {
  renderVitals();
  renderCharts();
  renderAlerts();
  renderMetrics();
}

// Controls
function start() {
  if (timer) return;
  timer = setInterval(tick, 1000);
  toast("Streaming started.");
  tick();
}
function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
  toast("Streaming stopped.");
}

function injectEvent() {
  const p = getPatient();
  p.eventActiveUntil = nowMs() + 25_000;
  toast(`Injected event for ${p.label} (25s).`);
  renderAll();
}

function undoRules() {
  const prev = undo.pop();
  if (!prev) { toast("Nothing to undo."); return; }
  rules = prev;
  syncRuleInputs();
  toast("Undo applied.");
  renderAll();
}

function saveRules() {
  saveRulesToStorage(rules);
  toast("Rules saved.");
}

function exportCSV() {
  if (runLog.length === 0) {
    toast("Nothing to export yet. Click Start first.");
    return;
  }
  const header = ["ts","time","patientId","hr","spo2","temp","inEvent","alertCount"].join(",");
  const rows = runLog.map(r => [
    r.ts,
    `"${fmtTime(r.ts)}"`,
    r.patientId,
    r.hr.toFixed(2),
    r.spo2.toFixed(2),
    r.temp.toFixed(2),
    r.inEvent ? 1 : 0,
    r.alertCount
  ].join(","));
  const csv = [header, ...rows].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vitalstream_run_${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("CSV exported.");
}

// Main Tick
function tick() {
  const t = nowMs();

  // keep last 2 minutes of alerts
  const ALERT_WINDOW_MS = 2 * 60 * 1000;

  for (const id of patients.keys()) {
    const p = patients.get(id);
    const s = generateVitals(p, t);

    p.hr.push(s.hr);
    p.spo2.push(s.spo2);
    p.temp.push(s.temp);

    const found = evaluateRules(rules, s, id);
    for (const a of found) {
      const alert = {
        ...a,
        ts: t,
        id: `${t}-${Math.random().toString(16).slice(2)}`,
        inEvent: s.inEvent
      };
      alertHistory.push(alert);

      metrics.total += 1;
      if (s.inEvent) metrics.tp += 1;
      else metrics.fp += 1;
    }

    runLog.push({
      ts: t,
      patientId: id,
      hr: s.hr,
      spo2: s.spo2,
      temp: s.temp,
      inEvent: s.inEvent,
      alertCount: found.length
    });
  }

  // trim alert history + rebuild PQ
  alertHistory = alertHistory.filter(a => (t - a.ts) <= ALERT_WINDOW_MS);
  rebuildAlertPQ();

  // trim run log to last ~20 minutes to avoid huge memory
  const RUN_WINDOW = 20 * 60;
  if (runLog.length > RUN_WINDOW * 3) runLog = runLog.slice(-RUN_WINDOW * 3);

  renderAll();
}

// Mount
function mount() {
  // patient select from hash table
  patientSelect.innerHTML = "";
  for (const id of patients.keys()) {
    const p = patients.get(id);
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = `${p.label} (${id})`;
    patientSelect.appendChild(opt);
  }
  patientSelect.value = selectedPatientId;
  patientSelect.addEventListener("change", () => {
    selectedPatientId = patientSelect.value;
    toast(`Viewing ${patients.get(selectedPatientId).label}.`);
    renderAll();
  });

  bindRuleInputs();
  syncRuleInputs();

  btnStart.addEventListener("click", start);
  btnStop.addEventListener("click", stop);
  btnInject.addEventListener("click", injectEvent);

  btnUndo.addEventListener("click", undoRules);
  btnSaveRules.addEventListener("click", saveRules);
  btnExport.addEventListener("click", exportCSV);

  // initial render
  renderAll();
}

window.addEventListener("DOMContentLoaded", mount);
