/**
 * Language is determined by URL path (/en/ = English, otherwise Portuguese).
 * Switch language by navigating with the header links, not localStorage.
 */
const currentLang = /^\/en(\/|$)/.test(location.pathname) ? "en" : "pt";

function el(id) {
  return document.getElementById(id);
}

const form = el("tcoForm");
const acquisitionModel = el("acquisitionModel");
const financingEnabled = el("financingEnabled");
const maintenanceMode = el("maintenanceMode");
const tyresMode = el("tyresMode");
const resultsPanel = el("resultsPanel");
const feedback = el("simulatorFeedback");

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nonNegative(value) {
  return Math.max(0, toNumber(value));
}

function formatCurrency(value, fractionDigits = 0) {
  const locale = currentLang === "en" ? "en-US" : "pt-PT";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

function getIndicativeFiscalReading(motorization) {
  const pt = {
    combustion: "Enquadramento fiscal tendencialmente mais pressionado.",
    hybrid: "Leitura fiscal intermédia, dependente da política de frota.",
    electric: "Tende a beneficiar de enquadramento fiscal mais favorável.",
  };
  const en = {
    combustion: "Tax position tends to be more demanding.",
    hybrid: "Intermediate tax profile, depending on fleet policy.",
    electric: "Tends to benefit from a more favourable tax position.",
  };
  const map = currentLang === "en" ? en : pt;
  return (
    map[motorization] ||
    (currentLang === "en"
      ? "Tax position should be validated with full company data."
      : "Enquadramento fiscal a validar com os dados completos da empresa.")
  );
}

function getRecommendation(costPerKm) {
  if (costPerKm <= 0) {
    return currentLang === "en"
      ? "Enter your details to receive an indicative recommendation."
      : "Introduza os dados para obter uma recomendação indicativa.";
  }

  if (costPerKm < 0.3) {
    return currentLang === "en"
      ? "Very efficient profile for business use."
      : "Perfil muito eficiente para utilização empresarial.";
  }

  if (costPerKm < 0.5) {
    return currentLang === "en"
      ? "Balanced profile, with room for tax and operational optimisation."
      : "Perfil equilibrado, com margem de afinação fiscal e operacional.";
  }

  return currentLang === "en"
    ? "Profile with optimisation potential in acquisition, usage, and powertrain."
    : "Perfil com potencial de otimização em aquisição, utilização e motorização.";
}

function updateDynamicPlaceholders() {
  document.querySelectorAll("[data-placeholder-pt]").forEach((el) => {
    const pt = el.getAttribute("data-placeholder-pt");
    const en = el.getAttribute("data-placeholder-en");
    el.placeholder = currentLang === "en" ? en || pt : pt || en;
  });
}

function updateSelectOptions() {
  document.querySelectorAll("option[data-label-pt]").forEach((opt) => {
    const pt = opt.getAttribute("data-label-pt");
    const en = opt.getAttribute("data-label-en");
    opt.textContent = currentLang === "en" ? en || pt : pt || en;
  });
}

function toggleAcquisitionFields() {
  if (!acquisitionModel) return;
  const isRenting = acquisitionModel.value === "renting";

  document.querySelectorAll(".purchase-field").forEach((el) => {
    el.classList.toggle("is-hidden", isRenting);
  });

  document.querySelectorAll(".renting-field").forEach((el) => {
    el.classList.toggle("is-hidden", !isRenting);
  });
}

function toggleFinancingFields() {
  const isFinanced = financingEnabled?.value === "yes";
  document.querySelectorAll(".financing-field").forEach((field) => {
    field.classList.toggle("is-hidden", !isFinanced);
  });
}

function toggleMaintenanceFields() {
  const perKm = maintenanceMode?.value === "per_km";
  document.querySelectorAll(".maintenance-annual-field").forEach((field) => {
    field.classList.toggle("is-hidden", perKm);
  });
  document.querySelectorAll(".maintenance-per-km-field").forEach((field) => {
    field.classList.toggle("is-hidden", !perKm);
  });
}

function toggleTyresFields() {
  const perKm = tyresMode?.value === "per_km";
  document.querySelectorAll(".tyres-annual-field").forEach((field) => {
    field.classList.toggle("is-hidden", perKm);
  });
  document.querySelectorAll(".tyres-per-km-field").forEach((field) => {
    field.classList.toggle("is-hidden", !perKm);
  });
}

function setFeedback(message) {
  if (feedback) {
    feedback.textContent = message;
  }
}

function addValidationError(errors, condition, message) {
  if (condition) {
    errors.push(message);
  }
}

function getTexts() {
  return currentLang === "en"
    ? {
        invalid: "Please review the highlighted inputs: ",
        defaultHint: "Indicative single-vehicle simulation based on average market assumptions.",
        purchaseBase: "Acquisition/depreciation",
        rentingBase: "Renting base",
        energy: "Energy",
        maintenance: "Maintenance",
        tyres: "Tyres",
        insurance: "Insurance",
        taxes: "Taxes/fees",
        excess: "Excess mileage",
        downtime: "Downtime cost",
        downtimeNote: "Estimated based on operational averages",
      }
    : {
        invalid: "Por favor valide os campos: ",
        defaultHint: "Simulação indicativa para uma viatura, baseada em pressupostos médios de mercado.",
        purchaseBase: "Aquisição/depreciação",
        rentingBase: "Base de renting",
        energy: "Energia",
        maintenance: "Manutenção",
        tyres: "Pneus",
        insurance: "Seguro",
        taxes: "Impostos/taxas",
        excess: "Excesso de km",
        downtime: "Custo de indisponibilidade",
        downtimeNote: "Estimativa baseada em médias operacionais",
      };
}

function setBreakdownLine(id, label, value) {
  const node = el(id);
  if (node) {
    node.textContent = `${label}: ${formatCurrency(value)}`;
  }
}

function estimateAnnualDowntimeCost(kmPerYear) {
  if (kmPerYear > 0) {
    return kmPerYear * 0.01;
  }
  return 4 * 120;
}

if (acquisitionModel) {
  acquisitionModel.addEventListener("change", toggleAcquisitionFields);
}

if (financingEnabled) {
  financingEnabled.addEventListener("change", toggleFinancingFields);
}

if (maintenanceMode) {
  maintenanceMode.addEventListener("change", toggleMaintenanceFields);
}

if (tyresMode) {
  tyresMode.addEventListener("change", toggleTyresFields);
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const t = getTexts();

  const model = acquisitionModel?.value || "purchase";
  const powertrain = el("powertrainType")?.value || "";
  const kmPerYear = toNumber(el("annualKm")?.value);
  const years = toNumber(el("analysisYears")?.value);
  const totalMonths = years * 12;
  const totalKm = years * kmPerYear;
  const consumption = nonNegative(el("consumptionValue")?.value);
  const energyPrice = nonNegative(el("energyPrice")?.value);
  const energyCost = (totalKm / 100) * consumption * energyPrice;

  const maintenanceTotal =
    (maintenanceMode?.value || "annual") === "per_km"
      ? totalKm * nonNegative(el("maintenancePerKm")?.value)
      : years * nonNegative(el("maintenanceAnnual")?.value);

  const tyresTotal =
    (tyresMode?.value || "annual") === "per_km"
      ? totalKm * nonNegative(el("tyresPerKm")?.value)
      : years * nonNegative(el("tyresAnnual")?.value);

  const insuranceTotal = years * nonNegative(el("annualInsurance")?.value);
  const taxesTotal = years * nonNegative(el("annualTaxes")?.value);
  const annualDowntimeCost = estimateAnnualDowntimeCost(kmPerYear);
  const downtimeTotal = years * annualDowntimeCost;

  const errors = [];
  addValidationError(errors, !powertrain, currentLang === "en" ? "powertrain type" : "tipo de motorização");
  addValidationError(errors, kmPerYear <= 0, currentLang === "en" ? "annual mileage > 0" : "quilometragem anual > 0");
  addValidationError(errors, years <= 0, currentLang === "en" ? "analysis period > 0" : "período de análise > 0");

  let tcoTotal = 0;
  let baseCost = 0;
  let excessKmCost = 0;

  if (model === "purchase") {
    const purchasePrice = nonNegative(el("purchasePrice")?.value);
    const downPayment = nonNegative(el("downPayment")?.value);
    const residualValue = nonNegative(el("residualValue")?.value);
    const financedPrincipal = Math.max(0, purchasePrice - downPayment);
    const financeOn = financingEnabled?.value === "yes";

    addValidationError(
      errors,
      residualValue > purchasePrice,
      currentLang === "en"
        ? "residual value must be <= purchase price"
        : "valor residual deve ser <= preço de compra"
    );

    let financingCost = 0;
    if (financeOn) {
      const annualRate = nonNegative(el("annualInterestRate")?.value);
      const financingMonths = toNumber(el("financingMonths")?.value);
      addValidationError(
        errors,
        financingMonths <= 0,
        currentLang === "en" ? "financing term > 0 months" : "prazo de financiamento > 0 meses"
      );

      if (financingMonths > 0 && financedPrincipal > 0) {
        const monthlyRate = annualRate / 12 / 100;
        const monthlyPayment =
          monthlyRate === 0
            ? financedPrincipal / financingMonths
            : (financedPrincipal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -financingMonths));
        const totalPaidFinancing = monthlyPayment * financingMonths;
        financingCost = Math.max(0, totalPaidFinancing - financedPrincipal);
      }
    }

    const depreciation = Math.max(0, purchasePrice - residualValue);
    baseCost = downPayment + financingCost + depreciation;
    tcoTotal =
      baseCost +
      energyCost +
      maintenanceTotal +
      tyresTotal +
      insuranceTotal +
      taxesTotal +
      downtimeTotal;
  } else {
    const monthlyRent = nonNegative(el("monthlyRent")?.value);
    const initialPayment = nonNegative(el("initialPayment")?.value);
    const contractMonths = toNumber(el("contractMonths")?.value);
    const annualIncludedKm = nonNegative(el("annualIncludedKm")?.value);
    const excessMileageCostPerKm = nonNegative(el("excessMileageCost")?.value);

    addValidationError(errors, contractMonths <= 0, currentLang === "en" ? "contract duration > 0 months" : "duração do contrato > 0 meses");

    const includedKmTotal = annualIncludedKm * (Math.max(contractMonths, 0) / 12);
    const excessKm = Math.max(0, totalKm - includedKmTotal);
    excessKmCost = excessKm * excessMileageCostPerKm;

    baseCost = monthlyRent * Math.max(contractMonths, 0) + initialPayment;
    const maintenanceExtra = el("maintenanceIncluded")?.value === "yes" ? 0 : maintenanceTotal;
    const tyresExtra = el("tyresIncluded")?.value === "yes" ? 0 : tyresTotal;
    const insuranceExtra = el("insuranceIncluded")?.value === "yes" ? 0 : insuranceTotal;
    const taxesExtra = el("taxesIncluded")?.value === "yes" ? 0 : taxesTotal;

    tcoTotal =
      baseCost +
      excessKmCost +
      energyCost +
      maintenanceExtra +
      tyresExtra +
      insuranceExtra +
      taxesExtra +
      downtimeTotal;
  }

  if (errors.length > 0 || totalMonths <= 0 || totalKm <= 0) {
    addValidationError(errors, totalMonths <= 0, currentLang === "en" ? "analysis period > 0 months" : "período de análise > 0 meses");
    addValidationError(errors, totalKm <= 0, currentLang === "en" ? "total mileage > 0" : "quilometragem total > 0");
    setFeedback(t.invalid + errors.join(", "));
    resultsPanel?.classList.add("is-hidden");
    return;
  }

  const monthlyAverageCost = tcoTotal / totalMonths;
  const costPerKm = tcoTotal / totalKm;

  el("resultTotalPeriod").textContent = formatCurrency(tcoTotal);
  el("resultAnnualCost").textContent = formatCurrency(monthlyAverageCost);
  el("resultCostPerKm").textContent = formatCurrency(costPerKm, 2);
  el("resultFiscal").textContent = getIndicativeFiscalReading(powertrain);
  el("resultRecommendation").textContent = getRecommendation(costPerKm);

  setBreakdownLine("resultBreakdownBase", model === "purchase" ? t.purchaseBase : t.rentingBase, baseCost);
  setBreakdownLine("resultBreakdownEnergy", t.energy, energyCost);
  setBreakdownLine("resultBreakdownMaintenance", t.maintenance, maintenanceTotal);
  setBreakdownLine("resultBreakdownTyres", t.tyres, tyresTotal);
  setBreakdownLine("resultBreakdownInsurance", t.insurance, insuranceTotal);
  setBreakdownLine("resultBreakdownTaxes", t.taxes, taxesTotal);
  setBreakdownLine("resultBreakdownExcess", t.excess, excessKmCost);
  const downtimeNode = el("resultBreakdownDowntime");
  if (downtimeNode) {
    downtimeNode.textContent = `${t.downtime}: ${formatCurrency(downtimeTotal)} (${t.downtimeNote})`;
  }

  setFeedback(t.defaultHint);
  resultsPanel?.classList.remove("is-hidden");
});

toggleAcquisitionFields();
toggleFinancingFields();
toggleMaintenanceFields();
toggleTyresFields();
updateDynamicPlaceholders();
updateSelectOptions();
