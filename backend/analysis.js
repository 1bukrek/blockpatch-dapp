import { keccak256, toUtf8Bytes } from "ethers";

export function analyzeReport(report, previousReports) {
  const normalizedTitle = normalize(report.title);
  const normalizedDescription = normalize(report.description);
  const normalizedProjectId = normalize(report.projectId);
  const reportText = `${normalizedTitle} ${normalizedDescription}`;
  const duplicate = previousReports.find((previous) => {
    const previousText = `${normalize(previous.title)} ${normalize(previous.description)}`;
    return normalize(previous.projectId) === normalizedProjectId && reportText === previousText;
  });

  const severity = estimateSeverity(reportText);
  const status = duplicate ? "DUPLICATE" : report.poc.trim() ? "ACCEPTED" : "INVALID";
  const confidence = duplicate ? 0.94 : report.poc.trim() ? 0.6 : 0.35;
  const payoutPercentage =
    status === "ACCEPTED"
      ? { LOW: 10, MEDIUM: 25, HIGH: 60, CRITICAL: 100 }[severity]
      : 0;
  const canonical = JSON.stringify({
    projectId: report.projectId,
    title: report.title.trim(),
    description: report.description.trim(),
    poc: report.poc.trim(),
    researcherAddress: report.researcherAddress.toLowerCase(),
  });
  const reportHash = keccak256(toUtf8Bytes(canonical));

  return {
    reportHash,
    status,
    confidence_score: confidence,
    severity,
    duplicate_of: duplicate?.reportHash ?? null,
    suggested_payout_percentage: payoutPercentage,
    reasoning: duplicate
      ? "This report matches an earlier submission with the same title and description. Human review is required to confirm whether it is a duplicate."
      : report.poc.trim()
        ? "A proof of concept was provided and no exact match was found in this process's in-memory report history. This mock analyzer does not verify the affected code or reproduce the issue."
        : "A proof of concept is required by this demo triage pipeline. The finding has not been technically verified.",
  };
}

function estimateSeverity(text) {
  if (/drain|steal|arbitrary execution|private key|unauthorized(?: [a-z]+){0,2} withdrawal/.test(text)) {
    return "CRITICAL";
  }
  if (/funds|access control|reentrancy|critical|unprivileged/.test(text)) return "HIGH";
  if (/denial of service|dos|oracle|manipulation/.test(text)) return "MEDIUM";
  return "LOW";
}

export function normalize(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
