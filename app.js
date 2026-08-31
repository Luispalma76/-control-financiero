// ---------- Firebase ----------
firebase.initializeApp(window.FIREBASE_CONFIG);
const db = firebase.firestore();

// ---------- Constantes ----------
const CASA_KEY = "ahorro_casa";
const MONTHS_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const EMOJI_OPTIONS = ["💰","🏢","🚗","✈️","🎓","🐶","🎁","🛠️","📦","⭐"];
const COLOR_OPTIONS = ["#002A7A","#DB2777","#D97706","#0D9488","#7C3AED","#0891B2","#65A30D","#DC2626"];

const DEFAULT_CATS = {
  dr_hogar: {
    egreso: ["Material", "Combustible", "Mano de obra", "Herramientas", "Arriendo/Bodega", "Sueldo", "Otro"],
    ingreso: ["Pago de servicio", "Anticipo / Abono cliente", "Otro ingreso"],
  },
  fpg: {
    egreso: ["Tela / Materia prima", "Confección", "Marketing", "Envíos", "Sueldo", "Otro"],
    ingreso: ["Venta ropa", "Venta mayorista", "Otro ingreso"],
  },
  personal: {
    egreso: ["Colación", "Comida casa", "Salida / Ocio", "Transporte", "Salud", "Otro"],
    ingreso: ["Sueldo asignado", "Otro ingreso"],
  },
  [CASA_KEY]: {
    aporte: ["Aporte mensual", "Aporte extra", "Venta / Bono destinado"],
  },
};

const DEFAULT_BUCKETS = [
  { id: "dr_hogar", label: "DR Hogar", icon: "🔧", color: "#002A7A", isFondo: false },
  { id: "fpg", label: "FPG", icon: "👕", color: "#DB2777", isFondo: false },
  { id: "personal", label: "Personal", icon: "🧑", color: "#D97706", isFondo: false },
  { id: CASA_KEY, label: "Fondo Casa", icon: "🏠", color: "#0D9488", isFondo: true },
];

const money = (n) => "$" + Math.round(n || 0).toLocaleString("es-CL");
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthKey = (iso) => iso.slice(0, 7);

// ---------- Estado global ----------
let movs = [];
let buckets = [];        // desde Firestore (con fallback a DEFAULT_BUCKETS mientras carga)
let accounts = [];       // cuentas bancarias
let settings = { metas: {} };
let tab = "dashboard";
let chartInstance = null;
let bucketsSeeded = false;
let authorName = localStorage.getItem("cf_author") || null;

const form = {
  movType: "egreso",
  bucket: "dr_hogar",
  category: "",
  amount: "",
  date: todayISO(),
  note: "",
  accountId: "",
  scanning: false,
  scanBanner: false,
  creatingBucket: false,
  newBucketName: "",
  newBucketEmoji: EMOJI_OPTIONS[0],
  newBucketColor: COLOR_OPTIONS[0],
  newBucketIsFondo: false,
};

const filters = { bucket: "all", type: "all", month: monthKey(todayISO()) };
const bankForm = { nombre: "", saldoInicial: "" };

let cameraStream = null;

// ---------- Autor (quién eres) ----------
function updateGreeting() {
  document.getElementById("greetingName").textContent = authorName || "—";
}
function showAuthorModal() {
  document.getElementById("authorModal").style.display = "flex";
}
function hideAuthorModal() {
  document.getElementById("authorModal").style.display = "none";
}
function setAuthor(name) {
  authorName = name;
  localStorage.setItem("cf_author", name);
  updateGreeting();
  hideAuthorModal();
}
if (!authorName) showAuthorModal(); else updateGreeting();

document.querySelectorAll(".author-btn").forEach((b) => b.addEventListener("click", () => setAuthor(b.dataset.author)));
document.getElementById("authorCustomBtn").addEventListener("click", () => {
  const v = document.getElementById("authorCustom").value.trim();
  if (v) setAuthor(v);
});
document.getElementById("changeAuthorBtn").addEventListener("click", showAuthorModal);

// ---------- Firestore listeners (sincroniza todos los dispositivos) ----------
db.collection("movements").orderBy("date", "desc").onSnapshot((snap) => {
  movs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  document.getElementById("loading").style.display = "none";
  render();
}, (err) => showToast("Error de conexión: " + err.message));

db.collection("buckets").onSnapshot(async (snap) => {
  if (snap.empty && !bucketsSeeded) {
    bucketsSeeded = true;
    const batch = db.batch();
    DEFAULT_BUCKETS.forEach((b) => {
      const ref = db.collection("buckets").doc(b.id);
      batch.set(ref, { label: b.label, icon: b.icon, color: b.color, isFondo: b.isFondo });
    });
    await batch.commit().catch(() => {});
    return; // el propio commit disparará este listener de nuevo
  }
  buckets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  render();
});

db.collection("accounts").orderBy("createdAt", "asc").onSnapshot((snap) => {
  accounts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  render();
});

db.collection("settings").doc("appSettings").onSnapshot((doc) => {
  settings = doc.exists ? { metas: {}, ...doc.data() } : { metas: {} };
  if (!settings.metas) settings.metas = {};
  render();
});

// ---------- Utilidades ----------
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.style.display = "none"; }, 2200);
}
function getBucket(id) { return buckets.find((b) => b.id === id) || DEFAULT_BUCKETS.find((b) => b.id === id); }
function operationalBuckets() { return buckets.filter((b) => !b.isFondo); }
function fondoBuckets() { return buckets.filter((b) => b.isFondo); }

function categorySuggestions(bucketId, type) {
  const used = new Set();
  movs.forEach((m) => { if (m.bucket === bucketId && m.type === type) used.add(m.category); });
  const defaults = (DEFAULT_CATS[bucketId] && DEFAULT_CATS[bucketId][type]) || (type === "ingreso" ? ["Otro ingreso"] : type === "aporte" ? ["Aporte"] : ["Gasto", "Otro"]);
  defaults.forEach((c) => used.add(c));
  return Array.from(used);
}

function accountBalance(accId) {
  const acc = accounts.find((a) => a.id === accId);
  if (!acc) return 0;
  let bal = parseFloat(acc.saldoInicial) || 0;
  movs.forEach((m) => {
    if (m.accountId !== accId) return;
    bal += m.type === "ingreso" ? m.amount : -m.amount;
  });
  return bal;
}

function setTab(next) { tab = next; render(); }
document.querySelectorAll(".nav-btn").forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

// ---------- Escritura en Firestore ----------
async function addMovement() {
  const val = parseFloat(form.amount);
  if (!val || val <= 0) { showToast("Ingresa un monto válido"); return; }
  if (!form.category.trim()) { showToast("Ingresa una categoría"); return; }
  const bucketMeta = getBucket(form.bucket);
  const effType = bucketMeta && bucketMeta.isFondo ? "aporte" : form.movType;
  const entry = {
    type: effType, bucket: form.bucket, category: form.category.trim(),
    amount: val, date: form.date, note: (form.note || "").trim(),
    accountId: form.accountId || null, author: authorName || "—",
    createdAt: Date.now(),
  };
  try {
    await db.collection("movements").add(entry);
    form.amount = ""; form.note = ""; form.date = todayISO(); form.scanBanner = false;
    showToast("Movimiento guardado");
    setTab("dashboard");
  } catch (err) { showToast("No se pudo guardar: " + err.message); }
}

async function deleteMovement(id) {
  try { await db.collection("movements").doc(id).delete(); }
  catch (err) { showToast("No se pudo eliminar: " + err.message); }
}

async function createBucket() {
  const label = form.newBucketName.trim();
  if (!label) { showToast("Ponle un nombre a la cuenta"); return; }
  try {
    const ref = await db.collection("buckets").add({
      label, icon: form.newBucketEmoji, color: form.newBucketColor, isFondo: form.newBucketIsFondo,
    });
    form.bucket = ref.id;
    form.creatingBucket = false;
    form.newBucketName = "";
    showToast("Cuenta creada");
    render();
  } catch (err) { showToast("No se pudo crear: " + err.message); }
}

async function saveMeta(bucketId, value) {
  try {
    const metas = { ...(settings.metas || {}), [bucketId]: value };
    await db.collection("settings").doc("appSettings").set({ metas }, { merge: true });
    showToast("Meta guardada");
  } catch (err) { showToast("No se pudo guardar: " + err.message); }
}

async function addAccount() {
  const nombre = bankForm.nombre.trim();
  const saldo = parseFloat(bankForm.saldoInicial) || 0;
  if (!nombre) { showToast("Ingresa el nombre del banco"); return; }
  try {
    await db.collection("accounts").add({ nombre, saldoInicial: saldo, createdAt: Date.now() });
    bankForm.nombre = ""; bankForm.saldoInicial = "";
    showToast("Cuenta bancaria agregada");
    render();
  } catch (err) { showToast("No se pudo agregar: " + err.message); }
}

async function deleteAccount(id) {
  if (!confirm("¿Eliminar esta cuenta bancaria? Los movimientos ya registrados no se borran, solo quedan sin cuenta asociada.")) return;
  try { await db.collection("accounts").doc(id).delete(); }
  catch (err) { showToast("No se pudo eliminar: " + err.message); }
}

// ---------- Cálculos ----------
function computeMonthTotals(currentMonth) {
  const t = {};
  operationalBuckets().forEach((b) => { t[b.id] = { ingreso: 0, egreso: 0 }; });
  const fondoTotals = {};
  fondoBuckets().forEach((b) => { fondoTotals[b.id] = 0; });
  movs.forEach((e) => {
    if (monthKey(e.date) !== currentMonth) return;
    if (t[e.bucket]) t[e.bucket][e.type] = (t[e.bucket][e.type] || 0) + e.amount;
    else if (fondoTotals[e.bucket] !== undefined) fondoTotals[e.bucket] += e.amount;
  });
  return { t, fondoTotals };
}
function fondoAcumulado(bucketId) {
  return movs.filter((e) => e.bucket === bucketId).reduce((a, e) => a + e.amount, 0);
}
function computeChartData() {
  const now = new Date();
  const arr = [];
  const opIds = new Set(operationalBuckets().map((b) => b.id));
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const row = { name: MONTHS_ES[d.getMonth()], ingresos: 0, egresos: 0 };
    movs.forEach((e) => {
      if (monthKey(e.date) !== key || !opIds.has(e.bucket)) return;
      if (e.type === "ingreso") row.ingresos += e.amount; else row.egresos += e.amount;
    });
    arr.push(row);
  }
  return arr;
}

// ---------- Render principal ----------
function render() {
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const el = document.getElementById("content");
  if (buckets.length === 0) buckets = DEFAULT_BUCKETS; // fallback mientras carga Firestore
  if (tab === "dashboard") renderDashboard(el);
  else if (tab === "add") renderAdd(el);
  else if (tab === "movs") renderMovs(el);
  else if (tab === "fondos") renderFondos(el);
  else if (tab === "bancos") renderBancos(el);
}

function renderDashboard(el) {
  const currentMonth = monthKey(todayISO());
  const [y, m] = currentMonth.split("-");
  const { t } = computeMonthTotals(currentMonth);
  let ingresoMes = 0, egresoMes = 0;
  operationalBuckets().forEach((b) => { ingresoMes += (t[b.id] || {}).ingreso || 0; egresoMes += (t[b.id] || {}).egreso || 0; });
  const netoMes = ingresoMes - egresoMes;

  el.innerHTML = `
    <div class="section-label">${MONTHS_ES[parseInt(m,10)-1]} ${y}</div>
    <div class="stats-grid">
      <div class="stat-card" style="border-color:#16A34A55">
        <div>⬆️</div><div class="stat-label">Ingresos</div><div class="stat-value" style="color:#16A34A">${money(ingresoMes)}</div>
      </div>
      <div class="stat-card" style="border-color:#DC262655">
        <div>⬇️</div><div class="stat-label">Egresos</div><div class="stat-value" style="color:#DC2626">${money(egresoMes)}</div>
      </div>
      <div class="stat-card" style="border-color:${netoMes>=0?'#002A7A55':'#DC262655'}">
        <div>💼</div><div class="stat-label">Neto</div><div class="stat-value" style="color:${netoMes>=0?'#002A7A':'#DC2626'}">${money(netoMes)}</div>
      </div>
    </div>

    <div class="bucket-list">
      ${operationalBuckets().map((meta) => `
        <div class="card card-block" style="border-left:3px solid ${meta.color}">
          <div class="bucket-card-head">
            <div class="icon-circle" style="background:${meta.color}22">${meta.icon}</div>
            <div><div class="card-label">${meta.label}</div></div>
          </div>
          <div class="bucket-io-row">
            <div><div class="bucket-io-label">Ingreso</div><div class="bucket-io-value" style="color:#16A34A">${money((t[meta.id]||{}).ingreso)}</div></div>
            <div style="text-align:right"><div class="bucket-io-label">Egreso</div><div class="bucket-io-value" style="color:#DC2626">${money((t[meta.id]||{}).egreso)}</div></div>
          </div>
        </div>
      `).join("")}
    </div>

    ${accounts.length > 0 ? `
      <div class="section-label">Saldo por banco</div>
      <div style="display:grid;gap:8px;margin-top:8px">
        ${accounts.map((a) => {
          const bal = accountBalance(a.id);
          return `<div class="account-card"><span class="account-name">🏦 ${a.nombre}</span><span class="account-balance" style="color:${bal>=0?'#12151A':'#DC2626'}">${money(bal)}</span></div>`;
        }).join("")}
      </div>` : ""}

    <div class="section-label">Ingresos vs Egresos · 6 meses</div>
    <div class="chart-wrap"><canvas id="chartCanvas"></canvas></div>
  `;

  const ctx = document.getElementById("chartCanvas");
  const data = computeChartData();
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: data.map((d) => d.name),
      datasets: [
        { label: "Ingresos", data: data.map((d) => d.ingresos), backgroundColor: "#16A34A", borderRadius: 4 },
        { label: "Egresos", data: data.map((d) => d.egresos), backgroundColor: "#DC2626", borderRadius: 4 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: "#6B7280", font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: "#6B7280" }, grid: { display: false } },
        y: { ticks: { color: "#6B7280", callback: (v) => v >= 1000000 ? (v/1000000)+"M" : v }, grid: { color: "#E9ECF1" } },
      },
    },
  });
}

function renderAdd(el) {
  const bucketMeta = getBucket(form.bucket) || buckets[0];
  const isFondo = bucketMeta && bucketMeta.isFondo;
  const effType = isFondo ? "aporte" : form.movType;
  const suggestions = categorySuggestions(form.bucket, effType);

  el.innerHTML = `
    <div class="chip" style="display:inline-block;margin-top:2px">Registrando como: <strong>${authorName || "—"}</strong></div>

    <button id="scanBtn" class="scan-btn" style="margin-top:12px" ${form.scanning ? "disabled" : ""}>
      ${form.scanning ? "⏳ Leyendo boleta con IA..." : "📷 Escanear boleta o factura"}
    </button>
    ${form.scanBanner ? `
      <div class="ai-banner">
        <span>✨</span><span style="flex:1">Datos leídos automáticamente — revisa antes de guardar</span>
        <button id="dismissBanner">✕</button>
      </div>` : ""}

    ${!isFondo ? `
      <div class="type-row">
        <button id="typeEgreso" class="type-btn ${form.movType==='egreso'?'egreso-active':''}">⬇️ Egreso</button>
        <button id="typeIngreso" class="type-btn ${form.movType==='ingreso'?'ingreso-active':''}">⬆️ Ingreso</button>
      </div>` : ""}

    <div class="section-label">¿Qué cuenta / negocio?</div>
    <div class="bucket-grid">
      ${buckets.map((meta) => `
        <button class="bucket-btn ${form.bucket===meta.id?'active':''}" data-bucket="${meta.id}"
          style="${form.bucket===meta.id?`--bucket-bg:${meta.color}18;--bucket-color:${meta.color};border-color:${meta.color}`:""}">
          <span>${meta.icon}</span><span>${meta.label}</span>
        </button>
      `).join("")}
      <button id="newBucketTile" class="new-bucket-tile">➕ Nueva cuenta</button>
    </div>

    ${form.creatingBucket ? `
      <div class="field">
        <label class="label">Nombre de la nueva cuenta</label>
        <input id="newBucketName" type="text" class="input" placeholder="Ej: Auto, Vacaciones, Ahorro emergencia..." value="${form.newBucketName}" />
        <label class="label" style="margin-top:10px">Ícono</label>
        <div class="emoji-row">
          ${EMOJI_OPTIONS.map((e) => `<button class="emoji-opt ${form.newBucketEmoji===e?'active':''}" data-emoji="${e}">${e}</button>`).join("")}
        </div>
        <label class="label" style="margin-top:10px">Color</label>
        <div class="color-row">
          ${COLOR_OPTIONS.map((c) => `<button class="color-opt ${form.newBucketColor===c?'active':''}" data-color="${c}" style="background:${c}"></button>`).join("")}
        </div>
        <label class="checkbox-row">
          <input type="checkbox" id="newBucketFondo" ${form.newBucketIsFondo?"checked":""} />
          Es una meta de ahorro (como Fondo Casa, no tiene ingreso/egreso, solo aportes)
        </label>
        <button id="createBucketBtn" class="submit-btn">Crear cuenta</button>
      </div>` : ""}

    <div class="field">
      <label class="label">Categoría</label>
      <input id="categoryInput" list="catSuggestions" class="input" placeholder="Escribe o elige una sugerida" value="${form.category}" />
      <datalist id="catSuggestions">${suggestions.map((c) => `<option value="${c}"></option>`).join("")}</datalist>
    </div>

    <div class="field">
      <label class="label">Monto (CLP)</label>
      <input id="amountInput" type="number" inputmode="numeric" placeholder="0" class="input" value="${form.amount}" />
    </div>

    <div class="field">
      <label class="label">Fecha</label>
      <input id="dateInput" type="date" class="input" value="${form.date}" />
    </div>

    <div class="field">
      <label class="label">Cuenta bancaria</label>
      <select id="accountSelect" class="input">
        <option value="">Sin asignar / efectivo</option>
        ${accounts.map((a) => `<option value="${a.id}" ${form.accountId===a.id?"selected":""}>${a.nombre}</option>`).join("")}
      </select>
      ${accounts.length === 0 ? `<div class="empty-text" style="padding:8px 0 0">Aún no tienes bancos cargados. <a href="#" id="goBancos" style="color:#002A7A;font-weight:700">Agregar uno</a></div>` : ""}
    </div>

    <div class="field">
      <label class="label">Nota / comercio (opcional)</label>
      <input id="noteInput" type="text" placeholder="Ej: Sodimac, cliente Las Condes..." class="input" value="${form.note}" />
    </div>

    <button id="submitBtn" class="submit-btn">Guardar movimiento</button>
  `;

  document.getElementById("scanBtn").addEventListener("click", openCamera);
  const dismiss = document.getElementById("dismissBanner");
  if (dismiss) dismiss.addEventListener("click", () => { form.scanBanner = false; render(); });
  const te = document.getElementById("typeEgreso");
  const ti = document.getElementById("typeIngreso");
  if (te) te.addEventListener("click", () => { form.movType = "egreso"; form.category = ""; render(); });
  if (ti) ti.addEventListener("click", () => { form.movType = "ingreso"; form.category = ""; render(); });

  document.querySelectorAll(".bucket-btn").forEach((b) => {
    b.addEventListener("click", () => { form.bucket = b.dataset.bucket; form.category = ""; form.creatingBucket = false; render(); });
  });
  document.getElementById("newBucketTile").addEventListener("click", () => { form.creatingBucket = !form.creatingBucket; render(); });
  const nbName = document.getElementById("newBucketName");
  if (nbName) nbName.addEventListener("input", (e) => { form.newBucketName = e.target.value; });
  document.querySelectorAll(".emoji-opt").forEach((b) => b.addEventListener("click", () => { form.newBucketEmoji = b.dataset.emoji; render(); }));
  document.querySelectorAll(".color-opt").forEach((b) => b.addEventListener("click", () => { form.newBucketColor = b.dataset.color; render(); }));
  const nbFondo = document.getElementById("newBucketFondo");
  if (nbFondo) nbFondo.addEventListener("change", (e) => { form.newBucketIsFondo = e.target.checked; });
  const createBtn = document.getElementById("createBucketBtn");
  if (createBtn) createBtn.addEventListener("click", createBucket);

  document.getElementById("categoryInput").addEventListener("input", (e) => { form.category = e.target.value; });
  document.getElementById("amountInput").addEventListener("input", (e) => { form.amount = e.target.value; });
  document.getElementById("dateInput").addEventListener("input", (e) => { form.date = e.target.value; });
  document.getElementById("accountSelect").addEventListener("change", (e) => { form.accountId = e.target.value; });
  document.getElementById("noteInput").addEventListener("input", (e) => { form.note = e.target.value; });
  const goBancos = document.getElementById("goBancos");
  if (goBancos) goBancos.addEventListener("click", (e) => { e.preventDefault(); setTab("bancos"); });
  document.getElementById("submitBtn").addEventListener("click", addMovement);
}

function renderMovs(el) {
  const list = movs
    .filter((e) => monthKey(e.date) === filters.month)
    .filter((e) => filters.bucket === "all" || e.bucket === filters.bucket)
    .filter((e) => filters.type === "all" || e.type === filters.type);

  const breakdown = {};
  list.forEach((e) => { breakdown[e.category] = (breakdown[e.category] || 0) + e.amount; });
  const breakdownArr = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  const total = breakdownArr.reduce((a, [, v]) => a + v, 0);

  el.innerHTML = `
    <div style="display:flex;gap:8px">
      <input id="monthFilter" type="month" class="input" value="${filters.month}" style="flex:1" />
      <select id="bucketFilter" class="input" style="flex:1">
        <option value="all">Todos</option>
        ${buckets.map((m) => `<option value="${m.id}" ${filters.bucket===m.id?"selected":""}>${m.label}</option>`).join("")}
      </select>
    </div>
    <div class="chip-row">
      ${["all","ingreso","egreso","aporte"].map((t) => `
        <button class="chip ${filters.type===t?'active':''}" data-type="${t}">${t==="all"?"Todos":t==="ingreso"?"Ingresos":t==="egreso"?"Egresos":"Aportes"}</button>
      `).join("")}
    </div>

    <div class="section-label">Total periodo</div>
    <div class="big-number">${money(total)}</div>

    ${breakdownArr.length ? `
      <div class="section-label">Por categoría</div>
      <div style="display:grid;gap:6px;margin-top:8px">
        ${breakdownArr.map(([cat, val]) => `<div class="cat-row"><span style="color:#3A4150;font-size:13px">${cat}</span><span style="color:#12151A;font-size:13px;font-weight:600">${money(val)}</span></div>`).join("")}
      </div>` : ""}

    <div class="section-label">Detalle (${list.length})</div>
    <div style="display:grid;gap:8px;margin-top:8px">
      ${list.length === 0 ? `<div class="empty-text">Sin movimientos este periodo.</div>` : list.sort((a,b)=> a.date<b.date?1:-1).map((e) => {
        const meta = getBucket(e.bucket) || { icon: "❓", color: "#9AA1AC", label: e.bucket };
        const isPositive = e.type === "ingreso";
        const color = isPositive ? "#16A34A" : "#DC2626";
        const acc = accounts.find((a) => a.id === e.accountId);
        return `
          <div class="tx-row">
            <div class="icon-circle" style="background:${meta.color}22;width:32px;height:32px">${meta.icon}</div>
            <div class="tx-info">
              <div class="tx-title">${e.category}</div>
              <div class="tx-sub">${e.date}${e.note ? " · " + e.note : ""}</div>
              <div class="tx-tags">
                <span class="tx-tag">${meta.label}</span>
                ${acc ? `<span class="tx-tag">🏦 ${acc.nombre}</span>` : ""}
                ${e.author ? `<span class="tx-tag">👤 ${e.author}</span>` : ""}
              </div>
            </div>
            <div class="tx-amount" style="color:${color}">${isPositive ? "+" : "-"}${money(e.amount)}</div>
            <button class="delete-btn" data-id="${e.id}">🗑️</button>
          </div>`;
      }).join("")}
    </div>
  `;

  document.getElementById("monthFilter").addEventListener("input", (e) => { filters.month = e.target.value; render(); });
  document.getElementById("bucketFilter").addEventListener("change", (e) => { filters.bucket = e.target.value; render(); });
  document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { filters.type = c.dataset.type; render(); }));
  document.querySelectorAll(".delete-btn").forEach((b) => b.addEventListener("click", () => {
    if (confirm("¿Eliminar este movimiento?")) deleteMovement(b.dataset.id);
  }));
}

function renderFondos(el) {
  const list = fondoBuckets();
  el.innerHTML = `
    <div class="section-label">Tus metas de ahorro</div>
    ${list.length === 0 ? `<div class="empty-text">Aún no tienes cuentas de ahorro. Crea una desde "Agregar" → "+ Nueva cuenta" y marca "Es una meta de ahorro".</div>` : list.map((meta) => {
      const acumulado = fondoAcumulado(meta.id);
      const currentMonth = monthKey(todayISO());
      const aporteMes = movs.filter((e) => e.bucket === meta.id && monthKey(e.date) === currentMonth).reduce((a,e)=>a+e.amount,0);
      const metaVal = (settings.metas || {})[meta.id] || 0;
      const pct = metaVal > 0 ? Math.min(100, (acumulado / metaVal) * 100) : 0;
      return `
        <div class="card card-block" style="border-left:3px solid ${meta.color};margin-top:12px">
          <div class="bucket-card-head"><div class="icon-circle" style="background:${meta.color}22">${meta.icon}</div><div class="card-label">${meta.label}</div></div>
          <div class="big-number" style="color:${meta.color};margin-top:8px">${money(acumulado)}</div>
          <div style="color:#6B7280;font-size:12px;margin-top:2px">Este mes aportaste ${money(aporteMes)}</div>
          ${metaVal > 0 ? `
            <div style="margin-top:12px">
              <div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:${meta.color}"></div></div>
              <div class="progress-text">${pct.toFixed(1)}% de ${money(metaVal)}</div>
            </div>` : ""}
          <div class="field">
            <label class="label">Meta total (CLP)</label>
            <input type="number" class="input meta-input" data-bucket="${meta.id}" placeholder="Ej: 60000000" value="${metaVal || ""}" />
          </div>
          <button class="submit-btn submit-btn-secondary save-meta-btn" data-bucket="${meta.id}">Guardar meta</button>
          <button class="submit-btn quick-aporte-btn" data-bucket="${meta.id}" style="margin-top:10px;background:${meta.color}">+ Registrar aporte</button>
        </div>
      `;
    }).join("")}
    <div class="empty-text" style="margin-top:16px">Cada vez que decidas "esto no lo gasto, lo guardo", regístralo como aporte. Puedes crear más metas (auto, vacaciones, etc.) desde "Agregar".</div>
  `;

  document.querySelectorAll(".save-meta-btn").forEach((b) => b.addEventListener("click", () => {
    const input = document.querySelector(`.meta-input[data-bucket="${b.dataset.bucket}"]`);
    saveMeta(b.dataset.bucket, parseFloat(input.value) || 0);
  }));
  document.querySelectorAll(".quick-aporte-btn").forEach((b) => b.addEventListener("click", () => {
    form.bucket = b.dataset.bucket; form.category = ""; setTab("add");
  }));
}

function renderBancos(el) {
  const total = accounts.reduce((a, acc) => a + accountBalance(acc.id), 0);
  el.innerHTML = `
    <div class="section-label">Saldo total disponible</div>
    <div class="big-number">${money(total)}</div>

    <div style="display:grid;gap:8px;margin-top:14px">
      ${accounts.length === 0 ? `<div class="empty-text">Aún no tienes bancos cargados.</div>` : accounts.map((a) => {
        const bal = accountBalance(a.id);
        return `
          <div class="account-card">
            <div>
              <div class="account-name">🏦 ${a.nombre}</div>
              <div class="card-sub">Saldo inicial: ${money(a.saldoInicial)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <span class="account-balance" style="color:${bal>=0?'#12151A':'#DC2626'}">${money(bal)}</span>
              <button class="delete-btn" data-id="${a.id}">🗑️</button>
            </div>
          </div>`;
      }).join("")}
    </div>

    <div class="section-label">Agregar cuenta bancaria</div>
    <div class="field">
      <label class="label">Nombre del banco (ej: Banco Estado, Santander tarjeta...)</label>
      <input id="bankNameInput" type="text" class="input" placeholder="Nombre del banco" value="${bankForm.nombre}" />
    </div>
    <div class="field">
      <label class="label">Saldo inicial actual (CLP)</label>
      <input id="bankBalanceInput" type="number" class="input" placeholder="0" value="${bankForm.saldoInicial}" />
    </div>
    <button id="addBankBtn" class="submit-btn">Agregar cuenta bancaria</button>
    <div class="empty-text" style="margin-top:14px">A partir de aquí, cada ingreso o egreso que asignes a este banco ajusta el saldo automáticamente.</div>
  `;

  document.getElementById("bankNameInput").addEventListener("input", (e) => { bankForm.nombre = e.target.value; });
  document.getElementById("bankBalanceInput").addEventListener("input", (e) => { bankForm.saldoInicial = e.target.value; });
  document.getElementById("addBankBtn").addEventListener("click", addAccount);
  document.querySelectorAll(".delete-btn").forEach((b) => b.addEventListener("click", () => deleteAccount(b.dataset.id)));
}

// ---------- Cámara en vivo ----------
async function openCamera() {
  try {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error("no-camera-api");
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    const video = document.getElementById("cameraVideo");
    video.srcObject = cameraStream;
    video.play().catch(() => {});
    document.getElementById("cameraOverlay").style.display = "flex";
  } catch (err) { showToast("No pude abrir la cámara. Revisa los permisos del navegador."); }
}
function closeCamera() {
  if (cameraStream) { cameraStream.getTracks().forEach((t) => t.stop()); cameraStream = null; }
  document.getElementById("cameraOverlay").style.display = "none";
}
function capturePhoto() {
  const video = document.getElementById("cameraVideo");
  if (!video.videoWidth) return;
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  const base64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
  closeCamera();
  scanReceipt(base64);
}
document.getElementById("cameraClose").addEventListener("click", closeCamera);
document.getElementById("captureBtn").addEventListener("click", capturePhoto);

// ---------- Escaneo vía función serverless segura ----------
async function scanReceipt(base64) {
  form.scanning = true; render();
  try {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: base64, mediaType: "image/jpeg" }),
    });
    if (!res.ok) throw new Error("Fallo del servidor");
    const parsed = await res.json();

    const negocioMap = { dr_hogar: "dr_hogar", fpg: "fpg", personal: "personal" };
    const negocio = negocioMap[parsed.negocio_sugerido] || "personal";
    const tipo = parsed.tipo === "ingreso" ? "ingreso" : "egreso";

    form.bucket = negocio;
    form.movType = tipo;
    form.category = parsed.categoria_sugerida || "";
    form.amount = parsed.monto ? String(parsed.monto) : "";
    form.date = parsed.fecha && /^\d{4}-\d{2}-\d{2}$/.test(parsed.fecha) ? parsed.fecha : todayISO();
    form.note = parsed.comercio || "";
    form.scanBanner = true;
    showToast("Boleta leída — revisa antes de guardar");
  } catch (err) { showToast("No pude leer la boleta. Ingresa los datos a mano."); }
  finally { form.scanning = false; render(); }
}

// ---------- PWA: registrar service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
