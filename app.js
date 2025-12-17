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

// Simple toast feedback
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
  ctx.lineWidth =
