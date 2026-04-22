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
const resultsPanel = el("resultsPanel");
const feedback = el("simulatorFeedback");
const siteHeader = document.querySelector(".site-header");
const navToggle = document.querySelector(".nav-toggle");

/**
 * Calibration constants — keep out of DOM; tune here.
 */
const TCO_INTERNAL = {
  maintenanceBase: { combustion: 430, hybrid: 470, electric: 320 },
  tyresBase: { combustion: 200, hybrid: 220, electric: 170 },
  taxesBase: { combustion: 140, hybrid: 125, electric: 95 },
  insuranceBase: { combustion: 480, hybrid: 450, electric: 420 },
  profileFactor: { urbano: 1.1, misto: 1, estrada: 0.95 },
  defaultExcessMileagePerKm: 0.09,
  kmOpexScale(annualKm) {
    if (annualKm <= 0) return 1;
    return Math.min(1.35, Math.max(0.82, 1 + (annualKm - 20000) / 90000));
  },
};

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nonNegative(value) {
  return Math.max(0, toNumber(value));
}

/**
 * Tetos legais de base tributável (sem IVA) para leitura indicativa de dedução de IVA em viaturas (PT).
 * Não altera o TCO.
 */
const PT_IVA_FISCAL = {
  CAP_BEV_EX_VAT: 62500,
  CAP_PHEV_EX_VAT: 50000,
  /** IVA normal à data; usado só para converter PVP com IVA → base sem IVA */
  DEFAULT_VAT_RATE: 0.23,
};

/**
 * Elegibilidade binária (sem dedução parcial) para o teto de base sem IVA em BEV/PHEV.
 * Se o preço for com IVA, converte antes de comparar: preco_sem_iva = preco / (1 + taxaIVA).
 *
 * @param {number} preco Valor indicado pelo utilizador
 * @param {'BEV'|'PHEV'} tipo BEV = 100% elétrico; PHEV = híbrido plug-in (a categoria «Híbrido» no simulador assume PHEV para este teto)
 * @param {number} taxaIVA ex.: 0.23
 * @param {boolean} [inputPriceIsGross=true] true = preço com IVA (PVP); false = já sem IVA
 * @returns {{ applicable: boolean, eligible: boolean, precoSemIva: number, estimatedVatComponent: number | null }}
 */
function calculateVatEligibility(preco, tipo, taxaIVA, inputPriceIsGross = true) {
  const r = nonNegative(taxaIVA);
  const p = nonNegative(preco);
  const precoSemIva =
    p > 0 && inputPriceIsGross && r > 0 ? p / (1 + r) : p;
  let estimatedVatComponent = null;
  if (p > 0) {
    estimatedVatComponent = inputPriceIsGross && r > 0 ? p - precoSemIva : p * r;
  }
  if (tipo !== "BEV" && tipo !== "PHEV") {
    return { applicable: false, eligible: false, precoSemIva, estimatedVatComponent };
  }
  let eligible = false;
  if (tipo === "BEV" && precoSemIva <= PT_IVA_FISCAL.CAP_BEV_EX_VAT) {
    eligible = true;
  }
  if (tipo === "PHEV" && precoSemIva <= PT_IVA_FISCAL.CAP_PHEV_EX_VAT) {
    eligible = true;
  }
  return { applicable: true, eligible, precoSemIva, estimatedVatComponent };
}

function powertrainToVatVehicleType(powertrain) {
  if (powertrain === "electric") return "BEV";
  if (powertrain === "hybrid") return "PHEV";
  return null;
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

function powertrainKey(powertrain) {
  if (powertrain === "hybrid" || powertrain === "electric" || powertrain === "combustion") {
    return powertrain;
  }
  return "combustion";
}

/**
 * Annual maintenance estimate (€/year) from powertrain, usage profile, annual km.
 */
function estimateMaintenance(powertrain, profile, annualKm) {
  const k = powertrainKey(powertrain);
  const profileFac = TCO_INTERNAL.profileFactor[profile] ?? 1;
  const km = TCO_INTERNAL.kmOpexScale(annualKm);
  return (TCO_INTERNAL.maintenanceBase[k] ?? 420) * profileFac * km;
}

/**
 * Annual tyres estimate (€/year).
 */
function estimateTyres(powertrain, profile, annualKm) {
  const k = powertrainKey(powertrain);
  const profileFac = TCO_INTERNAL.profileFactor[profile] ?? 1;
  const km = TCO_INTERNAL.kmOpexScale(annualKm);
  return (TCO_INTERNAL.tyresBase[k] ?? 200) * profileFac * km;
}

/**
 * Annual taxes / registration-type fees estimate (€/year).
 */
function estimateTaxes(powertrain, profile) {
  const k = powertrainKey(powertrain);
  const profileFac = TCO_INTERNAL.profileFactor[profile] ?? 1;
  return (TCO_INTERNAL.taxesBase[k] ?? 120) * profileFac;
}

function estimateDefaultInsuranceAnnual(powertrain, profile) {
  const k = powertrainKey(powertrain);
  const profileFac = TCO_INTERNAL.profileFactor[profile] ?? 1;
  return (TCO_INTERNAL.insuranceBase[k] ?? 450) * profileFac;
}

/**
 * Total energy cost over the analysis period (€).
 */
function calculateEnergyCost(totalKm, consumptionPer100km, energyUnitPrice) {
  const km = Math.max(0, totalKm);
  const cons = nonNegative(consumptionPer100km);
  const price = nonNegative(energyUnitPrice);
  return (km / 100) * cons * price;
}

/**
 * Estimated resale / residual value (€) at end of the analysis period.
 * Internal market-style heuristic (age, mileage band, powertrain mix, usage).
 * Replaceable hook for future valuation API — not supplier-specific data.
 */
function estimateResidualValue({ purchasePrice, powertrain, profile, annualKm, years }) {
  const price = Math.max(0, purchasePrice);
  const y = Math.max(0.25, Math.min(15, years));
  const kmYear = Math.max(0, annualKm);
  const totalKm = kmYear * years;

  if (price <= 0 || years <= 0) return 0;

  const ptKey = powertrainKey(powertrain);
  const powertrainRetention =
    ptKey === "electric" ? 1.09 : ptKey === "hybrid" ? 1.045 : 1;

  const profileRetention =
    profile === "urbano" ? 0.97 : profile === "estrada" ? 1.015 : 1;

  const ageRetention = Math.exp(-0.155 * y);

  const kmRetention = Math.exp(-0.0000084 * totalKm);

  const referenceAnnualKm = 17000;
  const annualIntensity =
    kmYear > 0 ? Math.min(2.15, Math.max(0.55, kmYear / referenceAnnualKm)) : 1;
  const intensityAdj = Math.pow(annualIntensity, -0.28);

  let ratio =
    ageRetention * kmRetention * powertrainRetention * profileRetention * intensityAdj;

  ratio = Math.min(0.76, Math.max(0.14, ratio));

  const raw = price * ratio;
  return Math.min(price, Math.round(raw));
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
    : "Perfil com potencial de optimização em aquisição, utilização e motorização.";
}

function updateDynamicPlaceholders() {
  document.querySelectorAll("[data-placeholder-pt]").forEach((node) => {
    const pt = node.getAttribute("data-placeholder-pt");
    const en = node.getAttribute("data-placeholder-en");
    node.placeholder = currentLang === "en" ? en || pt : pt || en;
  });
}

function updateSelectOptions() {
  document.querySelectorAll("option[data-label-pt]").forEach((opt) => {
    const pt = opt.getAttribute("data-label-pt");
    const en = opt.getAttribute("data-label-en");
    opt.textContent = currentLang === "en" ? en || pt : pt || en;
  });
}

function setupMobileNavigation() {
  if (!siteHeader || !navToggle) return;

  const closeMenu = () => {
    siteHeader.classList.remove("is-menu-open");
    navToggle.setAttribute("aria-expanded", "false");
  };

  navToggle.addEventListener("click", () => {
    const isOpen = siteHeader.classList.toggle("is-menu-open");
    navToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth > 900) closeMenu();
  });

  siteHeader.querySelectorAll(".main-nav a").forEach((link) => {
    link.addEventListener("click", closeMenu);
  });
}

function toggleAcquisitionFields() {
  if (!acquisitionModel) return;
  const isRenting = acquisitionModel.value === "renting";

  document.querySelectorAll(".purchase-only").forEach((node) => {
    node.classList.toggle("is-hidden", isRenting);
  });

  document.querySelectorAll(".renting-only").forEach((node) => {
    node.classList.toggle("is-hidden", !isRenting);
  });

  toggleInternalOpexFields();
  toggleRentingInsuranceField();
}

function toggleInternalOpexFields() {
  const chk = el("useInternalOpexEstimate");
  const manual = document.querySelector(".purchase-manual-opex");
  if (!chk || !manual) return;
  const useEst = chk.checked;
  manual.classList.toggle("is-hidden", useEst);
  if (useEst) {
    manual.removeAttribute("open");
  } else {
    manual.setAttribute("open", "");
  }
}

function toggleRentingInsuranceField() {
  const rentInclIns = el("rentIncludesInsurance");
  const row = document.querySelector(".renting-insurance-field");
  if (!rentInclIns || !row) return;
  const hide = rentInclIns.checked;
  row.classList.toggle("is-hidden", hide);
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
        defaultHint:
          "Indicative simulation: purchase uses an internal residual estimate (shown in results); leasing follows your contract “includes” choices.",
        purchaseBase: "Net acquisition (price − estimated residual)",
        purchaseEntrada: "Down payment (not included in TCO total above)",
        rentingBase: "Lease payments + initial payment",
        energy: "Energy",
        maintenance: "Maintenance",
        tyres: "Tyres",
        insurance: "Insurance",
        taxes: "Taxes / fees",
        excess: "Excess mileage",
        other: "End of contract / other",
        maintEst: "(estimated)",
        tyresEst: "(estimated)",
        taxesEst: "(estimated)",
        insEst: "(estimated)",
        inclRent: "(included in payment)",
        vatIvaEligible: "Eligible for VAT deduction",
        vatIvaNotEligible: "Not eligible for VAT deduction",
      }
    : {
        invalid: "Por favor valide os campos: ",
        defaultHint:
          "Simulação indicativa: na compra o valor residual é estimado internamente (ver resultados); no renting aplicam-se as opções «incluído na renda».",
        purchaseBase: "Aquisição líquida (preço − residual estimado)",
        purchaseEntrada: "Entrada inicial (não entra no TCO indicado acima)",
        rentingBase: "Rendas + entrada inicial",
        energy: "Energia",
        maintenance: "Manutenção",
        tyres: "Pneus",
        insurance: "Seguro",
        taxes: "Impostos / taxas",
        excess: "Excesso de quilometragem",
        other: "Fim de contrato / outros",
        maintEst: "(estimado)",
        tyresEst: "(estimado)",
        taxesEst: "(estimado)",
        insEst: "(estimado)",
        inclRent: "(incluído na renda)",
        vatIvaEligible: "Elegível para dedução de IVA",
        vatIvaNotEligible: "Não elegível para dedução de IVA",
      };
}

function setBreakdownLine(id, label, value, suffix = "") {
  const node = el(id);
  if (node) {
    node.textContent = `${label}: ${formatCurrency(value)}${suffix}`;
  }
}

/**
 * Purchase TCO over the analysis period (€).
 * Aquisitivo: (preço − residual); entrada inicial não entra no TCO (é tesouraria, não duplicar o preço total).
 * + energia, seguro, impostos, manutenção, pneus. Juros de financiamento não modelados.
 */
function calculatePurchaseTCO(ctx) {
  const {
    purchasePrice,
    purchaseInitialPayment,
    years,
    kmPerYear,
    powertrain,
    profile,
    consumption,
    energyPrice,
    useInternalOpexEstimate,
    manualMaintenanceAnnual,
    manualTyresAnnual,
    manualTaxesAnnual,
    insuranceUserAnnual,
  } = ctx;

  const totalKm = years * kmPerYear;
  const energyTotal = calculateEnergyCost(totalKm, consumption, energyPrice);

  const residualEstimated = estimateResidualValue({
    purchasePrice,
    powertrain,
    profile,
    annualKm: kmPerYear,
    years,
  });

  const netAcquisition = Math.max(0, purchasePrice - residualEstimated);
  const initialCash = nonNegative(purchaseInitialPayment);

  let maintenanceAnnual;
  let tyresAnnual;
  let taxesAnnual;

  if (useInternalOpexEstimate) {
    maintenanceAnnual = estimateMaintenance(powertrain, profile, kmPerYear);
    tyresAnnual = estimateTyres(powertrain, profile, kmPerYear);
    taxesAnnual = estimateTaxes(powertrain, profile);
  } else {
    maintenanceAnnual = nonNegative(manualMaintenanceAnnual);
    tyresAnnual = nonNegative(manualTyresAnnual);
    taxesAnnual = nonNegative(manualTaxesAnnual);
  }

  const maintenanceTotal = years * maintenanceAnnual;
  const tyresTotal = years * tyresAnnual;
  const taxesTotal = years * taxesAnnual;

  const defaultIns = estimateDefaultInsuranceAnnual(powertrain, profile);
  const insuranceAnnualResolved =
    insuranceUserAnnual > 0 ? insuranceUserAnnual : defaultIns;
  const insuranceTotal = years * insuranceAnnualResolved;

  const tcoTotal =
    netAcquisition +
    energyTotal +
    insuranceTotal +
    taxesTotal +
    maintenanceTotal +
    tyresTotal;

  return {
    tcoTotal,
    netAcquisition,
    initialCash,
    energyTotal,
    maintenanceTotal,
    tyresTotal,
    taxesTotal,
    insuranceTotal,
    excessKmCost: 0,
    endContractCost: 0,
    rentPaymentsTotal: 0,
    maintenanceAnnualUsed: maintenanceAnnual,
    tyresAnnualUsed: tyresAnnual,
    taxesAnnualUsed: taxesAnnual,
    insuranceAnnualResolved,
    usedInternalMaintenance: useInternalOpexEstimate,
    usedInternalTyres: useInternalOpexEstimate,
    usedInternalTaxes: useInternalOpexEstimate,
    usedInternalInsurance: insuranceUserAnnual <= 0,
    residualEstimated,
  };
}

/**
 * Renting TCO over the analysis period (€).
 */
function calculateRentingTCO(ctx) {
  const {
    monthlyRent,
    months,
    rentingInitialPayment,
    kmPerYear,
    years,
    contractAnnualKm,
    powertrain,
    profile,
    consumption,
    energyPrice,
    rentIncludesMaintenance,
    rentIncludesTyres,
    rentIncludesTaxes,
    rentIncludesInsurance,
    insuranceUserAnnual,
    excessCostPerKmUser,
    excessKmPeriodUser,
    excessKmPeriodProvided,
    endContractCosts,
  } = ctx;

  const totalKm = years * kmPerYear;
  const energyTotal = calculateEnergyCost(totalKm, consumption, energyPrice);

  const rentPaymentsTotal = monthlyRent * months;
  const initialCash = nonNegative(rentingInitialPayment);

  const maintAnn = estimateMaintenance(powertrain, profile, kmPerYear);
  const tyresAnn = estimateTyres(powertrain, profile, kmPerYear);
  const taxesAnn = estimateTaxes(powertrain, profile);
  const defaultInsAnn = estimateDefaultInsuranceAnnual(powertrain, profile);

  const maintenanceTotal = rentIncludesMaintenance ? 0 : years * maintAnn;
  const tyresTotal = rentIncludesTyres ? 0 : years * tyresAnn;
  const taxesTotal = rentIncludesTaxes ? 0 : years * taxesAnn;

  let insuranceTotal = 0;
  let insuranceAnnualResolved = 0;
  if (!rentIncludesInsurance) {
    insuranceAnnualResolved =
      insuranceUserAnnual > 0 ? insuranceUserAnnual : defaultInsAnn;
    insuranceTotal = years * insuranceAnnualResolved;
  }

  const includedKmYear = contractAnnualKm > 0 ? contractAnnualKm : kmPerYear;
  const includedKmTotal = includedKmYear * years;
  let excessKm = Math.max(0, totalKm - includedKmTotal);

  if (excessKmPeriodProvided) {
    excessKm = excessKmPeriodUser;
  }

  const rate =
    excessCostPerKmUser > 0 ? excessCostPerKmUser : TCO_INTERNAL.defaultExcessMileagePerKm;
  const excessKmCost = excessKm * rate;

  const endContract = nonNegative(endContractCosts);

  const tcoTotal =
    rentPaymentsTotal +
    initialCash +
    energyTotal +
    insuranceTotal +
    maintenanceTotal +
    tyresTotal +
    taxesTotal +
    excessKmCost +
    endContract;

  return {
    tcoTotal,
    netAcquisition: 0,
    initialCash,
    energyTotal,
    maintenanceTotal,
    tyresTotal,
    taxesTotal,
    insuranceTotal,
    excessKmCost,
    endContractCost: endContract,
    rentPaymentsTotal,
    maintenanceAnnualUsed: maintAnn,
    tyresAnnualUsed: tyresAnn,
    taxesAnnualUsed: taxesAnn,
    insuranceAnnualResolved,
    usedInternalInsurance: !rentIncludesInsurance && insuranceUserAnnual <= 0,
    rentIncludesMaintenance,
    rentIncludesTyres,
    rentIncludesTaxes,
    rentIncludesInsurance,
    excessKm,
    rateUsed: rate,
  };
}

if (acquisitionModel) {
  acquisitionModel.addEventListener("change", toggleAcquisitionFields);
}

el("useInternalOpexEstimate")?.addEventListener("change", toggleInternalOpexFields);
el("rentIncludesInsurance")?.addEventListener("change", toggleRentingInsuranceField);

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const t = getTexts();

  const model = acquisitionModel?.value || "purchase";
  const powertrain = el("powertrainType")?.value || "";
  const profile = el("usageProfile")?.value || "";
  const kmPerYear = toNumber(el("annualKm")?.value);
  const years = toNumber(el("analysisYears")?.value);
  const totalMonths = years * 12;
  const totalKm = years * kmPerYear;
  const consumption = nonNegative(el("consumptionValue")?.value);
  const energyPrice = nonNegative(el("energyPrice")?.value);

  const errors = [];
  addValidationError(errors, !powertrain, currentLang === "en" ? "powertrain type" : "tipo de motorização");
  addValidationError(errors, !profile, currentLang === "en" ? "usage profile" : "perfil de utilização");
  addValidationError(errors, kmPerYear <= 0, currentLang === "en" ? "annual mileage > 0" : "quilometragem anual > 0");
  addValidationError(errors, years <= 0, currentLang === "en" ? "analysis period > 0" : "período de análise > 0");

  let result;

  if (model === "purchase") {
    const purchasePrice = nonNegative(el("purchasePrice")?.value);
    const purchaseInitialPayment = nonNegative(el("purchaseInitialPayment")?.value);
    const useInternalOpexEstimate = el("useInternalOpexEstimate")?.checked ?? true;
    const insuranceUserAnnual = nonNegative(el("annualInsurancePurchase")?.value);

    addValidationError(errors, purchasePrice <= 0, currentLang === "en" ? "purchase price > 0" : "preço de compra > 0");

    if (!useInternalOpexEstimate) {
      const mm = el("manualMaintenanceAnnual")?.value;
      const mt = el("manualTyresAnnual")?.value;
      const mtx = el("manualTaxesAnnual")?.value;
      addValidationError(
        errors,
        mm === "" || mt === "" || mtx === "",
        currentLang === "en"
          ? "enter manual maintenance, tyres, and taxes (or enable internal estimates)"
          : "indique manutenção, pneus e impostos manuais (ou active estimativas internas)"
      );
    }

    result = calculatePurchaseTCO({
      purchasePrice,
      purchaseInitialPayment,
      years,
      kmPerYear,
      powertrain,
      profile,
      consumption,
      energyPrice,
      useInternalOpexEstimate,
      manualMaintenanceAnnual: el("manualMaintenanceAnnual")?.value,
      manualTyresAnnual: el("manualTyresAnnual")?.value,
      manualTaxesAnnual: el("manualTaxesAnnual")?.value,
      insuranceUserAnnual,
    });
  } else {
    const monthlyRent = nonNegative(el("monthlyRent")?.value);
    const rentingInitialPayment = nonNegative(el("rentingInitialPayment")?.value);
    const contractAnnualKm = nonNegative(el("contractAnnualKm")?.value);
    const rentIncludesMaintenance = el("rentIncludesMaintenance")?.checked ?? false;
    const rentIncludesTyres = el("rentIncludesTyres")?.checked ?? false;
    const rentIncludesTaxes = el("rentIncludesTaxes")?.checked ?? false;
    const rentIncludesInsurance = el("rentIncludesInsurance")?.checked ?? false;
    const insuranceUserAnnual = nonNegative(el("annualInsuranceRenting")?.value);
    const excessCostPerKmUser = nonNegative(el("excessCostPerKm")?.value);
    const excessKmRaw = el("excessKmPeriod")?.value;
    const excessKmPeriodProvided = excessKmRaw !== "" && excessKmRaw !== undefined && excessKmRaw !== null;
    const excessKmPeriodUser = excessKmPeriodProvided ? nonNegative(excessKmRaw) : 0;
    const endContractCosts = nonNegative(el("endContractCosts")?.value);

    addValidationError(errors, monthlyRent <= 0, currentLang === "en" ? "monthly payment > 0" : "renda mensal > 0");

    result = calculateRentingTCO({
      monthlyRent,
      months: totalMonths,
      rentingInitialPayment,
      kmPerYear,
      years,
      contractAnnualKm,
      powertrain,
      profile,
      consumption,
      energyPrice,
      rentIncludesMaintenance,
      rentIncludesTyres,
      rentIncludesTaxes,
      rentIncludesInsurance,
      insuranceUserAnnual,
      excessCostPerKmUser,
      excessKmPeriodUser,
      excessKmPeriodProvided,
      endContractCosts,
    });
  }

  if (errors.length > 0 || totalMonths <= 0 || totalKm <= 0) {
    addValidationError(errors, totalMonths <= 0, currentLang === "en" ? "analysis period > 0 months" : "período > 0 meses");
    addValidationError(errors, totalKm <= 0, currentLang === "en" ? "total mileage > 0" : "quilometragem total > 0");
    setFeedback(t.invalid + errors.join(", "));
    resultsPanel?.classList.add("is-hidden");
    return;
  }

  const tcoTotal = result.tcoTotal;
  const monthlyAverageCost = tcoTotal / totalMonths;
  const costPerKm = tcoTotal / totalKm;

  el("resultTotalPeriod").textContent = formatCurrency(tcoTotal);
  el("resultAnnualCost").textContent = formatCurrency(monthlyAverageCost);
  el("resultCostPerKm").textContent = formatCurrency(costPerKm, 2);
  el("resultFiscal").textContent = getIndicativeFiscalReading(powertrain);

  const vatIvaNode = el("resultVatIva");
  if (vatIvaNode) {
    const vatType = powertrainToVatVehicleType(powertrain);
    if (model === "purchase" && vatType) {
      const purchasePriceForVat = nonNegative(el("purchasePrice")?.value);
      const vatMode = el("purchasePriceVatInput")?.value || "gross";
      const inputGross = vatMode !== "net";
      const vatRes = calculateVatEligibility(
        purchasePriceForVat,
        vatType,
        PT_IVA_FISCAL.DEFAULT_VAT_RATE,
        inputGross
      );
      vatIvaNode.classList.remove("is-hidden");
      vatIvaNode.textContent = vatRes.eligible ? t.vatIvaEligible : t.vatIvaNotEligible;
    } else {
      vatIvaNode.classList.add("is-hidden");
      vatIvaNode.textContent = "—";
    }
  }

  el("resultRecommendation").textContent = getRecommendation(costPerKm);

  const residualWrap = el("resultResidualWrap");

  const entradaInfo = el("resultBreakdownEntrada");

  if (model === "purchase") {
    const baseLabel = t.purchaseBase;
    setBreakdownLine("resultBreakdownBase", baseLabel, result.netAcquisition);
    if (entradaInfo) {
      if (result.initialCash > 0) {
        entradaInfo.classList.remove("is-hidden");
        entradaInfo.textContent = `${t.purchaseEntrada}: ${formatCurrency(result.initialCash)}`;
      } else {
        entradaInfo.classList.add("is-hidden");
      }
    }
    residualWrap?.classList.remove("is-hidden");
    const resLab =
      currentLang === "en" ? "Estimated residual value" : "Valor residual estimado";
    const resNode = el("resultResidualEstimated");
    if (resNode && typeof result.residualEstimated === "number") {
      resNode.textContent = `${resLab}: ${formatCurrency(result.residualEstimated)}`;
    }
  } else {
    entradaInfo?.classList.add("is-hidden");
    const baseAmount = result.rentPaymentsTotal + result.initialCash;
    setBreakdownLine("resultBreakdownBase", t.rentingBase, baseAmount);
    residualWrap?.classList.add("is-hidden");
  }

  setBreakdownLine("resultBreakdownEnergy", t.energy, result.energyTotal);

  let maintSuffix = "";
  if (model === "purchase" && result.usedInternalMaintenance) maintSuffix = ` ${t.maintEst}`;
  if (model === "renting" && result.rentIncludesMaintenance) maintSuffix = ` ${t.inclRent}`;
  setBreakdownLine("resultBreakdownMaintenance", t.maintenance, result.maintenanceTotal, maintSuffix);

  let tyresSuffix = "";
  if (model === "purchase" && result.usedInternalTyres) tyresSuffix = ` ${t.tyresEst}`;
  if (model === "renting" && result.rentIncludesTyres) tyresSuffix = ` ${t.inclRent}`;
  setBreakdownLine("resultBreakdownTyres", t.tyres, result.tyresTotal, tyresSuffix);

  let taxSuffix = "";
  if (model === "purchase" && result.usedInternalTaxes) taxSuffix = ` ${t.taxesEst}`;
  if (model === "renting" && result.rentIncludesTaxes) taxSuffix = ` ${t.inclRent}`;
  setBreakdownLine("resultBreakdownTaxes", t.taxes, result.taxesTotal, taxSuffix);

  let insSuffix = "";
  if (model === "purchase" && result.usedInternalInsurance) insSuffix = ` ${t.insEst}`;
  if (model === "renting" && result.rentIncludesInsurance) insSuffix = ` ${t.inclRent}`;
  setBreakdownLine("resultBreakdownInsurance", t.insurance, result.insuranceTotal, insSuffix);

  setBreakdownLine("resultBreakdownExcess", t.excess, model === "purchase" ? 0 : result.excessKmCost);

  const otherAmount = model === "purchase" ? 0 : result.endContractCost;
  setBreakdownLine("resultBreakdownOther", t.other, otherAmount);

  setFeedback(t.defaultHint);
  resultsPanel?.classList.remove("is-hidden");
});

toggleAcquisitionFields();
toggleInternalOpexFields();
toggleRentingInsuranceField();
updateDynamicPlaceholders();
updateSelectOptions();
setupMobileNavigation();
