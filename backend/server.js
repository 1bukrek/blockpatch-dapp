import "dotenv/config";

import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import { getAddress, id, isAddress, Wallet } from "ethers";
import { analyzeReport } from "./analysis.js";
import { signRewardPayload } from "./signing.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const chainId = Number(process.env.CHAIN_ID || 11155111);
const contractAddress = process.env.CONTRACT_ADDRESS || "";
const signingEnabled = process.env.DEMO_SIGNING_ENABLED === "true";
const reports = [];
const allowedHunters = new Set(
  (process.env.ALLOWED_HUNTER_ADDRESSES || "")
    .split(",")
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean),
);
const severityRewards = {
  LOW: process.env.LOW_REWARD_WEI || "100000000000000",
  MEDIUM: process.env.MEDIUM_REWARD_WEI || "250000000000000",
  HIGH: process.env.HIGH_REWARD_WEI || "500000000000000",
  CRITICAL: process.env.CRITICAL_REWARD_WEI || "1000000000000000",
};
const maxReward = BigInt(process.env.MAX_REWARD_WEI || "1000000000000000");
let signer;

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port.");
}
if (!Number.isSafeInteger(chainId) || chainId < 1) {
  throw new Error("CHAIN_ID must be a positive integer.");
}
if (signingEnabled) {
  if (!process.env.BACKEND_SIGNER_PRIVATE_KEY) {
    throw new Error("BACKEND_SIGNER_PRIVATE_KEY is required when demo signing is enabled.");
  }
  if (!isAddress(contractAddress) || getAddress(contractAddress) === "0x0000000000000000000000000000000000000000") {
    throw new Error("A deployed CONTRACT_ADDRESS is required when demo signing is enabled.");
  }
  if (allowedHunters.size === 0) {
    throw new Error("Set ALLOWED_HUNTER_ADDRESSES before enabling demo signing.");
  }
  signer = new Wallet(process.env.BACKEND_SIGNER_PRIVATE_KEY);
  for (const reward of Object.values(severityRewards)) {
    if (BigInt(reward) <= 0n || BigInt(reward) > maxReward) {
      throw new Error("Severity reward amounts must be positive and no greater than MAX_REWARD_WEI.");
    }
  }
}

app.disable("x-powered-by");
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "http://localhost:3000" }));
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
  response.json({ ok: true, chainId, signingEnabled });
});

app.post("/api/submit-report", async (request, response, next) => {
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
      title,
      description,
      poc,
      researcherAddress: getAddress(researcherAddress),
    };
    const result = analyzeReport(report, reports);
    const duplicate = result.status === "DUPLICATE";
    if (!duplicate) reports.push({ ...report, reportHash: result.reportHash });

    let signature = null;
    let amount = "0";
    let canClaim = false;
    if (result.status === "ACCEPTED" && signingEnabled) {
      if (!allowedHunters.has(report.researcherAddress.toLowerCase())) {
        result.reasoning += " Signing is disabled for this wallet; it is not in the demo allowlist.";
      } else {
        amount = (BigInt(severityRewards[result.severity]) > maxReward
          ? maxReward
          : BigInt(severityRewards[result.severity])).toString();
        signature = await signRewardPayload(signer, {
          contractAddress: getAddress(contractAddress),
          chainId,
          reportHash: result.reportHash,
          hunterAddress: report.researcherAddress,
          amount,
        });
        canClaim = true;
      }
    }

    return response.json({
      ...result,
      projectIdHash: id(report.projectId),
      amount,
      signature,
      canClaim,
      demoMode: true,
      ...(signingEnabled
        ? {}
        : { signingNote: "Payout signing is disabled. Enable it only for a controlled testnet demo." }),
    });
  } catch (error) {
    return next(error);
  }
});

app.use((error, _request, response, _next) => {
  console.error("API request failed:", error);
  response.status(500).json({ error: "Internal server error." });
});

app.listen(port, () => {
  console.log(`BountyShield API listening on http://localhost:${port}`);
});
