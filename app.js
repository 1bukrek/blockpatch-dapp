const sampleReport = {
  title: "Missing access control on emergencyWithdraw()",
  location: "contracts/Vault.sol · emergencyWithdraw()",
  severity: "HIGH",
  description:
    "The emergencyWithdraw() function does not verify that the caller is the contract owner. Any account can call it and transfer the full token balance to themselves, resulting in a complete loss of user funds.",
  poc:
    "1. Deploy the Vault with test tokens.\n2. Call emergencyWithdraw() from an unprivileged account.\n3. Observe that the caller receives the vault balance.",
};

const knownReports = [
  {
    id: "BP-2024-018",
    title: "Unrestricted emergencyWithdraw allows draining vault",
    location: "contracts/Vault.sol · emergencyWithdraw()",
    terms: ["emergencywithdraw", "access control", "vault", "drain"],
  },
  {
    id: "BP-2024-011",
    title: "Reentrancy in reward claim",
    location: "contracts/Rewards.sol · claim()",
    terms: ["reentrancy", "claim", "rewards"],
  },
  {
    id: "BP-2024-006",
    title: "Oracle price can be manipulated",
    location: "contracts/PriceFeed.sol · getPrice()",
    terms: ["oracle", "price", "manipulation"],
  },
];

const form = document.querySelector("#report-form");
const emptyResult = document.querySelector("#empty-result");
const analysisResult = document.querySelector("#analysis-result");
const loadingResult = document.querySelector("#loading-result");
const toast = document.querySelector("#toast");
let toastTimeout;

document.querySelector("#sample-button").addEventListener("click", () => {
  document.querySelector("#report-title").value = sampleReport.title;
  document.querySelector("#affected-location").value = sampleReport.location;
  document.querySelector("#severity").value = sampleReport.severity;
  document.querySelector("#description").value = sampleReport.description;
  document.querySelector("#poc").value = sampleReport.poc;
  showToast("Sample report loaded");
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;

  emptyResult.hidden = true;
  analysisResult.hidden = true;
  loadingResult.hidden = false;
  window.setTimeout(analyzeReport, 650);
});

document.querySelector("#copy-button").addEventListener("click", async () => {
  const payload = document.querySelector("#json-output").textContent;
  try {
    await navigator.clipboard.writeText(payload);
    showToast("JSON payload copied");
  } catch (error) {
    showToast("Clipboard access unavailable in this browser");
  }
});

function analyzeReport() {
  const report = {
    title: form.elements.title.value.trim(),
    location: form.elements.location.value.trim(),
    severity: form.elements.severity.value,
    description: form.elements.description.value.trim(),
    poc: form.elements.poc.value.trim(),
  };
  const match = findDuplicate(report);
  const result = createResult(report, match);

  loadingResult.hidden = true;
  analysisResult.hidden = false;
  renderResult(result);
}

function findDuplicate(report) {
  const normalizedTitle = normalize(report.title);
  const normalizedLocation = normalize(report.location);
  const reportText = normalize(`${report.title} ${report.location} ${report.description}`);

  return knownReports.find((known) => {
    const sameLocation =
      normalizedLocation.includes(normalize(known.location.split("·")[0])) ||
      normalize(known.location).includes(normalizedLocation);
    const commonTerms = known.terms.filter((term) => reportText.includes(normalize(term)));
    const sameTitle = normalize(known.title)
      .split(" ")
      .filter((word) => word.length > 4 && normalizedTitle.includes(word)).length >= 2;
    return sameLocation && (commonTerms.length >= 2 || sameTitle);
  });
}

function createResult(report, duplicate) {
  if (duplicate) {
    return {
      status: "DUPLICATE",
      confidence_score: 0.94,
      severity: report.severity,
      duplicate_of: duplicate.id,
      reasoning: `This report appears to match ${duplicate.id} based on its affected code path and vulnerability description. A human reviewer should confirm the match.`,
      suggested_payout_percentage: 0,
    };
  }

  const hasReproduction = report.poc.length > 0;
  const confidence = hasReproduction ? 0.82 : 0.63;
  const payoutBySeverity = { LOW: 10, MEDIUM: 30, HIGH: 60, CRITICAL: 100 };

  return {
    status: hasReproduction ? "ACCEPTED" : "INVALID",
    confidence_score: confidence,
    severity: report.severity,
    duplicate_of: null,
    reasoning: hasReproduction
      ? "No close match was found in the demo report set. A reproduction was provided; this heuristic does not verify the underlying code or proof of concept."
      : "No close match was found in the demo report set, but no proof of concept was provided. This demo heuristic cannot independently validate the finding.",
    suggested_payout_percentage: hasReproduction ? payoutBySeverity[report.severity] : 0,
  };
}

function renderResult(result) {
  const decisionCard = document.querySelector("#decision-card");
  decisionCard.classList.toggle("is-duplicate", result.status === "DUPLICATE");
  decisionCard.classList.toggle("is-invalid", result.status === "INVALID");
  document.querySelector("#decision-icon").textContent =
    result.status === "ACCEPTED" ? "✓" : result.status === "DUPLICATE" ? "↗" : "!";
  document.querySelector("#decision-status").textContent = result.status;
  document.querySelector("#confidence").textContent =
    `${result.confidence_score.toFixed(2)} confidence`;
  document.querySelector("#decision-reason").textContent = result.reasoning;
  document.querySelector("#result-severity").textContent = result.severity;
  document.querySelector("#result-payout").textContent =
    `${result.suggested_payout_percentage}%`;
  document.querySelector("#json-output").textContent = JSON.stringify(result, null, 2);
}

function normalize(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 2400);
}
