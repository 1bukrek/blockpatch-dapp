"use client";

import { FormEvent, useEffect, useState } from "react";
import { BrowserProvider, Contract, formatEther, getAddress, id, isAddress, parseEther } from "ethers";
import { bountyShieldAbi, contractAddress } from "@/lib/contract";

type ApiResult = {
  reportHash: `0x${string}`;
  projectIdHash: `0x${string}`;
  status: "ACCEPTED" | "DUPLICATE" | "INVALID";
  reviewStatus: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  suggested_payout_percentage: number;
  reasoning: string;
  amount: string;
  signature: `0x${string}` | null;
  expiresAt: number | null;
  canClaim: boolean;
  signingNote?: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const targetChainId = 10143;
const validContractAddress =
  isAddress(contractAddress) && contractAddress !== "0x0000000000000000000000000000000000000000";

export default function Home() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [poc, setPoc] = useState("");
  const [result, setResult] = useState<ApiResult | null>(null);
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isWriting, setIsWriting] = useState(false);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;

    const onAccountsChanged = (accounts: unknown) => {
      const accountList = Array.isArray(accounts) ? accounts : [];
      setAddress(
        accountList.length && typeof accountList[0] === "string"
          ? getAddress(accountList[0])
          : null,
      );
    };
    const onChainChanged = (chain: unknown) => {
      if (typeof chain === "string") setChainId(Number.parseInt(chain, 16));
    };

    ethereum.on("accountsChanged", onAccountsChanged);
    ethereum.on("chainChanged", onChainChanged);
    return () => {
      ethereum.removeListener("accountsChanged", onAccountsChanged);
      ethereum.removeListener("chainChanged", onChainChanged);
    };
  }, []);

  async function connectWallet() {
    if (!window.ethereum) {
      setMessage("MetaMask was not found. Install the browser extension first.");
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !isAddress(accounts[0])) {
        throw new Error("MetaMask did not return a valid account.");
      }
      setAddress(getAddress(accounts[0]));
      const chain = await window.ethereum.request({ method: "eth_chainId" });
      if (typeof chain === "string") setChainId(Number.parseInt(chain, 16));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet connection failed.");
    }
  }

  function disconnectWallet() {
    setAddress(null);
    setMessage("Wallet disconnected from this app. MetaMask permissions are unchanged.");
  }

  async function getWalletSigner() {
    if (!window.ethereum) throw new Error("MetaMask was not found.");

    let provider = new BrowserProvider(window.ethereum);
    let network = await provider.getNetwork();
    if (Number(network.chainId) !== targetChainId) {
      await provider.send("wallet_switchEthereumChain", [
        { chainId: `0x${targetChainId.toString(16)}` },
      ]);
      provider = new BrowserProvider(window.ethereum);
      network = await provider.getNetwork();
    }
    if (Number(network.chainId) !== targetChainId) {
      throw new Error("Switch MetaMask to the configured testnet to continue.");
    }
    setChainId(Number(network.chainId));
    return provider.getSigner();
  }

  async function deposit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!address) {
      setMessage("Connect your wallet before depositing.");
      return;
    }
    if (!validContractAddress) {
      setMessage(
        "Set NEXT_PUBLIC_CONTRACT_ADDRESS in frontend/.env.local to the deployed contract, then restart the frontend.",
      );
      return;
    }
    if (!projectId.trim() || !depositAmount) {
      setMessage("Enter a project ID and a positive MON amount.");
      return;
    }

    setIsWriting(true);
    try {
      const value = parseEther(depositAmount);
      if (value <= 0n) throw new Error("Deposit amount must be greater than zero.");
      const signer = await getWalletSigner();
      const contract = new Contract(contractAddress, bountyShieldAbi, signer);
      const transaction = await contract.depositBounty(id(projectId.trim()), { value });
      setMessage(`Deposit submitted: ${transaction.hash}`);
      await transaction.wait();
      setMessage(`Deposit confirmed: ${transaction.hash}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Deposit transaction failed.");
    } finally {
      setIsWriting(false);
    }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setResult(null);
    if (!address) {
      setMessage("Connect your researcher wallet before submitting.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await fetch(`${apiUrl}/api/submit-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: projectId.trim(),
          title,
          description,
          poc,
          researcherAddress: address,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Report submission failed.");
      setResult(data as ApiResult);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not submit the report.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function refreshReportStatus() {
    if (!result) return;
    setMessage("");
    try {
      const response = await fetch(`${apiUrl}/api/reports/${result.reportHash}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not refresh report status.");
      setResult(data as ApiResult);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not refresh report status.");
    }
  }

  async function claimReward() {
    setMessage("");
    if (!address) {
      setMessage("Connect your researcher wallet before claiming.");
      return;
    }
    if (!validContractAddress) {
      setMessage(
        "Set NEXT_PUBLIC_CONTRACT_ADDRESS in frontend/.env.local to the deployed contract, then restart the frontend.",
      );
      return;
    }
    if (!result?.canClaim || !result.signature) {
      setMessage("This report does not have an authorized payout signature.");
      return;
    }
    if (!result.expiresAt || result.expiresAt <= Math.floor(Date.now() / 1000)) {
      setMessage("The payout signature has expired. Refresh the report status after reviewer renewal.");
      return;
    }

    setIsWriting(true);
    try {
      const signer = await getWalletSigner();
      const contract = new Contract(contractAddress, bountyShieldAbi, signer);
      const transaction = await contract.claimReward(
        result.projectIdHash,
        result.reportHash,
        address,
        BigInt(result.amount),
        result.expiresAt,
        result.signature,
      );
      setMessage(`Claim submitted: ${transaction.hash}`);
      await transaction.wait();
      setMessage(`Claim confirmed: ${transaction.hash}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Reward claim failed.");
    } finally {
      setIsWriting(false);
    }
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-5 py-10 sm:px-8">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4 border-b border-emerald-950 pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-400">
            Monad Testnet prototype · native test MON
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Blockpatch</h1>
          <p className="mt-1 text-sm text-slate-400">
            Submit reports for human review. Claim an authorized testnet reward.
          </p>
        </div>
        {address ? (
          <div className="flex items-center gap-3">
            <span className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300">
              {address.slice(0, 6)}…{address.slice(-4)} {chainId !== targetChainId && "(wrong network)"}
            </span>
            <button
              onClick={disconnectWallet}
              className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-emerald-500"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={connectWallet}
            className="rounded-lg bg-emerald-400 px-4 py-2.5 text-sm font-semibold text-emerald-950 hover:bg-emerald-300"
          >
            Connect wallet
          </button>
        )}
      </header>

      <div className="mb-7 rounded-xl border border-amber-900/60 bg-amber-950/30 p-4 text-sm leading-6 text-amber-100">
        Testnet only: heuristic triage never authorizes a payout by itself. Every reward requires
        manual reviewer approval, an allowlisted wallet, and available MON in that project&apos;s
        escrow.
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Project owner
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">Fund a bounty</h2>
          <p className="mt-2 text-sm text-slate-400">
            Deposit native test MON into this project&apos;s isolated reward balance.
          </p>
          <form onSubmit={deposit} className="mt-6 space-y-4">
            <Field
              label="Project ID"
              value={projectId}
              onChange={setProjectId}
              placeholder="e.g. vault-v1"
              required
            />
            <Field
              label="Deposit amount (MON)"
              value={depositAmount}
              onChange={setDepositAmount}
              placeholder="0.01"
              type="number"
              required
            />
            <button
              disabled={isWriting}
              className="w-full rounded-lg bg-emerald-400 px-4 py-3 font-semibold text-emerald-950 hover:bg-emerald-300 disabled:opacity-50"
            >
              {isWriting ? "Waiting for wallet…" : "Deposit bounty"}
            </button>
          </form>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-sky-400">
            Security researcher
          </p>
          <h2 className="mt-2 text-xl font-semibold text-white">Submit a vulnerability</h2>
          <p className="mt-2 text-sm text-slate-400">
            Your connected wallet is used as the researcher address.
          </p>
          <form onSubmit={submitReport} className="mt-6 space-y-4">
            <Field
              label="Project ID"
              value={projectId}
              onChange={setProjectId}
              placeholder="e.g. vault-v1"
              required
            />
            <Field
              label="Report title"
              value={title}
              onChange={setTitle}
              placeholder="Short finding summary"
              required
            />
            <TextArea
              label="Description"
              value={description}
              onChange={setDescription}
              placeholder="Explain impact and reproduction conditions…"
              required
            />
            <TextArea
              label="Proof of concept"
              value={poc}
              onChange={setPoc}
              placeholder="PoC, steps to reproduce, or transaction hash…"
              required
            />
            <button
              disabled={isSubmitting}
              className="w-full rounded-lg bg-sky-400 px-4 py-3 font-semibold text-sky-950 hover:bg-sky-300 disabled:opacity-50"
            >
              {isSubmitting ? "Submitting…" : "Submit for review"}
            </button>
          </form>
        </section>
      </div>

      {result && (
        <section className="mt-7 rounded-2xl border border-slate-800 bg-slate-900/60 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
                Triage result · {result.status}
              </p>
              <h2 className="mt-2 text-xl font-semibold text-white">{result.severity} severity</h2>
              <p className="mt-1 text-sm text-slate-400">
                Suggested payout: {result.suggested_payout_percentage}%
              </p>
            </div>
            {result.canClaim && (
              <button
                disabled={isWriting}
                onClick={claimReward}
                className="rounded-lg bg-emerald-400 px-4 py-2.5 font-semibold text-emerald-950 hover:bg-emerald-300 disabled:opacity-50"
              >
                {isWriting ? "Waiting for wallet…" : `Claim ${formatEther(BigInt(result.amount))} MON`}
              </button>
            )}
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-300">{result.reasoning}</p>
          {result.reviewStatus === "PENDING_REVIEW" && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <p className="text-sm text-amber-300">Waiting for a human reviewer. No payout is authorized yet.</p>
              <button
                onClick={refreshReportStatus}
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-emerald-500"
              >
                Refresh review status
              </button>
            </div>
          )}
          {result.reviewStatus === "APPROVED" && !result.canClaim && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <p className="text-sm text-amber-300">This payout signature has expired. A reviewer must renew it.</p>
              <button
                onClick={refreshReportStatus}
                className="rounded-lg border border-slate-700 px-3 py-2 text-sm hover:border-emerald-500"
              >
                Refresh review status
              </button>
            </div>
          )}
          {result.signingNote && <p className="mt-3 text-sm text-amber-300">{result.signingNote}</p>}
          <p className="mt-3 break-all font-mono text-xs text-slate-500">
            Report hash: {result.reportHash}
          </p>
        </section>
      )}

      {message && (
        <p
          role="status"
          className="mt-6 break-all rounded-lg border border-slate-800 bg-slate-900 p-4 text-sm text-slate-300"
        >
          {message}
        </p>
      )}
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  type?: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm text-slate-300">
      {label}
      <input
        type={type}
        required={required}
        min={type === "number" ? "0" : undefined}
        step={type === "number" ? "any" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
}) {
  return (
    <label className="block text-sm text-slate-300">
      {label}
      <textarea
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="mt-2 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
      />
    </label>
  );
}
