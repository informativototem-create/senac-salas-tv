// =====================
// CONFIG
// =====================
const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQLR82lwtLhKVZNboLfA7kqJ5NPHhvTZ-sQWQGLrLT6IQo5GhJ4DfAjjlJsahl0-nqlZO8tpJuHE_VG/pub?gid=356224596&single=true&output=csv";

// Auto-refresh padrão: 60s (pode sobrescrever com ?refresh=30000)
const DEFAULT_REFRESH_MS = 60_000;

// =====================
// DOM
// =====================
const els = {
  lastUpdated: document.getElementById("lastUpdated"),
  cacheHint: document.getElementById("cacheHint"),
  banner: document.getElementById("banner"),
  q: document.getElementById("q"),
  filterStatus: document.getElementById("filterStatus"),
  filterLocal: document.getElementById("filterLocal"),
  filterTurno: document.getElementById("filterTurno"),
  counters: document.getElementById("counters"),
  grid: document.getElementById("grid"),
  empty: document.getElementById("empty"),
  btnRefresh: document.getElementById("btnRefresh"),
  btnTV: document.getElementById("btnTV"),
  btnToggleView: document.getElementById("btnToggleView"),
  cardsWrap: document.getElementById("cardsWrap"),
  tableWrap: document.getElementById("tableWrap"),
  tableHead: document.getElementById("tableHead"),
  tableBody: document.getElementById("tableBody"),
  footerInfo: document.getElementById("footerInfo"),
};

let raw = [];
let fields = [];
let mapping = null;
let viewMode = "cards"; // cards | table

// =====================
// Helpers
// =====================
function qs() {
  return new URLSearchParams(location.search);
}

function nowBR() {
  return new Date().toLocaleString("pt-BR");
}

function stripAccents(s) {
  return (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function norm(s) {
  return stripAccents(s).trim().toLowerCase();
}

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "pt-BR")
  );
}

function setSelectOptions(selectEl, values, placeholder) {
  const current = selectEl.value;
  selectEl.innerHTML =
    `<option value="">${placeholder}</option>` +
    values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  selectEl.value = current;
}

function escapeHtml(str) {
  return (str ?? "").toString().replace(/[&<>"']/g, (m) => {
    const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };
    return map[m];
  });
}

function showBanner(msg) {
  els.banner.textContent = msg;
  els.banner.classList.remove("hidden");
}

function hideBanner() {
  els.banner.classList.add("hidden");
  els.banner.textContent = "";
}

function getRefreshMs() {
  const v = Number(qs().get("refresh"));
  return Number.isFinite(v) && v >= 5_000 ? v : DEFAULT_REFRESH_MS;
}

function isTVMode() {
  return qs().get("mode") === "tv";
}

function toggleTVMode() {
  const p = qs();
  if (isTVMode()) p.delete("mode");
  else p.set("mode", "tv");
  location.search = p.toString();
}

function toggleView() {
  viewMode = viewMode === "cards" ? "table" : "cards";
  els.cardsWrap.classList.toggle("hidden", viewMode !== "cards");
  els.tableWrap.classList.toggle("hidden", viewMode !== "table");
  els.btnToggleView.textContent =
    viewMode === "cards" ? "Ver em tabela" : "Ver em cards";
  render();
}

// =====================
// Column auto-detection
// =====================
function pickField(regexList) {
  for (const re of regexList) {
    const found = fields.find((f) => re.test(norm(f)));
    if (found) return found;
  }
  return null;
}

function buildMapping() {
  // Detecta campos comuns por nomes (tolerante a variações)
  const sala = pickField([/^(sala|ambiente)$/, /(sala|ambiente)/]);
  const status = pickField([/^(status|situacao)$/, /(status|situacao)/]);
  const local = pickField([/^(bloco|local|piso|andar|setor)$/, /(bloco|local|piso|andar|setor)/]);
  const turno = pickField([/^(turno|periodo|período)$/, /(turno|periodo|período)/]);
  const curso = pickField([/^(curso|atividade|turma)$/, /(curso|atividade|turma)/]);
  const horario = pickField([/^(horario|horário)$/, /(hora|horario|horário)/]);
  const docente = pickField([/^(docente|professor|instrutor)$/, /(docente|professor|instrutor)/]);
  const obs = pickField([/^(obs|observacao|observação|anotacao|anotação)$/, /(obs|observacao|observação|anotacao|anotação)/]);

  // Também permitimos override via querystring: ?sala=MinhaColuna&status=OutraColuna...
  const p = qs();
  const override = (key, current) => {
    const v = p.get(key);
    if (!v) return current;
    const match = fields.find((f) => norm(f) === norm(v)) || fields.find((f) => norm(f).includes(norm(v)));
    return match || current;
  };

  return {
    sala: override("sala", sala),
    status: override("status", status),
    local: override("local", local),
    turno: override("turno", turno),
    curso: override("curso", curso),
    horario: override("horario", horario),
    docente: override("docente", docente),
    obs: override("obs", obs),
  };
}

// =====================
// UI badges/colors (heurística)
// =====================
function badgeClasses(status) {
  const s = norm(status);
  if (s.includes("livre") || s.includes("dispon")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (s.includes("ocup") || s.includes("em uso") || s.includes("aula")) return "bg-rose-50 text-rose-700 border-rose-200";
  if (s.includes("manut") || s.includes("bloq") || s.includes("indispon")) return "bg-amber-50 text-amber-800 border-amber-200";
  return "bg-slate-50 text-slate-700 border-slate-200";
}

// =====================
// Load CSV
// =====================
async function load() {
  hideBanner();
  els.lastUpdated.textContent = "Atualizando dados…";

  const url = `${SHEET_CSV_URL}${SHEET_CSV_URL.includes("?") ? "&" : "?"}cb=${Date.now()}`;

  let text;
  try {
    const res = await fetch(url, { cache: "no-store" });
    text = await res.text();
  } catch (err) {
    els.lastUpdated.textContent = "Falha ao carregar.";
    showBanner("Não foi possível acessar a planilha agora. Verifique conexão e se o CSV está publicado.");
    return;
  }

  const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
  raw = parsed.data || [];
  fields = parsed.meta?.fields || Object.keys(raw[0] || {});
  mapping = buildMapping();

  // Se faltarem colunas chave, avisamos mas continuamos.
  if (!mapping.sala) {
    showBanner("Aviso: não encontrei automaticamente a coluna de SALA. Você pode forçar via URL: ?sala=NomeDaColuna");
  }

  // Popula filtros (se existirem colunas)
  if (mapping.status) {
    setSelectOptions(
      els.filterStatus,
      uniq(raw.map((r) => (r[mapping.status] ?? "").toString().trim())),
      "Status (todos)"
    );
  } else {
    els.filterStatus.innerHTML = `<option value="">Status (indisponível)</option>`;
    els.filterStatus.disabled = true;
  }

  if (mapping.local) {
    setSelectOptions(
      els.filterLocal,
      uniq(raw.map((r) => (r[mapping.local] ?? "").toString().trim())),
      "Local/Bloco (todos)"
    );
  } else {
    els.filterLocal.innerHTML = `<option value="">Local/Bloco (indisponível)</option>`;
    els.filterLocal.disabled = true;
  }

  if (mapping.turno) {
    els.filterTurno.classList.remove("hidden");
    setSelectOptions(
      els.filterTurno,
      uniq(raw.map((r) => (r[mapping.turno] ?? "").toString().trim())),
      "Turno/Período (todos)"
    );
  } else {
    els.filterTurno.classList.add("hidden");
  }

  // Info rodapé
  els.footerInfo.textContent = `Fonte: Google Sheets (CSV publicado) • Atualização automática a cada ${Math.round(
    getRefreshMs() / 1000
  )}s • Total de linhas: ${raw.length}`;

  els.lastUpdated.textContent = `Atualizado em ${nowBR()}`;
  els.cacheHint.classList.remove("hidden");

  render();
}

// =====================
// Render
// =====================
function rowText(r) {
  // Busca geral em todas as colunas (robusto)
  return fields.map((f) => (r[f] ?? "")).join(" ").toLowerCase();
}

function filteredRows() {
  const q = norm(els.q.value);
  const st = (els.filterStatus.value ?? "").toString().trim();
  const loc = (els.filterLocal.value ?? "").toString().trim();
  const turno = (els.filterTurno.value ?? "").toString().trim();

  return raw.filter((r) => {
    const okQ = !q || norm(rowText(r)).includes(q);
    const okSt = !st || (mapping?.status && (r[mapping.status] ?? "").toString().trim() === st);
    const okLoc = !loc || (mapping?.local && (r[mapping.local] ?? "").toString().trim() === loc);
    const okTurno =
      !turno || (mapping?.turno && (r[mapping.turno] ?? "").toString().trim() === turno);

    return okQ && okSt && okLoc && okTurno;
  });
}

function renderCounters() {
  if (!mapping?.status) {
    els.counters.innerHTML = "";
    return;
  }

  const counts = {};
  for (const r of raw) {
    const st = (r[mapping.status] ?? "").toString().trim() || "Sem status";
    counts[st] = (counts[st] || 0) + 1;
  }

  els.counters.innerHTML = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([st, n]) => {
      return `
        <button
          class="rounded-2xl border bg-white px-3 py-2 text-sm hover:bg-slate-50"
          data-status="${escapeHtml(st)}"
          title="Filtrar por status"
        >
          <span class="font-medium">${escapeHtml(st)}</span>
          <span class="text-slate-500">• ${n}</span>
        </button>
      `;
    })
    .join("");

  els.counters.querySelectorAll("button[data-status]").forEach((btn) => {
    btn.addEventListener("click", () => {
      els.filterStatus.value = btn.getAttribute("data-status");
      render();
    });
  });
}

function renderCards(rows) {
  els.grid.innerHTML = rows
    .map((r) => {
      const sala = mapping?.sala ? (r[mapping.sala] ?? "").toString().trim() : "";
      const status = mapping?.status ? (r[mapping.status] ?? "").toString().trim() : "";
      const local = mapping?.local ? (r[mapping.local] ?? "").toString().trim() : "";
      const turno = mapping?.turno ? (r[mapping.turno] ?? "").toString().trim() : "";
      const curso = mapping?.curso ? (r[mapping.curso] ?? "").toString().trim() : "";
      const horario = mapping?.horario ? (r[mapping.horario] ?? "").toString().trim() : "";
      const docente = mapping?.docente ? (r[mapping.docente] ?? "").toString().trim() : "";
      const obs = mapping?.obs ? (r[mapping.obs] ?? "").toString().trim() : "";

      return `
      <article class="rounded-3xl border bg-white p-4 shadow-sm">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-xs text-slate-500">${escapeHtml([local, turno].filter(Boolean).join(" • ") || "—")}</div>
            <div class="mt-0.5 truncate text-2xl font-semibold tracking-tight">${escapeHtml(sala || "—")}</div>
          </div>

          ${
            status
              ? `<div class="shrink-0 rounded-2xl border px-3 py-1.5 text-sm ${badgeClasses(
                  status
                )}">${escapeHtml(status)}</div>`
              : ""
          }
        </div>

        <div class="mt-3 space-y-2 text-sm">
          ${curso ? `<div class="font-medium text-slate-900">${escapeHtml(curso)}</div>` : ""}
          ${horario ? `<div class="text-slate-600">${escapeHtml(horario)}</div>` : ""}
          ${docente ? `<div class="text-slate-600">Docente: ${escapeHtml(docente)}</div>` : ""}
          ${obs ? `<div class="text-slate-500">${escapeHtml(obs)}</div>` : ""}
        </div>
      </article>`;
    })
    .join("");

  els.empty.classList.toggle("hidden", rows.length !== 0);
}

function renderTable(rows) {
  // Cabeçalho “inteligente”: prioriza colunas detectadas, depois o resto.
  const priority = [
    mapping?.sala,
    mapping?.status,
    mapping?.local,
    mapping?.turno,
    mapping?.curso,
    mapping?.horario,
    mapping?.docente,
    mapping?.obs,
  ].filter(Boolean);

  const rest = fields.filter((f) => !priority.includes(f));
  const cols = [...priority, ...rest].slice(0, 12); // evita tabela gigante

  els.tableHead.innerHTML = cols
    .map((c) => `<th class="px-4 py-3 font-medium text-slate-600">${escapeHtml(c)}</th>`)
    .join("");

  els.tableBody.innerHTML = rows
    .map((r) => {
      const tds = cols
        .map((c) => {
          const v = (r[c] ?? "").toString().trim();
          const isStatus = mapping?.status && c === mapping.status && v;
          return `
            <td class="px-4 py-3 align-top ${isStatus ? "font-medium" : ""}">
              ${
                isStatus
                  ? `<span class="inline-flex rounded-2xl border px-2.5 py-1 text-xs ${badgeClasses(
                      v
                    )}">${escapeHtml(v)}</span>`
                  : escapeHtml(v || "—")
              }
            </td>
          `;
        })
        .join("");
      return `<tr class="border-t hover:bg-slate-50/50">${tds}</tr>`;
    })
    .join("");
}

function render() {
  if (!raw.length) {
    els.grid.innerHTML = "";
    els.tableHead.innerHTML = "";
    els.tableBody.innerHTML = "";
    els.empty.classList.remove("hidden");
    return;
  }

  renderCounters();

  const rows = filteredRows();

  if (viewMode === "cards") renderCards(rows);
  else renderTable(rows);

  // TV mode tweaks
  if (isTVMode()) {
    document.body.classList.add("text-lg");
    els.grid.className = "grid grid-cols-2 gap-4 lg:grid-cols-4 2xl:grid-cols-5";
  }
}

// =====================
// Events
// =====================
els.q.addEventListener("input", render);
els.filterStatus.addEventListener("change", render);
els.filterLocal.addEventListener("change", render);
els.filterTurno.addEventListener("change", render);

els.btnRefresh.addEventListener("click", load);
els.btnTV.addEventListener("click", toggleTVMode);
els.btnToggleView.addEventListener("click", toggleView);

// =====================
// Start
// =====================
if (isTVMode()) {
  // só um hint visual; o layout em si é ajustado no render()
  showBanner("Modo TV ativo. Dica: use F11 para tela cheia.");
}

load();
setInterval(load, getRefreshMs());
