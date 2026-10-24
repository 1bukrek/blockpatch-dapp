import test from "node:test";
import assert from "node:assert/strict";
import { analyzeReport } from "./analysis.js";

const report = {
  projectId: "demo-project",
  title: "Unauthorized vault withdrawal",
  description: "An unprivileged user can withdraw all funds from the vault.",
  poc: "Call withdraw from a second wallet.",
  researcherAddress: "0x0000000000000000000000000000000000000001",
};

test("accepts a report with a PoC and returns a deterministic report hash", () => {
  const first = analyzeReport(report, []);
  const second = analyzeReport(report, []);

  assert.equal(first.status, "ACCEPTED");
  assert.equal(first.severity, "CRITICAL");
  assert.equal(first.suggested_payout_percentage, 100);
  assert.equal(first.reportHash, second.reportHash);
  assert.equal(first.duplicate_of, null);
});

test("flags an exact repeated title and description as a duplicate", () => {
  const previous = analyzeReport(report, []);
  const duplicate = analyzeReport(report, [{ ...report, reportHash: previous.reportHash }]);

  assert.equal(duplicate.status, "DUPLICATE");
  assert.equal(duplicate.duplicate_of, previous.reportHash);
});

test("does not accept a report without a PoC", () => {
  const result = analyzeReport({ ...report, poc: "  " }, []);

  assert.equal(result.status, "INVALID");
  assert.equal(result.suggested_payout_percentage, 0);
  assert.match(result.reasoning, /proof of concept/i);
});

test("does not flag the same finding as a duplicate for a different project", () => {
  const previous = analyzeReport(report, []);
  const otherProject = analyzeReport(
    { ...report, projectId: "another-project" },
    [{ ...report, reportHash: previous.reportHash }],
  );

  assert.equal(otherProject.status, "ACCEPTED");
  assert.equal(otherProject.duplicate_of, null);
});
