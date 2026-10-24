import "dotenv/config";

import { timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { getAddress, id, isAddress, isHexString, Wallet } from "ethers";
import { analyzeReport } from "./analysis.js";
import { ReportStore } from "./report-store.js";
import { signRewardPayload } from "./signing.js";

const severityNames = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export function readConfig(env = process.env) {
  const port = Number(env.PORT || 4000);
  const chainId = Number(env.CHAIN_ID || 10143);
  const contractAddress = env.CONTRACT_ADDRESS || "";
  const signingEnabled = env.DEMO_SIGNING_ENABLED === "true";
  const allowedHunters = new Set(
    (env.ALLOWED_HUNTER_ADDRESSES || "")
      .split(",")
      .map((address) => address.trim())
      .filter(Boolean)
      .map((address) => {
        if (!isAddress(address)) throw new Error(`Invalid allowed hunter address: ${address}`);
        return getAddress(address).toLowerCase();
      }),
  );
  const severityRewards = {
    LOW: env.LOW_REWARD_WEI || "100000000000000",
    MEDIUM: env.MEDIUM_REWARD_WEI || "250000000000000",
    HIGH: env.HIGH_REWARD_WEI || "500000000000000",
    CRITICAL: env.CRITICAL_REWARD_WEI || "1000000000000000",
  };
  const maxReward = BigInt(env.MAX_REWARD_WEI || "1000000000000000");

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be a valid TCP port.");
  }
  if (!Number.isSafeInteger(chainId) || chainId < 1) {
    throw new Error("CHAIN_ID must be a positive integer.");
  }
  if (maxReward <= 0n) throw new Error("MAX_REWARD_WEI must be positive.");
  if (signingEnabled && chainId !== 10143) {
    throw new Error("Payout signing is restricted to Monad Testnet (CHAIN_ID=10143).");
  }

  let signer;
  let reviewerApiKey = env.REVIEWER_API_KEY || "";
  let normalizedContractAddress = contractAddress;
  if (signingEnabled) {
    if (!env.BACKEND_SIGNER_PRIVATE_KEY) {
      throw new Error("BACKEND_SIGNER_PRIVATE_KEY is required when demo signing is enabled.");
    }
    if (
      !isAddress(contractAddress) ||
      getAddress(contractAddress) === "0x0000000000000000000000000000000000000000"
    ) {
      throw new Error("A deployed CONTRACT_ADDRESS is required when demo signing is enabled.");
    }
    if (!reviewerApiKey) {
      throw new Error("REVIEWER_API_KEY is required when demo signing is enabled.");
    }
    if (Buffer.byteLength(reviewerApiKey, "utf8") < 32) {
      throw new Error("REVIEWER_API_KEY must be at least 32 bytes.");
    }
    if (allowedHunters.size === 0) {
      throw new Error("Set ALLOWED_HUNTER_ADDRESSES before enabling demo signing.");
    }
    signer = new Wallet(env.BACKEND_SIGNER_PRIVATE_KEY);
    normalizedContractAddress = getAddress(contractAddress);
    for (const severity of severityNames) {
      const reward = BigInt(severityRewards[severity]);
      if (reward <= 0n || reward > maxReward) {
        throw new Error("Severity reward limits must be positive and no greater than MAX_REWARD_WEI.");
      }
    }
  }

  return {
    port,
    chainId,
    contractAddress: normalizedContractAddress,
    signingEnabled,
    signer,
    reviewerApiKey,
    allowedHunters,
    severityRewards,
    maxReward,
    frontendOrigin: env.FRONTEND_ORIGIN || "http://localhost:3000",
    databasePath:
      env.REPORT_DB_PATH || fileURLToPath(new URL("./data/reports.sqlite", import.meta.url)),
  };
}

function isReviewer(request, expectedKey) {
  const authorization = request.get("authorization") || "";
  if (!expectedKey || !authorization.startsWith("Bearer ")) return false;

  const supplied = Buffer.from(authorization.slice("Bearer ".length));
  const expected = Buffer.from(expectedKey);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function publicReport(report) {
  const expiresAt = report.expiresAt || null;
  return {
    reportHash: report.reportHash,
    projectIdHash: id(report.projectId),
    status: report.status,
    reviewStatus: report.reviewStatus,
    confidence_score: report.confidence_score,
    severity: report.severity,
    duplicate_of: report.duplicate_of,
    suggested_payout_percentage: report.suggested_payout_percentage,
    reasoning: report.reasoning,
    amount: report.amount || "0",
    signature: report.signature || null,
    expiresAt,
    canClaim:
      report.reviewStatus === "APPROVED" &&
      Boolean(report.signature) &&
      Number(expiresAt) > Math.floor(Date.now() / 1000),
    demoMode: true,
  };
}

export function createApp({ config, store = new ReportStore(config.databasePath) }) {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: config.frontendOrigin }));
  app.use(express.json({ limit: "32kb" }));
  app.use(
    "/api/",
    rateLimit({
      windowMs: 60_000,
      limit: 20,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
  );

  app.get("/api/health", (_request, response) => {
    response.json({
      ok: true,
      chainId: config.chainId,
      signingEnabled: config.signingEnabled,
      manualReviewRequired: true,
    });
  });

  app.post("/api/submit-report", (request, response, next) => {
    try {
      const { projectId, title, description, poc, researcherAddress } = request.body ?? {};
      if (
        typeof projectId !== "string" ||
        projectId.trim().length < 1 ||
        projectId.trim().length > 128 ||
        typeof title !== "string" ||
        title.trim().length < 3 ||
        title.length > 200 ||
        typeof description !== "string" ||
        description.trim().length < 10 ||
        description.length > 10_000 ||
        typeof poc !== "string" ||
        poc.length > 20_000 ||
        typeof researcherAddress !== "string" ||
        !isAddress(researcherAddress)
      ) {
        return response.status(400).json({ error: "Invalid or missing report fields." });
      }

      const report = {
        projectId: projectId.trim(),
        title: title.trim(),
        description: description.trim(),
        poc: poc.trim(),
        researcherAddress: getAddress(researcherAddress),
      };
      const duplicate = store.findDuplicate(report);
      const result = analyzeReport(report, duplicate ? [{ ...report, ...duplicate }] : []);
      store.addSubmission(report, result);
      if (result.status !== "DUPLICATE") store.add(report, result);
      return response.status(201).json(publicReport({
        ...result,
        projectId: report.projectId,
        reviewStatus: result.status === "ACCEPTED" ? "PENDING_REVIEW" : result.status,
        amount: "0",
      }));
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/profiles/:address", (request, response, next) => {
    try {
      if (!isAddress(request.params.address)) {
        return response.status(400).json({ error: "Invalid profile wallet address." });
      }
      const profile = store.getResearcherProfile(getAddress(request.params.address));
      return response.json(profile);
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/reports/:reportHash", (request, response) => {
    if (!isHexString(request.params.reportHash, 32)) {
      return response.status(400).json({ error: "Invalid report hash." });
    }
    const report = store.get(request.params.reportHash.toLowerCase());
    if (!report) return response.status(404).json({ error: "Report not found." });
    return response.json(publicReport(report));
  });

  app.get("/api/review/reports/:reportHash", (request, response) => {
    if (!isReviewer(request, config.reviewerApiKey)) {
      return response.status(401).json({ error: "Reviewer authorization required." });
    }
    if (!isHexString(request.params.reportHash, 32)) {
      return response.status(400).json({ error: "Invalid report hash." });
    }
    const report = store.get(request.params.reportHash.toLowerCase());
    if (!report) return response.status(404).json({ error: "Report not found." });
    return response.json(report);
  });

  app.post("/api/review/reports/:reportHash/approve", async (request, response, next) => {
    try {
      if (!isReviewer(request, config.reviewerApiKey)) {
        return response.status(401).json({ error: "Reviewer authorization required." });
      }
      if (!config.signingEnabled || !config.signer) {
        return response.status(503).json({ error: "Payout signing is disabled." });
      }
      if (!isHexString(request.params.reportHash, 32)) {
        return response.status(400).json({ error: "Invalid report hash." });
      }

      const reportHash = request.params.reportHash.toLowerCase();
      const report = store.get(reportHash);
      if (!report) return response.status(404).json({ error: "Report not found." });
      const isPending = report.status === "ACCEPTED" && report.reviewStatus === "PENDING_REVIEW";
      const isExpiredApproval =
        report.status === "ACCEPTED" &&
        report.reviewStatus === "APPROVED" &&
        Number(report.expiresAt) <= Math.floor(Date.now() / 1000);
      if (!isPending && !isExpiredApproval) {
        return response.status(409).json({ error: "Only pending or expired accepted reports can be approved." });
      }
      if (!config.allowedHunters.has(report.researcherAddress.toLowerCase())) {
        return response.status(403).json({ error: "Researcher is not in the payout allowlist." });
      }

      const amount = request.body?.amountWei;
      if (typeof amount !== "string" || !/^[1-9]\d*$/.test(amount)) {
        return response.status(400).json({ error: "amountWei must be a positive integer string." });
      }
      const amountWei = BigInt(amount);
      const severityLimit = BigInt(config.severityRewards[report.severity]);
      if (amountWei > config.maxReward || amountWei > severityLimit) {
        return response.status(400).json({ error: "Amount exceeds the configured reward limit." });
      }
      if (isExpiredApproval && amount !== report.amount) {
        return response.status(409).json({ error: "Renewal must use the previously approved amount." });
      }

      const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
      const signature = await signRewardPayload(config.signer, {
        contractAddress: config.contractAddress,
        chainId: config.chainId,
        projectId: id(report.projectId),
        reportHash,
        hunterAddress: report.researcherAddress,
        amount,
        expiresAt,
      });
      const saved = isPending
        ? store.approve({ reportHash, amount, signature, expiresAt })
        : store.renew({ reportHash, signature, expiresAt });
      if (!saved) {
        return response.status(409).json({ error: "Report approval state changed; reload before retrying." });
      }

      return response.json(publicReport(store.get(reportHash)));
    } catch (error) {
      return next(error);
    }
  });

  app.post("/api/review/reports/:reportHash/reject", (request, response) => {
    if (!isReviewer(request, config.reviewerApiKey)) {
      return response.status(401).json({ error: "Reviewer authorization required." });
    }
    if (!isHexString(request.params.reportHash, 32)) {
      return response.status(400).json({ error: "Invalid report hash." });
    }

    const reportHash = request.params.reportHash.toLowerCase();
    const report = store.get(reportHash);
    if (!report) return response.status(404).json({ error: "Report not found." });
    if (report.status !== "ACCEPTED" || report.reviewStatus !== "PENDING_REVIEW") {
      return response.status(409).json({ error: "Only pending accepted reports can be rejected." });
    }
    if (!store.reject(reportHash)) {
      return response.status(409).json({ error: "Report review state changed; reload before retrying." });
    }
    return response.json(publicReport(store.get(reportHash)));
  });

  app.use((error, _request, response, _next) => {
    console.error("API request failed:", error);
    response.status(500).json({ error: "Internal server error." });
  });

  return app;
}

export function startServer(env = process.env) {
  const config = readConfig(env);
  const store = new ReportStore(config.databasePath);
  const app = createApp({ config, store });
  return app.listen(config.port, () => {
    console.log(`BountyShield API listening on http://localhost:${config.port}`);
  });
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  startServer();
}
