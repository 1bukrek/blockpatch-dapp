# BountyShield MVP

A small, testnet-only bug bounty prototype with a Solidity reward contract, an Express triage/signing API, and a Next.js wallet dApp.

## Workspace

```text
contracts/
  BountyShield.sol
  package.json
backend/
  analysis.js
  analysis.test.js
  signing.js
  signing.test.js
  server.js
  package.json
  .env.example
frontend/
  app/
    globals.css
    layout.tsx
    page.tsx
  lib/
    contract.ts
  types/
    ethereum.d.ts
  .env.example
  package.json
  tsconfig.json
  postcss.config.mjs
  next.config.mjs
```

The original static prototype remains available from the repository-root `index.html`.

## Prerequisites

- Node.js 20.9 or later and npm
- MetaMask configured for Sepolia and a small amount of Sepolia test ETH
- A deployed `BountyShield` contract and its signer address

## 1. Compile and deploy the contract

```powershell
cd contracts
npm install
npm run compile
```

Deploy `BountyShield.sol` to Sepolia with the address of the backend signing wallet as its constructor argument. For a first deployment, use Remix or your preferred deployment tool. Keep the backend private key for that same signer offline except for the local backend environment.

Deposits for different project IDs are recorded for visibility, but the MVP contract pays from one shared ETH balance. Production should bind each payout to the corresponding project balance.

## 2. Run the backend API

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

Set `CONTRACT_ADDRESS` and `CHAIN_ID=11155111` in `backend/.env`. The API runs with signing disabled by default. To enable controlled testnet claims, set all of the following:

- `DEMO_SIGNING_ENABLED=true`
- `BACKEND_SIGNER_PRIVATE_KEY` to the private key whose address was passed to the contract
- `ALLOWED_HUNTER_ADDRESSES` to a comma-separated allowlist of test researcher wallets
- `CONTRACT_ADDRESS` to the deployed Sepolia contract

Then start and test:

```powershell
npm test
npm start
```

The API listens on `http://localhost:4000`; `GET /api/health` reports whether demo signing is enabled.

## 3. Run the frontend

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
```

Set `NEXT_PUBLIC_CONTRACT_ADDRESS` to the deployed address and keep `NEXT_PUBLIC_CHAIN_ID=11155111`. Then:

```powershell
npm run dev
```

Open `http://localhost:3000`, connect MetaMask, and use Sepolia. The frontend uses ethers.js with MetaMask's injected provider. Enter the same project ID for deposit and report submission; the frontend hashes the UTF-8 project ID with keccak256 for `depositBounty(bytes32)`.

## API

`POST /api/submit-report` JSON body:

```json
{
  "projectId": "vault-v1",
  "title": "Unauthorized withdrawal",
  "description": "An unprivileged caller can withdraw funds.",
  "poc": "Call withdraw() from a second wallet.",
  "researcherAddress": "0x0000000000000000000000000000000000000001"
}
```

The response includes the deterministic `reportHash`, triage result, severity, amount, and a signature when signing is enabled and the researcher is allowlisted. The contract signature binds the contract address, chain ID, report hash, hunter, and amount, and each report hash can be claimed only once.

## Important limitations

- The analyzer is a heuristic placeholder, not an AI model, source-code verifier, or security review.
- Duplicate history is process-local memory and is lost when the backend restarts.
- Demo payouts are fixed by severity, capped by `MAX_REWARD_WEI`, and only signed for configured wallets. The API rate limits submissions.
- The contract currently pools deposited ETH across projects. Do not use real funds or deploy this as a production bounty system.
- Never put `BACKEND_SIGNER_PRIVATE_KEY` in the frontend or commit a populated `.env` file.
