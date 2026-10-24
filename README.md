# Blockpatch

Blockpatch is a testnet-only bug bounty prototype. Researchers submit reports through a Next.js wallet app; a reviewer can approve reports through an Express API, which signs rewards for claiming from a Solidity escrow contract.

> **Monad Testnet only.** This project is unaudited and not production-ready. Use only faucet MON. Report analysis is heuristic and never approves a payout.

## Stack

- Next.js frontend with MetaMask and ethers
- Express backend with SQLite report storage and reviewer-controlled reward signing
- Solidity escrow contract, tested and deployed with Hardhat
- Monad Testnet (chain ID `10143`, native currency `MON`)

## Local development

Requires Node.js 22.10+ and npm. Run each service in its own PowerShell terminal.

Start the backend:

```powershell
cd backend
npm install
Copy-Item .env.example .env
npm start
```

The API listens on `http://localhost:4000`. Configure `backend/.env` to enable signing; keep the signer key and reviewer API key private. The SQLite database defaults to `backend/data/reports.sqlite`.

Start the frontend:

```powershell
cd frontend
npm install
Copy-Item .env.example .env.local
```

Set `NEXT_PUBLIC_CONTRACT_ADDRESS` to the deployed contract address in `frontend/.env.local`, then run:

```powershell
npm run dev
```

The example environment file points the app at the local backend. Open `http://localhost:3000` and connect MetaMask on Monad Testnet.

Run backend tests with `npm test` from the repository root. Run contract tests with `npm install` and `npm test` from `contracts`.

## Vercel

The root `vercel.json` declares two services: the Next.js frontend rooted at `frontend` and the backend rooted at `backend`, with `backend/server.js` as its entry point. It routes `/api/backend...` requests to the backend service and other requests to the frontend.

The frontend also uses `NEXT_PUBLIC_API_URL` for its API requests. Set it to the backend's public HTTPS URL in the frontend deployment's environment variables, along with `NEXT_PUBLIC_CONTRACT_ADDRESS`. The repository does not specify a live deployment URL.

The backend stores reports in SQLite by default. Vercel's local filesystem is not durable storage, so use a backend host or storage setup with persistent volumes if reports must survive redeployments or instance changes.

## Contract deployment

Contract deployment is configured for Monad Testnet only. From `contracts`, install dependencies, run `npm test`, then use `npm run deploy:monad-testnet` with the required `MONAD_TESTNET_RPC_URL`, `DEPLOYER_PRIVATE_KEY`, and `BACKEND_SIGNER_ADDRESS` environment variables. Do not commit private keys or populated environment files.
