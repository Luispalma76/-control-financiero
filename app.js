// ---------- Firebase ----------
firebase.initializeApp(window.FIREBASE_CONFIG);
const db = firebase.firestore();
const auth = firebase.auth();

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
  medioPago: "debito",
  cuotas: "1",
  efectivoOrigen: "cajero",
  cajeroAccountId: "",
  creatingBucket: false,
  newBucketName: "",
  newBucketEmoji: EMOJI_OPTIONS[0],
  newBucketColor: COLOR_OPTIONS[0],
  newBucketIsFondo: false,
};

const filters = { bucket: "all", type: "all", month: monthKey(todayISO()) };
const bankForm = { nombre: "", tipo: "debito", saldoInicial: "", lineaCredito: "" };
const payForm = { creditId: "", amount: "", fromAccountId: "" };

// ---------- Control de acceso (clave compartida + sesión anónima segura) ----------
let appStarted = false;

function tryPin() {
  const val = document.getElementById("pinInput").value.trim();
  if (val.toLowerCase() === String(window.APP_PIN || "").toLowerCase()) {
    auth.signInAnonymously().catch((err) => showToast("Error de acceso: " + err.message));
  } else {
    showToast("Clave incorrecta");
  }
}
document.getElementById("pinSubmitBtn").addEventListener("click", tryPin);
document.getElementById("pinInput").addEventListener("keydown", (e) => { if (e.key === "Enter") tryPin(); });

auth.onAuthStateChanged((user) => {
  if (user) {
    document.getElementById("pinScreen").style.display = "none";
    if (!appStarted) { appStarted = true; initApp(); }
  } else {
    document.getElementById("loading").style.display = "none";
    document.getElementById("pinScreen").style.display = "flex";
  }
});

function initApp() {
  // ---------- Autor (quién eres) ----------
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
}

// ---------- Autor (quién eres): funciones base ----------
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

// ---------- Utilidades ----------
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { t.style.display = "none"; }, 2200);
}
function getBucket(id) {
  if (!id) return { icon: "🔁", color: "#6B7280", label: "Transferencia" };
  return buckets.find((b) => b.id === id) || DEFAULT_BUCKETS.find((b) => b.id === id);
}
function operationalBuckets() { return buckets.filter((b) => !b.isFondo); }
function fondoBuckets() { return buckets.filter((b) => b.isFondo); }

function categorySuggestions(bucketId, type) {
  const used = new Set();
  movs.forEach((m) => { if (m.bucket === bucketId && m.type === type) used.add(m.category); });
  const defaults = (DEFAULT_CATS[bucketId] && DEFAULT_CATS[bucketId][type]) || (type === "ingreso" ? ["Otro ingreso"] : type === "aporte" ? ["Aporte"] : ["Gasto", "Otro"]);
  defaults.forEach((c) => used.add(c));
  return Array.from(used);
}

function accountStatus(acc) {
  if (!acc) return { saldo: 0 };
  if (acc.tipo === "credito") {
    let deuda = 0;
    movs.forEach((m) => {
      if (m.accountId !== acc.id) return;
      if (m.type === "egreso") deuda += m.amount;
      if (m.type === "pago_tarjeta") deuda -= m.amount;
    });
    const linea = parseFloat(acc.lineaCredito) || 0;
    return { tipo: "credito", deuda, disponible: linea - deuda, linea };
  }
  let saldo = parseFloat(acc.saldoInicial) || 0;
  movs.forEach((m) => {
    if (m.accountId !== acc.id) return;
    if (m.type === "ingreso") saldo += m.amount;
    else saldo -= m.amount; // egreso, aporte, pago_tarjeta (transferencia saliente)
  });
  return { tipo: "debito", saldo };
}
function debitAccounts() { return accounts.filter((a) => a.tipo !== "credito"); }
function creditAccounts() { return accounts.filter((a) => a.tipo === "credito"); }

function setTab(next) { tab = next; render(); }
document.querySelectorAll(".nav-btn").forEach((btn) => btn.addEventListener("click", () => setTab(btn.dataset.tab)));

// ---------- Escritura en Firestore ----------
async function addMovement() {
  const val = parseFloat(form.amount);
  if (!val || val <= 0) { showToast("Ingresa un monto válido"); return; }
  if (!form.category.trim()) { showToast("Ingresa una categoría"); return; }
  const bucketMeta = getBucket(form.bucket);
  const isFondo = bucketMeta && bucketMeta.isFondo;
  const effType = isFondo ? "aporte" : form.movType;

  let accountId = null, medioPago = null, cuotas = null, efectivoOrigen = null;
  if (!isFondo && effType === "egreso") {
    medioPago = form.medioPago;
    if (medioPago === "debito") {
      accountId = form.accountId || null;
    } else if (medioPago === "credito") {
      if (!form.accountId) { showToast("Elige con qué tarjeta de crédito pagaste"); return; }
      accountId = form.accountId;
      cuotas = parseInt(form.cuotas, 10) || 1;
    } else if (medioPago === "efectivo") {
      efectivoOrigen = form.efectivoOrigen;
      if (efectivoOrigen === "cajero") accountId = form.cajeroAccountId || null;
    }
  } else if (!isFondo && effType === "ingreso") {
    accountId = form.accountId || null;
  } else if (isFondo) {
    accountId = form.accountId || null;
  }

  const entry = {
    type: effType, bucket: form.bucket, category: form.category.trim(),
    amount: val, date: form.date, note: (form.note || "").trim(),
    accountId, medioPago, cuotas, efectivoOrigen,
    author: authorName || "—", createdAt: Date.now(),
  };
  try {
    await db.collection("movements").add(entry);
    form.amount = ""; form.note = ""; form.date = todayISO(); form.cuotas = "1";
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
  if (!nombre) { showToast("Ingresa el nombre del banco"); return; }
  const payload = { nombre, tipo: bankForm.tipo, createdAt: Date.now() };
  if (bankForm.tipo === "credito") payload.lineaCredito = parseFloat(bankForm.lineaCredito) || 0;
  else payload.saldoInicial = parseFloat(bankForm.saldoInicial) || 0;
  try {
    await db.collection("accounts").add(payload);
    bankForm.nombre = ""; bankForm.saldoInicial = ""; bankForm.lineaCredito = "";
    showToast("Cuenta bancaria agregada");
    render();
  } catch (err) { showToast("No se pudo agregar: " + err.message); }
}

async function payCreditCard() {
  const val = parseFloat(payForm.amount);
  if (!val || val <= 0) { showToast("Ingresa un monto válido"); return; }
  if (!payForm.creditId) { showToast("Elige la tarjeta a pagar"); return; }
  const creditAcc = accounts.find((a) => a.id === payForm.creditId);
  try {
    await db.collection("movements").add({
      type: "pago_tarjeta", bucket: null, category: `Pago ${creditAcc ? creditAcc.nombre : "tarjeta"}`,
      amount: val, date: todayISO(), note: "", accountId: payForm.creditId,
      author: authorName || "—", createdAt: Date.now(),
    });
    if (payForm.fromAccountId) {
      await db.collection("movements").add({
        type: "egreso", bucket: null, category: `Pago ${creditAcc ? creditAcc.nombre : "tarjeta"}`,
        amount: val, date: todayISO(), note: "", accountId: payForm.fromAccountId,
        author: authorName || "—", createdAt: Date.now(),
      });
    }
    payForm.amount = ""; payForm.creditId = ""; payForm.fromAccountId = "";
    showToast("Pago registrado");
    render();
  } catch (err) { showToast("No se pudo registrar el pago: " + err.message); }
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
      <div class="section-label">Saldo por banco / tarjeta</div>
      <div style="display:grid;gap:8px;margin-top:8px">
        ${accounts.map((a) => {
          const st = accountStatus(a);
          if (a.tipo === "credito") {
            return `<div class="account-card"><span class="account-name">💳 ${a.nombre}</span><span class="account-balance" style="color:#DC2626">Deuda ${money(st.deuda)}</span></div>`;
          }
          return `<div class="account-card"><span class="account-name">🏦 ${a.nombre}</span><span class="account-balance" style="color:${st.saldo>=0?'#12151A':'#DC2626'}">${money(st.saldo)}</span></div>`;
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

    ${!isFondo && effType === "egreso" ? `
      <div class="section-label">Medio de pago</div>
      <div class="type-row">
        <button id="pagoDebito" class="type-btn ${form.medioPago==='debito'?'ingreso-active':''}">💳 Débito</button>
        <button id="pagoCredito" class="type-btn ${form.medioPago==='credito'?'egreso-active':''}">💳 Crédito</button>
        <button id="pagoEfectivo" class="type-btn ${form.medioPago==='efectivo'?'ingreso-active':''}">💵 Efectivo</button>
      </div>

      ${form.medioPago === "debito" ? `
        <div class="field">
          <label class="label">¿Qué cuenta débito?</label>
          <select id="accountSelect" class="input">
            <option value="">Sin asignar</option>
            ${debitAccounts().map((a) => `<option value="${a.id}" ${form.accountId===a.id?"selected":""}>${a.nombre}</option>`).join("")}
          </select>
          ${debitAccounts().length===0 ? `<div class="empty-text" style="padding:8px 0 0">Aún no tienes cuentas débito. <a href="#" id="goBancos" style="color:#002A7A;font-weight:700">Agregar una</a></div>` : ""}
        </div>` : ""}

      ${form.medioPago === "credito" ? `
        <div class="field">
          <label class="label">¿Con qué tarjeta de crédito?</label>
          <select id="creditAccountSelect" class="input">
            <option value="">Elige una tarjeta</option>
            ${creditAccounts().map((a) => `<option value="${a.id}" ${form.accountId===a.id?"selected":""}>${a.nombre}</option>`).join("")}
          </select>
          ${creditAccounts().length===0 ? `<div class="empty-text" style="padding:8px 0 0">Aún no tienes tarjetas de crédito. <a href="#" id="goBancos" style="color:#002A7A;font-weight:700">Agregar una</a></div>` : ""}
        </div>
        <div class="field">
          <label class="label">Número de cuotas</label>
          <input id="cuotasInput" type="number" min="1" class="input" value="${form.cuotas}" />
        </div>` : ""}

      ${form.medioPago === "efectivo" ? `
        <div class="field">
          <label class="label">¿De dónde salió el efectivo?</label>
          <select id="efectivoOrigenSelect" class="input">
            <option value="cajero" ${form.efectivoOrigen==='cajero'?"selected":""}>Retiro de cajero</option>
            <option value="cliente" ${form.efectivoOrigen==='cliente'?"selected":""}>Pago recibido en efectivo (cliente/trabajo)</option>
            <option value="otro" ${form.efectivoOrigen==='otro'?"selected":""}>Otro</option>
          </select>
        </div>
        ${form.efectivoOrigen === "cajero" ? `
          <div class="field">
            <label class="label">¿De qué cuenta débito se retiró?</label>
            <select id="cajeroAccountSelect" class="input">
              <option value="">Sin asignar</option>
              ${debitAccounts().map((a) => `<option value="${a.id}" ${form.cajeroAccountId===a.id?"selected":""}>${a.nombre}</option>`).join("")}
            </select>
            <div class="empty-text" style="padding:6px 0 0">Esto descuenta el saldo de esa cuenta, aunque el gasto en sí sea en efectivo.</div>
          </div>` : ""}
      ` : ""}
    ` : `
      <div class="field">
        <label class="label">Cuenta bancaria</label>
        <select id="accountSelect" class="input">
          <option value="">Sin asignar / efectivo</option>
          ${debitAccounts().map((a) => `<option value="${a.id}" ${form.accountId===a.id?"selected":""}>${a.nombre}</option>`).join("")}
        </select>
        ${debitAccounts().length === 0 ? `<div class="empty-text" style="padding:8px 0 0">Aún no tienes bancos cargados. <a href="#" id="goBancos" style="color:#002A7A;font-weight:700">Agregar uno</a></div>` : ""}
      </div>
    `}

    <div class="field">
      <label class="label">Nota / comercio (opcional)</label>
      <input id="noteInput" type="text" placeholder="Ej: Sodimac, cliente Las Condes..." class="input" value="${form.note}" />
    </div>

    <button id="submitBtn" class="submit-btn">Guardar movimiento</button>
  `;

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
  const accSel = document.getElementById("accountSelect");
  if (accSel) accSel.addEventListener("change", (e) => { form.accountId = e.target.value; });
  document.getElementById("noteInput").addEventListener("input", (e) => { form.note = e.target.value; });
  const goBancos = document.getElementById("goBancos");
  if (goBancos) goBancos.addEventListener("click", (e) => { e.preventDefault(); setTab("bancos"); });

  const pd = document.getElementById("pagoDebito");
  const pc = document.getElementById("pagoCredito");
  const pe = document.getElementById("pagoEfectivo");
  if (pd) pd.addEventListener("click", () => { form.medioPago = "debito"; form.accountId = ""; render(); });
  if (pc) pc.addEventListener("click", () => { form.medioPago = "credito"; form.accountId = ""; render(); });
  if (pe) pe.addEventListener("click", () => { form.medioPago = "efectivo"; form.accountId = ""; render(); });
  const creditSel = document.getElementById("creditAccountSelect");
  if (creditSel) creditSel.addEventListener("change", (e) => { form.accountId = e.target.value; });
  const cuotasInput = document.getElementById("cuotasInput");
  if (cuotasInput) cuotasInput.addEventListener("input", (e) => { form.cuotas = e.target.value; });
  const efectivoSel = document.getElementById("efectivoOrigenSelect");
  if (efectivoSel) efectivoSel.addEventListener("change", (e) => { form.efectivoOrigen = e.target.value; render(); });
  const cajeroSel = document.getElementById("cajeroAccountSelect");
  if (cajeroSel) cajeroSel.addEventListener("change", (e) => { form.cajeroAccountId = e.target.value; });

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
                ${acc ? `<span class="tx-tag">${acc.tipo==='credito'?'💳':'🏦'} ${acc.nombre}</span>` : ""}
                ${e.medioPago === "credito" ? `<span class="tx-tag">💳 ${e.cuotas > 1 ? e.cuotas + " cuotas" : "1 cuota"}</span>` : ""}
                ${e.medioPago === "efectivo" ? `<span class="tx-tag">💵 Efectivo${e.efectivoOrigen==='cajero'?' (cajero)':e.efectivoOrigen==='cliente'?' (cliente)':''}</span>` : ""}
                ${e.author ? `<span class="tx-tag">👤 ${e.author}</span>` : ""}
              </div>
            </div>
            <div class="tx-amount" style="color:${color}">${isPositive ? "+" : "-"}${money(e.amount)}</div>
            <button class="delete-btn" data-id="${e.id}">🗑️</button>
          </div>`;
      }).join("")}
    </div>

    <button id="exportPdfBtn" class="submit-btn submit-btn-secondary" style="margin-top:18px">📄 Generar reporte PDF de este periodo</button>
  `;

  document.getElementById("monthFilter").addEventListener("input", (e) => { filters.month = e.target.value; render(); });
  document.getElementById("bucketFilter").addEventListener("change", (e) => { filters.bucket = e.target.value; render(); });
  document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => { filters.type = c.dataset.type; render(); }));
  document.querySelectorAll(".delete-btn").forEach((b) => b.addEventListener("click", () => {
    if (confirm("¿Eliminar este movimiento?")) deleteMovement(b.dataset.id);
  }));
  document.getElementById("exportPdfBtn").addEventListener("click", () => generatePDFReport(list, breakdownArr, total));
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
  const totalDebito = debitAccounts().reduce((a, acc) => a + accountStatus(acc).saldo, 0);
  const totalDeuda = creditAccounts().reduce((a, acc) => a + accountStatus(acc).deuda, 0);

  el.innerHTML = `
    <div class="stats-grid" style="grid-template-columns:1fr 1fr">
      <div class="stat-card" style="border-color:#16A34A55"><div>🏦</div><div class="stat-label">Saldo en cuentas débito</div><div class="stat-value" style="color:#16A34A">${money(totalDebito)}</div></div>
      <div class="stat-card" style="border-color:#DC262655"><div>💳</div><div class="stat-label">Deuda en tarjetas</div><div class="stat-value" style="color:#DC2626">${money(totalDeuda)}</div></div>
    </div>

    <div class="section-label">Cuentas débito</div>
    <div style="display:grid;gap:8px;margin-top:8px">
      ${debitAccounts().length === 0 ? `<div class="empty-text">Aún no tienes cuentas débito.</div>` : debitAccounts().map((a) => {
        const st = accountStatus(a);
        return `<div class="account-card">
          <div><div class="account-name">🏦 ${a.nombre}</div><div class="card-sub">Saldo inicial: ${money(a.saldoInicial)}</div></div>
          <div style="display:flex;align-items:center;gap:10px"><span class="account-balance" style="color:${st.saldo>=0?'#12151A':'#DC2626'}">${money(st.saldo)}</span><button class="delete-btn" data-id="${a.id}">🗑️</button></div>
        </div>`;
      }).join("")}
    </div>

    <div class="section-label">Tarjetas de crédito</div>
    <div style="display:grid;gap:8px;margin-top:8px">
      ${creditAccounts().length === 0 ? `<div class="empty-text">Aún no tienes tarjetas de crédito.</div>` : creditAccounts().map((a) => {
        const st = accountStatus(a);
        const pct = st.linea > 0 ? Math.min(100, (st.deuda / st.linea) * 100) : 0;
        return `<div class="card card-block" style="border-left:3px solid #DC2626">
          <div class="bucket-card-head"><div class="icon-circle" style="background:#DC262622">💳</div><div class="card-label">${a.nombre}</div></div>
          <div class="bucket-io-row">
            <div><div class="bucket-io-label">Deuda actual</div><div class="bucket-io-value" style="color:#DC2626">${money(st.deuda)}</div></div>
            <div style="text-align:right"><div class="bucket-io-label">Disponible</div><div class="bucket-io-value" style="color:#16A34A">${money(st.disponible)}</div></div>
          </div>
          <div style="margin-top:10px"><div class="progress-track"><div class="progress-fill" style="width:${pct}%;background:#DC2626"></div></div><div class="progress-text">${pct.toFixed(1)}% usado de ${money(st.linea)}</div></div>
          <button class="delete-btn pay-card-toggle" data-id="${a.id}" style="margin-top:8px;font-size:12px;color:#002A7A;font-weight:700">💰 Pagar esta tarjeta</button>
          <button class="delete-btn" data-id="${a.id}" style="float:right">🗑️</button>
          ${payForm.creditId === a.id ? `
            <div class="field">
              <label class="label">Monto a pagar</label>
              <input id="payAmountInput" type="number" class="input" value="${payForm.amount}" />
            </div>
            <div class="field">
              <label class="label">¿De qué cuenta débito sale el pago? (opcional)</label>
              <select id="payFromSelect" class="input">
                <option value="">No descontar de ninguna cuenta</option>
                ${debitAccounts().map((d) => `<option value="${d.id}" ${payForm.fromAccountId===d.id?"selected":""}>${d.nombre}</option>`).join("")}
              </select>
            </div>
            <button id="confirmPayBtn" class="submit-btn">Confirmar pago</button>
          ` : ""}
        </div>`;
      }).join("")}
    </div>

    <div class="section-label">Agregar cuenta bancaria</div>
    <div class="type-row">
      <button id="tipoDebitoBtn" class="type-btn ${bankForm.tipo==='debito'?'ingreso-active':''}">🏦 Débito</button>
      <button id="tipoCreditoBtn" class="type-btn ${bankForm.tipo==='credito'?'egreso-active':''}">💳 Crédito</button>
    </div>
    <div class="field">
      <label class="label">Nombre del banco / tarjeta</label>
      <input id="bankNameInput" type="text" class="input" placeholder="Ej: Banco Estado, Falabella Visa..." value="${bankForm.nombre}" />
    </div>
    ${bankForm.tipo === "debito" ? `
      <div class="field">
        <label class="label">Saldo inicial actual (CLP)</label>
        <input id="bankBalanceInput" type="number" class="input" placeholder="0" value="${bankForm.saldoInicial}" />
      </div>` : `
      <div class="field">
        <label class="label">Línea de crédito total (CLP)</label>
        <input id="bankLineaInput" type="number" class="input" placeholder="Ej: 1500000" value="${bankForm.lineaCredito}" />
      </div>`}
    <button id="addBankBtn" class="submit-btn">Agregar cuenta bancaria</button>
    <div class="empty-text" style="margin-top:14px">Cada egreso o ingreso que asignes a un banco/tarjeta ajusta su saldo o deuda automáticamente.</div>
  `;

  document.getElementById("tipoDebitoBtn").addEventListener("click", () => { bankForm.tipo = "debito"; render(); });
  document.getElementById("tipoCreditoBtn").addEventListener("click", () => { bankForm.tipo = "credito"; render(); });
  document.getElementById("bankNameInput").addEventListener("input", (e) => { bankForm.nombre = e.target.value; });
  const bBal = document.getElementById("bankBalanceInput");
  if (bBal) bBal.addEventListener("input", (e) => { bankForm.saldoInicial = e.target.value; });
  const bLinea = document.getElementById("bankLineaInput");
  if (bLinea) bLinea.addEventListener("input", (e) => { bankForm.lineaCredito = e.target.value; });
  document.getElementById("addBankBtn").addEventListener("click", addAccount);

  document.querySelectorAll(".pay-card-toggle").forEach((b) => b.addEventListener("click", () => {
    payForm.creditId = payForm.creditId === b.dataset.id ? "" : b.dataset.id;
    render();
  }));
  const payAmount = document.getElementById("payAmountInput");
  if (payAmount) payAmount.addEventListener("input", (e) => { payForm.amount = e.target.value; });
  const payFrom = document.getElementById("payFromSelect");
  if (payFrom) payFrom.addEventListener("change", (e) => { payForm.fromAccountId = e.target.value; });
  const confirmPay = document.getElementById("confirmPayBtn");
  if (confirmPay) confirmPay.addEventListener("click", payCreditCard);

  document.querySelectorAll(".delete-btn:not(.pay-card-toggle)").forEach((b) => b.addEventListener("click", () => deleteAccount(b.dataset.id)));
}

// ---------- Reporte PDF ----------
function loadImageAsBase64(url) {
  return fetch(url)
    .then((r) => r.blob())
    .then((blob) => new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    }));
}

async function generatePDFReport(list, breakdownArr, total) {
  if (!window.jspdf) { showToast("No se pudo cargar el generador de PDF"); return; }
  showToast("Generando reporte...");
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const [y, m] = filters.month.split("-");
  const periodLabel = `${MONTHS_ES[parseInt(m, 10) - 1]} ${y}`;
  const bucketLabel = filters.bucket === "all" ? "Todas las cuentas" : (getBucket(filters.bucket) || {}).label || filters.bucket;
  const typeLabel = filters.type === "all" ? "Ingresos y egresos" : filters.type === "ingreso" ? "Solo ingresos" : filters.type === "egreso" ? "Solo egresos" : "Solo aportes";

  let logoData = null;
  try { logoData = await loadImageAsBase64("icons/icon-192.png"); } catch { logoData = null; }

  const marginX = 14;
  let cursorY = 18;
  if (logoData) {
    doc.addImage(logoData, "PNG", marginX, 10, 16, 16);
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(0, 42, 122);
  doc.text("Control Financiero — Familia Palma", logoData ? marginX + 20 : marginX, cursorY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  cursorY += 7;
  doc.text(`Periodo: ${periodLabel}  ·  Filtro: ${bucketLabel}  ·  ${typeLabel}`, marginX, cursorY);
  cursorY += 5;
  doc.text(`Generado el ${new Date().toLocaleDateString("es-CL")} por ${authorName || "—"}`, marginX, cursorY);

  cursorY += 10;
  doc.setDrawColor(220, 220, 220);
  doc.line(marginX, cursorY, 196, cursorY);
  cursorY += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(18, 21, 26);
  doc.text(`Total del periodo: ${money(total)}`, marginX, cursorY);
  cursorY += 8;

  if (breakdownArr.length > 0) {
    doc.autoTable({
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      head: [["Categoría", "Monto"]],
      body: breakdownArr.map(([cat, val]) => [cat, money(val)]),
      theme: "grid",
      headStyles: { fillColor: [0, 42, 122], textColor: 255, fontSize: 10 },
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: { 1: { halign: "right" } },
    });
    cursorY = doc.lastAutoTable.finalY + 10;
  }

  const rows = list.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).map((e) => {
    const meta = getBucket(e.bucket);
    const acc = accounts.find((a) => a.id === e.accountId);
    const medio = e.medioPago === "credito" ? `Crédito (${e.cuotas || 1}c)` : e.medioPago === "efectivo" ? "Efectivo" : e.medioPago === "debito" ? "Débito" : "—";
    const signo = e.type === "ingreso" ? "+" : "-";
    return [e.date, e.category, meta.label, medio, acc ? acc.nombre : "—", e.author || "—", `${signo}${money(e.amount)}`];
  });

  if (rows.length > 0) {
    doc.autoTable({
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      head: [["Fecha", "Categoría", "Cuenta", "Medio", "Banco", "Autor", "Monto"]],
      body: rows,
      theme: "striped",
      headStyles: { fillColor: [0, 42, 122], textColor: 255, fontSize: 9 },
      styles: { fontSize: 8, cellPadding: 2.5 },
      columnStyles: { 6: { halign: "right" } },
      didParseCell: (data) => {
        if (data.section === "body" && data.column.index === 6) {
          const val = data.cell.raw;
          data.cell.styles.textColor = val.startsWith("+") ? [22, 163, 74] : [220, 38, 38];
        }
      },
    });
  } else {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(10);
    doc.text("Sin movimientos en este periodo.", marginX, cursorY);
  }

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Página ${i} de ${pageCount}`, 196, 290, { align: "right" });
  }

  doc.save(`reporte-control-financiero-${filters.month}.pdf`);
}

// ---------- PWA: registrar service worker ----------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}
