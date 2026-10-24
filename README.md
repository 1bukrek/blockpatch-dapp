# Blockpatch

A Monad Testnet bug-bounty prototype with project-scoped native MON escrow, a Next.js wallet app, and a backend API that only issues time-limited reward signatures after authenticated human review.

> **Testnet only.** This project has not been independently audited and is not production-ready. Use only faucet MON. The report analyzer is heuristic; it does not verify vulnerabilities, and its output never authorizes a payout.

## Monad Testnet

This app uses **Monad Testnet native MON**, not an ERC-20 mock token. Native testnet MON pays gas and is deposited as the bounty asset.

| Setting | Value |
| --- | --- |
| Network | Monad Testnet |
| Chain ID | `10143` |
| Native currency | `MON` |
| RPC | `https://testnet-rpc.monad.xyz` |
| Explorer | [MonadVision Testnet](https://testnet.monadvision.com) |
| Faucet | [Monad Faucet](https://faucet.monad.xyz) |

See the [official Monad Testnet network details](https://docs.monad.xyz/developer-essentials/testnet.md) for current RPC and faucet information. Add Monad Testnet to MetaMask using those official settings and obtain test MON from the faucet.

## What changed for testnet readiness

- Each project ID has a separate available MON balance. A report payout can only debit the matching project’s balance.
- The deployed contract enforces an immutable per-claim maximum reward and a maximum signature lifetime. Signatures bind the chain, contract, project, report, researcher, amount, and expiry.
- A non-empty PoC and heuristic severity are **not** approval. Reports remain pending until a reviewer inspects them and approves an amount through the authenticated backend API.
- Duplicate history and review state are stored in SQLite and survive backend restarts.
- The contract has Hardhat tests for project isolation, amount limits, project-bound signatures, expired signatures, replay prevention, and reentrancy.
- Deployment is scripted and refuses to deploy to a chain other than Monad Testnet.

## Prerequisites

- Node.js 22.10+ and npm
- MetaMask on Monad Testnet with faucet MON
- A separately controlled backend signing wallet and a reviewer API key

## Quick start

After installing dependencies in `frontend` and `backend` and configuring their env files, open two terminals at the repository root:

```powershell
npm run backend
```

```powershell
npm run frontend
```

The backend API starts on `http://localhost:4000` and the frontend on `http://localhost:3000`. Keep each command running in its terminal; stop it with Ctrl+C. Restart the relevant command after changing its env file.

## 1. Compile, test, and deploy

```powershell
cd contracts
npm install
npm test
npm run compile
```

Set deployment environment variables in the same PowerShell session. Do not commit or share populated secrets:

```powershell
$env:MONAD_TESTNET_RPC_URL = "https://testnet-rpc.monad.xyz"
$env:DEPLOYER_PRIVATE_KEY = "0x<64 hex characters from a testnet deployer private key>"
$env:BACKEND_SIGNER_ADDRESS = "0x<backend signing wallet address>"
$env:MAX_REWARD_WEI = "1000000000000000"
npm run deploy:monad-testnet
```

Replace each placeholder with your own value; do not type the angle brackets or literal placeholder text. `DEPLOYER_PRIVATE_KEY` must be exactly `0x` followed by 64 hexadecimal characters (66 characters total), with no quotes embedded in the value. It must belong to a wallet funded with Monad Testnet MON. In PowerShell, the environment-variable assignment above keeps the key available to the child `npm` process for that session only.

Record the printed contract address. The deployer key and backend signing key should be different; only the backend signing key belongs in the backend environment. The signer is immutable, so a compromised signer requires a new deployment and configuration update.

## 2. Configure and run the backend

```powershell
cd backend
npm install
if (!(Test-Path .env)) { Copy-Item .env.example .env }
```

Set these values in `backend/.env`:

- `CHAIN_ID=10143`
- `CONTRACT_ADDRESS` to the deployed Monad Testnet contract
- `DEMO_SIGNING_ENABLED=true`
- `BACKEND_SIGNER_PRIVATE_KEY` to the private key whose address was passed to the constructor
- `REVIEWER_API_KEY` to a long, unique secret
- `ALLOWED_HUNTER_ADDRESSES` to comma-separated test researcher addresses
- `MAX_REWARD_WEI` to the same maximum used at deployment

The severity reward values are reviewer-selected ceilings; every approved amount must be positive and no greater than both its severity ceiling and `MAX_REWARD_WEI`. The copy command only creates `.env` when it does not exist, so repeating setup will not replace your settings. Backend environment changes take effect after restarting the API process. Keep `.env` and the SQLite database private. By default the database is `backend/data/reports.sqlite`; set `REPORT_DB_PATH` to change it. The database contains submitted report details and should be backed up and access-controlled appropriately.

Start the API:

```powershell
npm test
npm start
```

The API listens on `http://localhost:4000`. `GET /api/health` reports chain ID, whether signing is enabled, and that manual review is required.

### Reviewer workflow

1. A researcher submits a report through the app. The API stores it and returns `reviewStatus: "PENDING_REVIEW"`; no reward signature is produced.
2. An authorized reviewer retrieves the report, including the PoC:

   ```powershell
   $headers = @{ Authorization = "Bearer $env:REVIEWER_API_KEY" }
   Invoke-RestMethod "http://localhost:4000/api/review/reports/<report-hash>" -Headers $headers
   ```

3. After independently reviewing it, the reviewer explicitly approves a payout amount in wei:

   ```powershell
   $headers = @{
     Authorization = "Bearer $env:REVIEWER_API_KEY"
     "Content-Type" = "application/json"
   }
   $body = @{ amountWei = "100000000000000" } | ConvertTo-Json
   Invoke-RestMethod `
     -Method Post `
     -Uri "http://localhost:4000/api/review/reports/<report-hash>/approve" `
     -Headers $headers `
     -Body $body
   ```

   Approval fails for a non-accepted report, a researcher outside the allowlist, or an amount above the configured ceilings.

4. The researcher selects **Refresh review status** in the app. An approved signature can be claimed by the specified researcher before it expires, provided the project has enough escrow.

Keep the reviewer API key out of the frontend and browser. Use HTTPS and restrict API access appropriately outside local testing.

## 3. Configure and run the frontend

```powershell
cd frontend
npm install
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
```

Set `NEXT_PUBLIC_CONTRACT_ADDRESS` in `frontend/.env.local` to the deployed contract address (not your wallet address). This is separate from `CONTRACT_ADDRESS` in `backend/.env`; changing the backend value does not configure the frontend. The app checks that contract bytecode exists on Monad Testnet before submitting a deposit or claim. Frontend environment changes are not applied to the running Next.js process: stop and restart the frontend after changing `.env.local` (and rebuild before starting a production build). The frontend only allows Monad Testnet (chain ID `10143`). Start the app:

```powershell
npm run dev
```

Open `http://localhost:3000`, connect MetaMask, deposit native MON for a project, then submit a report using the same project ID. Project IDs are UTF-8 keccak256-hashed consistently by the frontend and backend.

## API summary

- `POST /api/submit-report`: validates and stores a report; it does not sign payouts.
- `GET /api/reports/:reportHash`: returns public triage/review status and, after approval, the researcher-bound signature.
- `GET /api/review/reports/:reportHash`: returns report details; requires `Authorization: Bearer <REVIEWER_API_KEY>`.
- `POST /api/review/reports/:reportHash/approve`: issues a time-limited signature for an explicitly selected amount; requires reviewer authorization and signing configuration.

## Remaining limitations

- Human review is an operational process, not an on-chain governance mechanism. The reviewer API key and backend signer remain trusted authorities.
- The analyzer and duplicate detection are simple heuristics/exact normalized-title-and-description matches, not technical verification or semantic duplicate detection. Review reports independently; these controls do not prevent Sybil submissions.
- The backend uses a local SQLite database and is intended for a single API instance in this testnet setup. Protect report contents, backups, and credentials.
- Deposits have no owner withdrawal/refund mechanism. Do not deposit funds you need returned.
- There is no independent security audit, production key-management integration, or production deployment process. Do not use real-value assets.
- The Hardhat test/deployment toolchain is development-only; `npm audit` currently reports upstream Hardhat/Zod advisories with no patched compatible release. Recheck the toolchain before running it on untrusted contract projects, and do not expose it as a service. Backend runtime dependencies currently audit clean.
