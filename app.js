/* -----------------------------------------------------------
   API (base compartilhada em JSON via Cloudflare Worker)
----------------------------------------------------------- */

// Troque pela URL do seu Worker depois (ex: https://ap-daniel.workers.dev)
const API_BASE = "https://p-daniel.dannielld23.workers.dev";
const API_GET_STATUS = `${API_BASE}/api/status`;
const API_SET_STATUS = `${API_BASE}/api/status`;

// Chave admin (você escolhe uma string forte)
// IMPORTANTE: isso NÃO é “login”, é só um “modo edição”.
// Para produção, não deixe essa chave exposta no código.
// (mais abaixo eu explico um jeito melhor: chave digitada + Worker valida)
let ADMIN_KEY_TYPED = "";
let IS_ADMIN = false;

/* -----------------------------------------------------------
   CONFIGURAÇÕES DO SEU CENÁRIO
----------------------------------------------------------- */

const START_VIEW = { year: 2026, monthIndex: 0 };   // jan/2026
const END_VIEW   = { year: 2027, monthIndex: 3 };   // abr/2027

// Período preenchido (12 meses) - mar/2026 até fev/2027
// (contrato/seguro 12 meses; meses fora ficam em branco)
const ACTIVE_START = { year: 2026, monthIndex: 2 }; // mar/2026
const ACTIVE_END   = { year: 2027, monthIndex: 1 }; // fev/2027
const RENT_START = { year: 2026, monthIndex: 3 }; // abril/2026
const RENT_END   = { year: 2027, monthIndex: 2 }; // março/2027

const DUE_DAY = 3;

// Valores (do seu texto)
const FIRE_TOTAL = 153.76;
const FIRE_INSTALLMENTS = 4;
const FIRE_INSTALLMENT_VALUE = 38.44;

const BOND_TOTAL = 2239.84;
const BOND_INSTALLMENTS = 12;
const BOND_INSTALLMENT_VALUE = 186.65;

const RENT_MONTHLY = 2600;

// Divisões (como no seu exemplo)
const PEOPLE = ["DANIEL", "FIALHO", "JOSEMAR"];

// Seguro dividido por 3 igual
const FIRE_PER_PERSON = round2(FIRE_INSTALLMENT_VALUE / 3); // 12.81...
const BOND_PER_PERSON = round2(BOND_INSTALLMENT_VALUE / 3); // 62.21...

// Aluguel não é dividido igual (exatamente como você mostrou)
const RENT_BY_PERSON = {
  "DANIEL": 833,
  "FIALHO": 833,
  "JOSEMAR": 933,
};

/* -----------------------------------------------------------
   UTILIDADES
----------------------------------------------------------- */

function round2(n){ return Math.round((n + Number.EPSILON) * 100) / 100; }

function moneyBR(n){
  if (n === null || n === undefined) return "";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ymKey(y, m){ return `${y}-${String(m+1).padStart(2,"0")}`; }

function monthLabelPT(y, m){
  const months = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  return `${months[m]}/${y}`;
}

function isAfterOrEqual(a, b){
  if (a.year !== b.year) return a.year > b.year;
  return a.monthIndex >= b.monthIndex;
}
function isBeforeOrEqual(a, b){
  if (a.year !== b.year) return a.year < b.year;
  return a.monthIndex <= b.monthIndex;
}
function inRange(ym, start, end){
  return isAfterOrEqual(ym, start) && isBeforeOrEqual(ym, end);
}

function addMonth(ym){
  let y = ym.year, m = ym.monthIndex + 1;
  if (m > 11){ y += 1; m = 0; }
  return { year: y, monthIndex: m };
}

function diffMonths(a, b){
  // b - a em meses (assumindo b >= a no nosso uso)
  return (b.year - a.year) * 12 + (b.monthIndex - a.monthIndex);
}

/* -----------------------------------------------------------
   GERAÇÃO DE LINHAS (JAN/2026 → ABR/2027)
----------------------------------------------------------- */

function buildRows(){
  const rows = [];
  let cursor = { ...START_VIEW };

  while (true){
    const active = inRange(cursor, ACTIVE_START, ACTIVE_END);

    // índice do mês dentro do período ativo (0..11), usado para limitar parcelas
    let activeIndex = null;
    if (active){
      activeIndex = diffMonths(ACTIVE_START, cursor);
    }

    for (const person of PEOPLE){
      const row = {
        month: { ...cursor },
        monthLabel: monthLabelPT(cursor.year, cursor.monthIndex),
        due: `${String(DUE_DAY).padStart(2,"0")} de cada mês`,
        person,
        isBlank: !active,
        fire: null,
        bond: null,
        rent: null,
      };

      if (active){
        // Incêndio: 4 parcelas mar/2026..jun/2026 (activeIndex 0..3)
        row.fire = (activeIndex >= 0 && activeIndex < FIRE_INSTALLMENTS) ? FIRE_PER_PERSON : 0;

        // Fiança: 12 parcelas mar/2026..fev/2027 (activeIndex 0..11)
        row.bond = (activeIndex >= 0 && activeIndex < BOND_INSTALLMENTS) ? BOND_PER_PERSON : 0;

        // Aluguel: durante todo período ativo
        if (inRange(cursor, RENT_START, RENT_END)){
          row.rent = RENT_BY_PERSON[person] ?? 0;
        } else {
          row.rent = 0;
        }
      }

      row.total = (row.isBlank)
        ? null
        : round2((row.fire ?? 0) + (row.bond ?? 0) + (row.rent ?? 0));

      row.id = `${ymKey(cursor.year, cursor.monthIndex)}::${person}`;
      rows.push(row);
    }

    if (cursor.year === END_VIEW.year && cursor.monthIndex === END_VIEW.monthIndex) break;
    cursor = addMonth(cursor);
  }

  return rows;
}

/* -----------------------------------------------------------
   BASE COMPARTILHADA (GET/POST no Worker)
----------------------------------------------------------- */

async function fetchPaidFromServer(){
  try{
    const res = await fetch(API_GET_STATUS, { cache: "no-store" });
    if(!res.ok) throw new Error("Falha ao carregar status");
    const data = await res.json();
    return data.paid || {};
  }catch(e){
    console.warn("Não consegui carregar do servidor.", e);
    return {};
  }
}

async function savePaidToServer(paidObj){
  const res = await fetch(API_SET_STATUS, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": ADMIN_KEY_TYPED
    },
    body: JSON.stringify({ paid: paidObj })
  });

  if(!res.ok){
    const t = await res.text();
    throw new Error(t || "Falha ao salvar");
  }
}

/* -----------------------------------------------------------
   RENDER
----------------------------------------------------------- */

const tableBody = document.querySelector("#paymentsTable tbody");
const personFilter = document.getElementById("personFilter");
const blankFilter = document.getElementById("blankFilter");
const summaryText = document.getElementById("summaryText");
const btnReset = document.getElementById("btnReset");
const btnExport = document.getElementById("btnExport");

// (Se você adicionou o bloco admin no HTML)
const btnAdmin = document.getElementById("btnAdmin");
const adminKeyInput = document.getElementById("adminKey");
const adminHint = document.getElementById("adminHint");

let ALL_ROWS = buildRows();
let PAID = {}; // agora vem do servidor

function render(){
  tableBody.innerHTML = "";

  const pFilter = personFilter.value;
  const bFilter = blankFilter.value;

  const visible = ALL_ROWS.filter(r => {
    if (pFilter !== "ALL" && r.person !== pFilter) return false;
    if (bFilter === "HIDE_BLANK" && r.isBlank) return false;
    return true;
  });

  for (const r of visible){

    const tr = document.createElement("tr");

    if(r.person === "DANIEL") tr.classList.add("row-daniel");
    if(r.person === "FIALHO") tr.classList.add("row-fialho");
    if(r.person === "JOSEMAR") tr.classList.add("row-josemar");

    if (r.isBlank){
      tr.innerHTML = `
        <td><span class="badge blank">${r.monthLabel}</span></td>
        <td>${r.person}</td>
        <td colspan="9"></td>
      `;
      tableBody.appendChild(tr);
      continue;
    }

    const paidObj = PAID[r.id] || { fire:false, bond:false, rent:false };

    let paidAmount = 0;
    if(paidObj.fire) paidAmount += r.fire;
    if(paidObj.bond) paidAmount += r.bond;
    if(paidObj.rent) paidAmount += r.rent;

    const remaining = round2(r.total - paidAmount);
    const isFullPaid = remaining === 0;

    tr.innerHTML = `
      <td><span class="badge">${r.monthLabel}</span></td>
      <td><b>${r.person}</b></td>

      <td class="money">${moneyBR(r.fire)}</td>
      <td class="center">
        <input type="checkbox" class="item-check"
          data-id="${r.id}" data-type="fire"
          ${paidObj.fire ? "checked" : ""}
          ${IS_ADMIN ? "" : 'data-locked="true"'}
        >
      </td>

      <td class="money">${moneyBR(r.bond)}</td>
      <td class="center">
        <input type="checkbox" class="item-check"
          data-id="${r.id}" data-type="bond"
          ${paidObj.bond ? "checked" : ""}
          ${IS_ADMIN ? "" : 'data-locked="true"'}
        >
      </td>

      <td class="money">${moneyBR(r.rent)}</td>
      <td class="center">
        <input type="checkbox" class="item-check"
          data-id="${r.id}" data-type="rent"
          ${paidObj.rent ? "checked" : ""}
          ${IS_ADMIN ? "" : 'data-locked="true"'}
        >
      </td>

      <td class="total">${moneyBR(r.total)}</td>
      <td class="money">${moneyBR(remaining)}</td>

      <td class="center">
        <input type="checkbox" class="total-check"
          data-id="${r.id}"
          ${isFullPaid ? "checked" : ""}
          ${IS_ADMIN ? "" : 'data-locked="true"'}
        >
      </td>
    `;

    if(isFullPaid) tr.classList.add("row-paid");

    tableBody.appendChild(tr);
  }

  wireCheckboxes();
  renderSummary(visible);
}


function wireCheckboxes(){

  document.querySelectorAll(".item-check").forEach(ch => {
    ch.addEventListener("click", async (e) => {

      if(!IS_ADMIN){
        e.preventDefault();
        return;
      }

      const id = ch.dataset.id;
      const type = ch.dataset.type;

      if(!PAID[id]){
        PAID[id] = { fire:false, bond:false, rent:false };
      }

      PAID[id][type] = ch.checked;

      try{
        await savePaidToServer(PAID);
        render();
      }catch(err){
        alert("Erro ao salvar.");
      }
    });
  });

  document.querySelectorAll(".total-check").forEach(ch => {
    ch.addEventListener("click", async () => {

      if(!IS_ADMIN){
        ch.checked = !ch.checked;
        return;
      }

      const id = ch.dataset.id;
      const checked = ch.checked;

      PAID[id] = {
        fire: checked,
        bond: checked,
        rent: checked
      };

      try{
        await savePaidToServer(PAID);
        render();
      }catch(err){
        alert("Erro ao salvar.");
      }
    });
  });


}


function renderSummary(visibleRows){

  const nonBlank = visibleRows.filter(r => !r.isBlank);

  const totalAll = round2(
    nonBlank.reduce((acc, r) => acc + (r.total ?? 0), 0)
  );

  let totalPaid = 0;

  for(const r of nonBlank){
    const paidObj = PAID[r.id] || { fire:false, bond:false, rent:false };

    if(paidObj.fire) totalPaid += r.fire;
    if(paidObj.bond) totalPaid += r.bond;
    if(paidObj.rent) totalPaid += r.rent;
  }

  totalPaid = round2(totalPaid);

  const open = round2(totalAll - totalPaid);

  summaryText.textContent =
    `Vencimento: dia ${String(DUE_DAY).padStart(2,"0")} | ` +
    `Total exibido: R$ ${moneyBR(totalAll)} | ` +
    `Pago: R$ ${moneyBR(totalPaid)} | ` +
    `Em aberto: R$ ${moneyBR(open)}`;
}

/* -----------------------------------------------------------
   EXPORT CSV
----------------------------------------------------------- */

function exportCSV(){
  const pFilter = personFilter.value;
  const bFilter = blankFilter.value;

  const rows = ALL_ROWS.filter(r => {
    if (pFilter !== "ALL" && r.person !== pFilter) return false;
    if (bFilter === "HIDE_BLANK" && r.isBlank) return false;
    return true;
  });

  const header = ["Mes","Quem paga","Incendio","Fianca","Aluguel","Total","Pago"];
  const lines = [header.join(";")];

  for (const r of rows){
    lines.push([
      r.monthLabel,
      r.person,
      r.isBlank ? "" : moneyBR(r.fire),
      r.isBlank ? "" : moneyBR(r.bond),
      r.isBlank ? "" : moneyBR(r.rent),
      r.isBlank ? "" : moneyBR(r.total),
      r.isBlank ? "" : (PAID[r.id] ? "SIM" : "NAO")
    ].join(";"));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "controle_pagamentos_ap.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

/* -----------------------------------------------------------
   FUNÇÃO COPIAR PIX
----------------------------------------------------------- */

function copyPix(){
  const key = document.getElementById("pixKey")?.innerText?.trim() || "";
  if(!key){
    alert("Chave PIX não encontrada.");
    return;
  }

  navigator.clipboard.writeText(key).then(() => {
    alert("Chave PIX copiada com sucesso!");
  }).catch(() => {
    alert("Erro ao copiar a chave.");
  });
}

/* -----------------------------------------------------------
   EVENTOS (FILTROS / BOTÕES)
----------------------------------------------------------- */

personFilter.addEventListener("change", render);
blankFilter.addEventListener("change", render);

btnReset.addEventListener("click", async () => {
  if (!IS_ADMIN){
    alert("Somente o administrador pode limpar marcações.");
    return;
  }

  if (!confirm("Quer limpar TODAS as marcações de pago na base compartilhada?")) return;

  try{
    PAID = {};
    await savePaidToServer(PAID);
    render();
  }catch(err){
    alert("Não consegui limpar na base compartilhada.\n" + err.message);
  }
});

btnExport.addEventListener("click", exportCSV);

// Modo admin (se o bloco existir)
btnAdmin.addEventListener("click", async () => {
  const v = (adminKeyInput.value || "").trim();
  ADMIN_KEY_TYPED = v;

  try{
    const res = await fetch(API_SET_STATUS, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": ADMIN_KEY_TYPED
      },
      body: JSON.stringify({ paid: PAID })
    });

    if(!res.ok){
      throw new Error("Unauthorized");
    }

    IS_ADMIN = true;
    adminHint.textContent = "Modo admin ativo • Você pode marcar pago";
    render();

  }catch{
    IS_ADMIN = false;
    adminHint.textContent = "Chave incorreta • Edição bloqueada";
    render();
  }
});

/* -----------------------------------------------------------
   START
----------------------------------------------------------- */

async function init(){
  PAID = await fetchPaidFromServer();
  render();
}

init();