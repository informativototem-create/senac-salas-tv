// 1) Cole aqui o link CSV publicado (Arquivo → Publicar na Web → CSV)
const CSV_URL = "COLE_AQUI_O_LINK_CSV_PUBLICADO";

// 2) Ajuste esses nomes conforme o cabeçalho da sua planilha:
const COL = {
  sala: "SALA",
  status: "STATUS",
  local: "BLOCO",      // ou "LOCAL", "PISO", etc.
  curso: "CURSO",
  horario: "HORARIO",
  docente: "DOCENTE",
  obs: "OBS"
};

const els = {
  grid: document.getElementById("grid"),
  empty: document.getElementById("empty"),
  lastUpdated: document.getElementById("lastUpdated"),
  q: document.getElementById("q"),
  filterStatus: document.getElementById("filterStatus"),
  filterLocal: document.getElementById("filterLocal"),
  counters: document.getElementById("counters"),
  btnRefresh: document.getElementById("btnRefresh"),
  btnTV: document.getElementById("btnTV"),
};

let raw = [];

function isTVMode() {
  const url = new URL(location.href);
  return url.searchParams.get("mode") === "tv";
}

function applyTVMode(on) {
  const url = new URL(location.href);
  if (on) url.searchParams.set("mode", "tv");
  else url.searchParams.delete("mode");
  location.href = url.toString();
}

function badgeClasses(status) {
  const s = (status || "").toLowerCase();
  if (s.includes("livre")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (s.includes("ocup")) return "bg-rose-50 text-rose-700 border-rose-200";
  if (s.includes("manut") || s.includes("bloq")) return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

function normalize(v) {
  return (v ?? "").toString().trim();
}

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean))).sort((a,b)=>a.localeCompare(b,'pt-BR'));
}

function setSelectOptions(selectEl, values, placeholder) {
  const current = selectEl.value;
  selectEl.innerHTML = `<option value="">${placeholder}</option>` + values.map(v => `<option>${v}</option>`).join("");
  selectEl.value = current;
}

function renderCounters(rows) {
  const by = {};
  for (const r of rows) {
    const st = normalize(r[COL.status]) || "Sem status";
    by[st] = (by[st] || 0) + 1;
  }

  els.counters.innerHTML = Object.entries(by)
    .sort((a,b)=>b[1]-a[1])
    .map(([st, n]) => `
      <button class="px-3 py-2 rounded-2xl border bg-white hover:bg-slate-50 text-sm"
              data-status="${st}">
        <span class="font-medium">${st}</span>
        <span class="text-slate-500">• ${n}</span>
      </button>
    `).join("");

  els.counters.querySelectorAll("button[data-status]").forEach(btn => {
    btn.addEventListener("click", () => {
      els.filterStatus.value = btn.getAttribute("data-status");
      render();
    });
  });
}

function render() {
  const q = normalize(els.q.value).toLowerCase();
  const st = normalize(els.filterStatus.value);
  const loc = normalize(els.filterLocal.value);

  const rows = raw.filter(r => {
    const text = [
      r[COL.sala], r[COL.status], r[COL.local], r[COL.curso],
      r[COL.horario], r[COL.docente], r[COL.obs]
    ].map(normalize).join(" ").toLowerCase();

    const okQ = !q || text.includes(q);
    const okSt = !st || normalize(r[COL.status]) === st;
    const okLoc = !loc || normalize(r[COL.local]) === loc;

    return okQ && okSt && okLoc;
  });

  renderCounters(raw);

  els.grid.innerHTML = rows.map(r => {
    const sala = normalize(r[COL.sala]) || "—";
    const status = normalize(r[COL.status]) || "—";
    const local = normalize(r[COL.local]) || "—";
    const curso = normalize(r[COL.curso]) || "—";
    const horario = normalize(r[COL.horario]) || "";
    const docente = normalize(r[COL.docente]) || "";
    const obs = normalize(r[COL.obs]) || "";

    return `
      <article class="rounded-3xl border bg-white p-4 shadow-sm">
        <div class="flex items-start justify-between gap-3">
          <div>
            <div class="text-sm text-slate-500">${local}</div>
            <div class="text-2xl font-semibold">${sala}</div>
          </div>
          <div class="px-3 py-1.5 rounded-2xl border text-sm ${badgeClasses(status)}">${status}</div>
        </div>

        <div class="mt-3 space-y-2 text-sm">
          <div class="font-medium">${curso}</div>
          ${horario ? `<div class="text-slate-600">${horario}</div>` : ""}
          ${docente ? `<div class="text-slate-600">Docente: ${docente}</div>` : ""}
          ${obs ? `<div class="text-slate-500">${obs}</div>` : ""}
        </div>
      </article>
    `;
  }).join("");

  const empty = rows.length === 0;
  els.empty.classList.toggle("hidden", !empty);

  if (isTVMode()) {
    document.body.classList.add("text-lg");
    els.grid.className = "grid grid-cols-2 lg:grid-cols-4 gap-4";
  }
}

async function load() {
  if (!CSV_URL || CSV_URL.includes("COLE_AQUI")) {
    els.lastUpdated.textContent = "Falta configurar o link CSV (CSV_URL).";
    return;
  }

  els.lastUpdated.textContent = "Atualizando dados…";

  const res = await fetch(CSV_URL, { cache: "no-store" });
  const csv = await res.text();

  const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
  raw = parsed.data;

  // popula filtros
  setSelectOptions(
    els.filterStatus,
    uniq(raw.map(r => normalize(r[COL.status]))),
    "Status (todos)"
  );

  setSelectOptions(
    els.filterLocal,
    uniq(raw.map(r => normalize(r[COL.local]))),
    "Local/Bloco (todos)"
  );

  const now = new Date();
  els.lastUpdated.textContent = `Atualizado em ${now.toLocaleString("pt-BR")}`;

  render();
}

els.q.addEventListener("input", render);
els.filterStatus.addEventListener("change", render);
els.filterLocal.addEventListener("change", render);

els.btnRefresh.addEventListener("click", load);
els.btnTV.addEventListener("click", () => applyTVMode(!isTVMode()));

// Auto-refresh (ótimo pra TV / Totem)
setInterval(load, 60 * 1000);

load();
