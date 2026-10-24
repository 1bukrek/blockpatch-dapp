import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getBytes,
  hashMessage,
  id,
  recoverAddress,
  solidityPackedKeccak256,
  Wallet,
} from "ethers";
import { analyzeReport } from "./analysis.js";
import { createApp, readConfig } from "./server.js";
import { ReportStore } from "./report-store.js";

const researcherAddress = "0x0000000000000000000000000000000000000001";
const reviewerApiKey = `reviewer-${"x".repeat(40)}`;
const report = {
  projectId: "vault-v1",
  title: "Unauthorized vault withdrawal",
  description: "An unprivileged user can withdraw all funds from the vault.",
  poc: "Call withdraw from a second wallet.",
  researcherAddress,
};

async function listen(app) {
  const server = app.listen(0);
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
  };
}

function makeConfig(databasePath, signingWallet) {
  return readConfig({
    PORT: "4000",
    CHAIN_ID: "10143",
    CONTRACT_ADDRESS: "0x0000000000000000000000000000000000000002",
    BACKEND_SIGNER_PRIVATE_KEY: signingWallet.privateKey,
    DEMO_SIGNING_ENABLED: "true",
    REVIEWER_API_KEY: reviewerApiKey,
    ALLOWED_HUNTER_ADDRESSES: researcherAddress,
    REPORT_DB_PATH: databasePath,
  });
}

test("requires human approval, signs only approved reports, and keeps duplicate history across restarts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bountyshield-server-test-"));
  const databasePath = join(directory, "reports.sqlite");
  const signingWallet = Wallet.createRandom();
  const config = makeConfig(databasePath, signingWallet);
  let store = new ReportStore(databasePath);
  let { server, url } = await listen(createApp({ config, store }));

  try {
    const submittedResponse = await fetch(`${url}/api/submit-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
    assert.equal(submittedResponse.status, 201);
    const submitted = await submittedResponse.json();
    assert.equal(submitted.status, "ACCEPTED");
    assert.equal(submitted.reviewStatus, "PENDING_REVIEW");
    assert.equal(submitted.canClaim, false);
    assert.equal(submitted.signature, null);

    const deniedReview = await fetch(`${url}/api/review/reports/${submitted.reportHash}`);
    assert.equal(deniedReview.status, 401);

    const reviewResponse = await fetch(`${url}/api/review/reports/${submitted.reportHash}`, {
      headers: { Authorization: `Bearer ${reviewerApiKey}` },
    });
    assert.equal(reviewResponse.status, 200);
    assert.equal((await reviewResponse.json()).poc, report.poc);

    const approvalResponse = await fetch(`${url}/api/review/reports/${submitted.reportHash}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${reviewerApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amountWei: "100000000000000" }),
    });
    assert.equal(approvalResponse.status, 200);
    const approved = await approvalResponse.json();
    assert.equal(approved.reviewStatus, "APPROVED");
    assert.equal(approved.canClaim, true);
    assert.equal(
      recoverAddress(
        hashMessage(getBytes(solidityPackedKeccak256(
          ["address", "uint256", "bytes32", "bytes32", "address", "uint256", "uint256"],
          [
            config.contractAddress,
            config.chainId,
            id(report.projectId),
            submitted.reportHash,
            researcherAddress,
            approved.amount,
            approved.expiresAt,
          ],
        ))),
        approved.signature,
      ),
      signingWallet.address,
    );

    const secondReport = {
      ...report,
      title: "Oracle price can be manipulated",
      description: "A user can alter the oracle price and affect settlement.",
    };
    const secondSubmissionResponse = await fetch(`${url}/api/submit-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(secondReport),
    });
    const secondSubmission = await secondSubmissionResponse.json();
    assert.equal(secondSubmission.reviewStatus, "PENDING_REVIEW");

    const deniedRejection = await fetch(
      `${url}/api/review/reports/${secondSubmission.reportHash}/reject`,
      { method: "POST" },
    );
    assert.equal(deniedRejection.status, 401);

    const rejectionResponse = await fetch(
      `${url}/api/review/reports/${secondSubmission.reportHash}/reject`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${reviewerApiKey}` },
      },
    );
    assert.equal(rejectionResponse.status, 200);
    assert.equal((await rejectionResponse.json()).reviewStatus, "REJECTED");

    const profileResponse = await fetch(`${url}/api/profiles/${researcherAddress}`);
    assert.equal(profileResponse.status, 200);
    const profile = await profileResponse.json();
    assert.deepEqual(
      {
        submitted: profile.submitted,
        projects: profile.projects,
        accepted: profile.accepted,
        rejected: profile.rejected,
        pending: profile.pending,
      },
      { submitted: 2, projects: 1, accepted: 1, rejected: 1, pending: 0 },
    );
    assert.equal(profile.reports.length, 2);
    assert.equal("title" in profile.reports[0], false);
    assert.equal("description" in profile.reports[0], false);
    assert.equal("poc" in profile.reports[0], false);
    assert.equal("researcherAddress" in profile.reports[0], false);

    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    store.close();
    store = new ReportStore(databasePath);
    ({ server, url } = await listen(createApp({ config, store })));

    const duplicateResponse = await fetch(`${url}/api/submit-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
    const duplicate = await duplicateResponse.json();
    assert.equal(duplicate.status, "DUPLICATE");
    assert.equal(duplicate.duplicate_of, submitted.reportHash);
    assert.equal(duplicate.canClaim, false);

    const refreshedProfileResponse = await fetch(`${url}/api/profiles/${researcherAddress}`);
    const refreshedProfile = await refreshedProfileResponse.json();
    assert.equal(refreshedProfile.submitted, 3);
    assert.equal(refreshedProfile.projects, 1);
    assert.equal(refreshedProfile.accepted, 1);
    assert.equal(refreshedProfile.rejected, 1);
    assert.equal(refreshedProfile.reports.length, 3);

    const invalidProfileResponse = await fetch(`${url}/api/profiles/not-an-address`);
    assert.equal(invalidProfileResponse.status, 400);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("allows an expired approval to be renewed only for the original amount", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bountyshield-renewal-test-"));
  const databasePath = join(directory, "reports.sqlite");
  const config = makeConfig(databasePath, Wallet.createRandom());
  const store = new ReportStore(databasePath);
  const result = analyzeReport(report, []);
  store.add(report, result);
  store.approve({
    reportHash: result.reportHash,
    amount: "100000000000000",
    signature: "0x00",
    expiresAt: Math.floor(Date.now() / 1000) - 1,
  });
  const { server, url } = await listen(createApp({ config, store }));

  try {
    const response = await fetch(`${url}/api/review/reports/${result.reportHash}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${reviewerApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amountWei: "100000000000000" }),
    });
    const renewed = await response.json();
    assert.equal(response.status, 200);
    assert.equal(renewed.reviewStatus, "APPROVED");
    assert.equal(renewed.canClaim, true);
    assert.notEqual(renewed.signature, "0x00");

    const wrongAmount = await fetch(`${url}/api/review/reports/${result.reportHash}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${reviewerApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amountWei: "200000000000000" }),
    });
    assert.equal(wrongAmount.status, 409);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("rejects reward approvals above the configured severity cap", async () => {
  const directory = mkdtempSync(join(tmpdir(), "bountyshield-approval-test-"));
  const databasePath = join(directory, "reports.sqlite");
  const config = makeConfig(databasePath, Wallet.createRandom());
  const store = new ReportStore(databasePath);
  const { server, url } = await listen(createApp({ config, store }));

  try {
    const submittedResponse = await fetch(`${url}/api/submit-report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(report),
    });
    const submitted = await submittedResponse.json();
    const approvalResponse = await fetch(`${url}/api/review/reports/${submitted.reportHash}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${reviewerApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amountWei: "1000000000000001" }),
    });

    assert.equal(approvalResponse.status, 400);
    assert.match((await approvalResponse.json()).error, /configured reward limit/i);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
