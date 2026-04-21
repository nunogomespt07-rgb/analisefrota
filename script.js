/**
 * Language is determined by URL path (/en/ = English, otherwise Portuguese).
 * Switch language by navigating with the header links, not localStorage.
 */
const currentLang = /^\/en(\/|$)/.test(location.pathname) ? "en" : "pt";

const acquisitionModel = document.getElementById("acquisitionModel");
const resultsPanel = document.getElementById("resultsPanel");
const powertrainType = document.getElementById("powertrainType");
const usageProfile = document.getElementById("usageProfile");
const annualKm = document.getElementById("annualKm");
const analysisYears = document.getElementById("analysisYears");
const valueVehicle = document.getElementById("valueCombustion");
const rentVehicle = document.getElementById("rentCombustion");

function toNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
    gpl: "Leitura fiscal intermédia, dependente da política de frota.",
    phev: "Pode beneficiar de otimização fiscal com utilização adequada.",
    bev: "Tende a beneficiar de enquadramento fiscal mais favorável.",
  };
  const en = {
    combustion: "Tax position tends to be more demanding.",
    gpl: "Intermediate tax profile, depending on fleet policy.",
    phev: "May benefit from tax optimisation with appropriate usage.",
    bev: "Tends to benefit from a more favourable tax position.",
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
    ? "Profile with optimisation potential in acquisition, usage and powertrain."
    : "Perfil com potencial de otimização em aquisição, uso e motorização.";
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
  const isRenting = acquisitionModel.value === "renting";

  document.querySelectorAll(".purchase-field").forEach((el) => {
    el.classList.toggle("is-hidden", isRenting);
  });

  document.querySelectorAll(".renting-field").forEach((el) => {
    el.classList.toggle("is-hidden", !isRenting);
  });
}

if (acquisitionModel) {
  acquisitionModel.addEventListener("change", toggleAcquisitionFields);
}

document.getElementById("tcoForm")?.addEventListener("submit", (event) => {
  event.preventDefault();
  const years = Math.max(1, toNumber(analysisYears?.value || 1));
  const kmPerYear = Math.max(1, toNumber(annualKm?.value || 0));
  const totalKm = years * kmPerYear;
  const isRenting = acquisitionModel?.value === "renting";
  const baseValue = isRenting ? toNumber(rentVehicle?.value || 0) * 12 : toNumber(valueVehicle?.value || 0);

  const usageMultiplier = {
    urbano: 1.05,
    misto: 1,
    estrada: 0.95,
  }[usageProfile?.value || "misto"];

  const motorizationOpex = {
    combustion: 4200,
    gpl: 3600,
    phev: 3300,
    bev: 2800,
  }[powertrainType?.value || "combustion"];

  const annualCost = (isRenting ? baseValue : baseValue / years) + motorizationOpex * usageMultiplier;
  const totalPeriodCost = annualCost * years;
  const costPerKm = totalKm > 0 ? totalPeriodCost / totalKm : 0;

  document.getElementById("resultAnnualCost").textContent = formatCurrency(annualCost);
  document.getElementById("resultTotalPeriod").textContent = formatCurrency(totalPeriodCost);
  document.getElementById("resultCostPerKm").textContent = formatCurrency(costPerKm, 2);
  document.getElementById("resultFiscal").textContent = getIndicativeFiscalReading(powertrainType?.value);
  document.getElementById("resultRecommendation").textContent = getRecommendation(costPerKm);

  resultsPanel?.classList.remove("is-hidden");
});

toggleAcquisitionFields();
updateDynamicPlaceholders();
updateSelectOptions();
