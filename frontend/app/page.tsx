"use client";

import { FormEvent, useEffect, useState } from "react";
import { BrowserProvider, Contract, formatEther, getAddress, id, isAddress, parseEther } from "ethers";
import { bountyShieldAbi, contractAddress } from "@/lib/contract";
import { saveBountyDetails } from "@/lib/bounties";

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

type TransactionFeedback = {
  action: "Bounty deposit" | "Reward claim";
  status: "pending" | "confirmed" | "failed";
  hash?: string;
  blockNumber?: number;
  description: string;
};

const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const targetChainId = 10143;
const validContractAddress =
  isAddress(contractAddress) && contractAddress !== "0x0000000000000000000000000000000000000000";

export default function Home() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [projectId, setProjectId] = useState("");
  const [bountyName, setBountyName] = useState("");
  const [bountyDetails, setBountyDetails] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [poc, setPoc] = useState("");
  const [result, setResult] = useState<ApiResult | null>(null);
  const [message, setMessage] = useState("");
  const [transactionFeedback, setTransactionFeedback] = useState<TransactionFeedback | null>(null);
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
    setTransactionFeedback(null);
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
    if (!projectId.trim() || !bountyName.trim() || !bountyDetails.trim() || !depositAmount) {
      setMessage("Enter a project ID, bounty name, details, and a positive MON amount.");
      return;
    }

    setIsWriting(true);
    let transactionHash: string | undefined;
    try {
      const value = parseEther(depositAmount);
      if (value <= 0n) throw new Error("Deposit amount must be greater than zero.");
      const signer = await getWalletSigner();
      const contract = new Contract(contractAddress, bountyShieldAbi, signer);
      const transaction = await contract.depositBounty(id(projectId.trim()), { value });
      transactionHash = transaction.hash;
      setTransactionFeedback({
        action: "Bounty deposit",
        status: "pending",
        hash: transactionHash,
        description: "Submitted to Monad Testnet. Waiting for the transaction to be confirmed.",
      });
      const receipt = await transaction.wait();
      if (!receipt) throw new Error("No transaction receipt was returned.");
      try {
        saveBountyDetails({
          owner: address,
          projectId: projectId.trim(),
          name: bountyName.trim(),
          details: bountyDetails.trim(),
          updatedAt: Date.now(),
        });
        setTransactionFeedback({
          action: "Bounty deposit",
          status: "confirmed",
          hash: transactionHash,
          blockNumber: receipt.blockNumber,
          description: "Confirmed on Monad Testnet. Bounty details were saved in this browser.",
        });
      } catch (error) {
        setTransactionFeedback({
          action: "Bounty deposit",
          status: "confirmed",
          hash: transactionHash,
          blockNumber: receipt.blockNumber,
          description: `Confirmed on-chain, but the bounty details could not be saved in this browser: ${
            error instanceof Error ? error.message : "browser storage is unavailable."
          }`,
        });
      }
    } catch (error) {
      setTransactionFeedback({
        action: "Bounty deposit",
        status: "failed",
        hash: transactionHash,
        description: transactionErrorMessage(error, "bounty deposit", transactionHash),
      });
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
    setTransactionFeedback(null);
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
    let transactionHash: string | undefined;
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
      transactionHash = transaction.hash;
      setTransactionFeedback({
        action: "Reward claim",
        status: "pending",
        hash: transactionHash,
        description: "Submitted to Monad Testnet. Waiting for the reward transfer to be confirmed.",
      });
      const receipt = await transaction.wait();
      if (!receipt) throw new Error("No transaction receipt was returned.");
      setTransactionFeedback({
        action: "Reward claim",
        status: "confirmed",
        hash: transactionHash,
        blockNumber: receipt.blockNumber,
        description: "Confirmed on Monad Testnet. Your reward has been transferred to your wallet.",
      });
    } catch (error) {
      setTransactionFeedback({
        action: "Reward claim",
        status: "failed",
        hash: transactionHash,
        description: transactionErrorMessage(error, "reward claim", transactionHash),
      });
    } finally {
      setIsWriting(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#overview" aria-label="Blockpatch home">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M7 7h8v8H7zM17 7h8v8h-8zM7 17h8v8H7z" fill="currentColor" />
              <path d="M17 17h8v8h-8z" fill="currentColor" opacity=".48" />
            </svg>
          </span>
          <span>blockpatch<span className="brand-period">.</span></span>
        </a>

        <p className="sidebar-label">Workspace</p>
        <nav className="sidebar-nav" aria-label="Main navigation">
          <a className="nav-link active" href="#overview">
            <Icon name="grid" />
            <span>Overview</span>
          </a>
          <a className="nav-link" href="/#fund">
            <Icon name="coins" />
            <span>Fund a bounty</span>
          </a>
          <a className="nav-link" href="/bounties">
            <Icon name="grid" />
            <span>My bounties</span>
          </a>
          <a className="nav-link" href="/profile">
            <Icon name="shield" />
            <span>Research profiles</span>
          </a>
          <a className="nav-link" href="/#report">
            <Icon name="shield" />
            <span>Submit a report</span>
          </a>
        </nav>

        <div className="sidebar-bottom">
          <div className="sidebar-note-icon"><Icon name="spark" /></div>
          <p className="sidebar-note-title">Built for better security</p>
          <p className="sidebar-note-copy">Responsible disclosure starts with a safe place to report.</p>
          <span className="sidebar-version">MONAD TESTNET · 01</span>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <p className="breadcrumb">Workspace <span>/</span> Overview</p>
          <div className="topbar-actions">
            <span className={`network-pill ${chainId !== null && chainId !== targetChainId ? "network-warning" : ""}`}>
              <span className="status-dot" />
              {chainId !== null && chainId !== targetChainId ? "Wrong network" : "Monad Testnet"}
            </span>
            {address ? (
              <div className="wallet-controls">
                <a className="wallet-address" title={`View public profile for ${address}`} href={`/profile/${address}`}>
                  <span className="wallet-dot" />
                  {address.slice(0, 6)}…{address.slice(-4)}
                </a>
                <button className="button button-quiet button-small" onClick={disconnectWallet}>
                  Disconnect
                </button>
              </div>
            ) : (
              <button className="button button-primary button-small" onClick={connectWallet}>
                Connect wallet <Icon name="arrow" />
              </button>
            )}
          </div>
        </header>

        <main className="workspace" id="overview">
          <section className="welcome-section">
            <div>
              <p className="eyebrow"><span className="eyebrow-line" /> BUG BOUNTY WORKSPACE</p>
              <h1>Make every finding<br className="desktop-break" /> count.</h1>
              <p className="welcome-copy">
                A thoughtful home for security research, project rewards, and responsible disclosure.
              </p>
            </div>
            <a className="text-link" href="#report">Share a finding <Icon name="arrow" /></a>
          </section>

          <section className="overview-grid" aria-label="Workspace overview">
            <div className="hero-card">
              <div className="hero-card-content">
                <span className="hero-label"><span className="hero-label-dot" /> A safer way to build</span>
                <h2>Good security<br />is a team effort.</h2>
                <p>Fund meaningful research. Give every vulnerability the review it deserves.</p>
                <a className="hero-link" href="#fund">Get started <Icon name="arrow" /></a>
              </div>
              <div className="hero-art" aria-hidden="true">
                <span className="art-orbit orbit-one" />
                <span className="art-orbit orbit-two" />
                <span className="art-orbit orbit-three" />
                <span className="art-core"><Icon name="shield" /></span>
                <span className="art-spark spark-one" />
                <span className="art-spark spark-two" />
              </div>
              <span className="hero-number" aria-hidden="true">01</span>
            </div>

            <div className="status-card">
              <div className="status-card-heading">
                <div>
                  <p className="card-overline">YOUR WORKSPACE</p>
                  <h2>All set to begin</h2>
                </div>
                <span className="status-card-icon"><Icon name="spark" /></span>
              </div>
              <div className="status-row">
                <span className="status-row-icon"><Icon name="grid" /></span>
                <span className="status-row-copy"><strong>Network</strong><small>Native test MON</small></span>
                <span
                  className={`status-value ${chainId === targetChainId ? "status-connected" : chainId !== null ? "status-warning" : ""}`}
                >
                  {chainId === targetChainId ? "Connected" : chainId !== null ? "Switch network" : "Testnet"}
                </span>
              </div>
              <div className="status-row">
                <span className="status-row-icon"><Icon name="shield" /></span>
                <span className="status-row-copy"><strong>Wallet</strong><small>{address ? "Ready for transactions" : "Connect to get started"}</small></span>
                <span className={`status-value ${address ? "status-connected" : ""}`}>{address ? "Ready" : "Optional"}</span>
              </div>
              <div className="status-row">
                <span className="status-row-icon"><Icon name="coins" /></span>
                <span className="status-row-copy"><strong>Reward review</strong><small>Human approval required</small></span>
                <span className="status-value status-manual">Manual</span>
              </div>
              <p className="status-footnote"><span className="footnote-dot" /> Test environment · Chain ID 10143</p>
            </div>
          </section>

          <div className="notice-banner">
            <span className="notice-icon"><Icon name="shield" /></span>
            <p><strong>Testnet prototype</strong><span>Heuristic triage never authorizes a payout. Rewards require manual reviewer approval, an allowlisted wallet, and available MON in the project escrow.</span></p>
          </div>

          <section className="actions-section" aria-labelledby="actions-heading">
            <div className="section-heading">
              <div>
                <p className="card-overline">TAKE THE NEXT STEP</p>
                <h2 id="actions-heading">Make an impact</h2>
              </div>
              <span className="section-caption">Two ways to strengthen the ecosystem</span>
            </div>

            <div className="action-grid">
              <section className="action-card" id="fund">
                <div className="action-card-top">
                  <span className="action-icon"><Icon name="coins" /></span>
                  <span className="action-number">01 / PROJECT OWNER</span>
                </div>
                <h3>Fund a bounty</h3>
                <p className="action-description">Describe the program and put native test MON behind the security work you want to encourage.</p>
                <form onSubmit={deposit} className="form-stack">
                  <Field
                    label="Project ID"
                    value={projectId}
                    onChange={setProjectId}
                    placeholder="e.g. vault-v1"
                    required
                  />
                  <Field
                    label="Bounty name"
                    value={bountyName}
                    onChange={setBountyName}
                    placeholder="e.g. Vault V1 Security Program"
                    required
                  />
                  <TextArea
                    label="Bounty details"
                    value={bountyDetails}
                    onChange={setBountyDetails}
                    placeholder="Describe the project, scope, assets to test, and what makes a useful finding…"
                    required
                  />
                  <Field
                    label="Deposit amount"
                    value={depositAmount}
                    onChange={setDepositAmount}
                    placeholder="0.01"
                    type="number"
                    required
                  />
                  <p className="form-helper">
                    Your name and details are saved in this browser. Funding amount and escrow balance are verified on-chain.
                  </p>
                  <button disabled={isWriting} className="button button-primary button-submit">
                    {isWriting ? "Waiting for wallet…" : "Fund bounty"}
                    {!isWriting && <Icon name="arrow" />}
                  </button>
                </form>
              </section>

              <section className="action-card" id="report">
                <div className="action-card-top">
                  <span className="action-icon action-icon-muted"><Icon name="shield" /></span>
                  <span className="action-number">02 / SECURITY RESEARCHER</span>
                </div>
                <h3>Submit a finding</h3>
                <p className="action-description">Share what you found. Your connected wallet is used as the researcher address.</p>
                <form onSubmit={submitReport} className="form-stack">
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
                  <button disabled={isSubmitting} className="button button-secondary button-submit">
                    {isSubmitting ? "Submitting…" : "Submit for review"}
                    {!isSubmitting && <Icon name="arrow" />}
                  </button>
                </form>
              </section>
            </div>
          </section>

          {result && (
            <section className="result-card" aria-live="polite">
              <div className="result-heading">
                <div>
                  <p className="card-overline">TRIAGE RESULT · {result.status}</p>
                  <h2>{result.severity} severity</h2>
                  <p className="result-suggestion">Suggested payout: {result.suggested_payout_percentage}%</p>
                </div>
                {result.canClaim && (
                  <button
                    disabled={isWriting}
                    onClick={claimReward}
                    className="button button-primary"
                  >
                    {isWriting ? "Waiting for wallet…" : `Claim ${formatEther(BigInt(result.amount))} MON`}
                  </button>
                )}
              </div>
              <p className="result-reasoning">{result.reasoning}</p>
              {result.reviewStatus === "PENDING_REVIEW" && (
                <div className="review-notice">
                  <p>Waiting for a human reviewer. No payout is authorized yet.</p>
                  <button onClick={refreshReportStatus} className="button button-quiet">Refresh review status</button>
                </div>
              )}
              {result.reviewStatus === "APPROVED" && !result.canClaim && (
                <div className="review-notice">
                  <p>This payout signature has expired. A reviewer must renew it.</p>
                  <button onClick={refreshReportStatus} className="button button-quiet">Refresh review status</button>
                </div>
              )}
              {result.signingNote && <p className="result-note">{result.signingNote}</p>}
              <p className="report-hash">Report hash <code>{result.reportHash}</code></p>
            </section>
          )}

          {message && <p role="status" className="feedback-message">{message}</p>}
          {transactionFeedback && (
            <div
              role={transactionFeedback.status === "failed" ? "alert" : "status"}
              className={`transaction-feedback transaction-${transactionFeedback.status}`}
              aria-live="polite"
            >
              <span className="transaction-status-icon">
                <Icon name={transactionFeedback.status === "confirmed" ? "check" : transactionFeedback.status === "failed" ? "close" : "refresh"} />
              </span>
              <div className="transaction-feedback-copy">
                <strong>
                  {transactionFeedback.action} {transactionFeedback.status}
                  {transactionFeedback.blockNumber !== undefined && ` · Block ${transactionFeedback.blockNumber}`}
                </strong>
                <span>{transactionFeedback.description}</span>
                {transactionFeedback.hash && (
                  <a
                    className="transaction-explorer-link"
                    href={`https://testnet.monadvision.com/tx/${transactionFeedback.hash}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View transaction {transactionFeedback.hash.slice(0, 10)}…{transactionFeedback.hash.slice(-8)}
                    <Icon name="arrow" />
                  </a>
                )}
              </div>
            </div>
          )}
          <footer className="workspace-footer">
            <span>BLOCKPATCH <span className="footer-dot">·</span> BUILT FOR RESPONSIBLE DISCLOSURE</span>
            <a href="#overview">Back to top ↑</a>
          </footer>
        </main>
      </div>
    </div>
  );
}

function transactionErrorMessage(
  error: unknown,
  action: string,
  transactionHash?: string,
): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === 4001 || error.code === "ACTION_REJECTED") &&
    !transactionHash
  ) {
    return "You declined the wallet request. No transaction was sent.";
  }

  const detail = error instanceof Error ? error.message : "An unknown wallet error occurred.";
  return transactionHash
    ? `The ${action} transaction did not confirm. Check its explorer status before trying again. ${detail}`
    : `Could not submit the ${action} transaction. No funds were moved. ${detail}`;
}

function Icon({ name }: { name: "grid" | "coins" | "shield" | "arrow" | "spark" | "refresh" | "check" | "close" }) {
  const shared = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  if (name === "grid") {
    return <svg {...shared}><rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><rect x="14" y="14" width="6" height="6" rx="1.5" /></svg>;
  }
  if (name === "coins") {
    return <svg {...shared}><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v5c0 1.7 3.1 3 7 3 1.1 0 2.1-.1 3-.3M5 11v5c0 1.7 3.1 3 7 3 1.6 0 3-.2 4.2-.7" /><path d="M19 12v6m-3-3h6" /></svg>;
  }
  if (name === "shield") {
    return <svg {...shared}><path d="M12 3 19 6v5c0 4.6-2.9 8-7 10-4.1-2-7-5.4-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg>;
  }
  if (name === "arrow") {
    return <svg {...shared}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
  }
  if (name === "refresh") {
    return <svg {...shared}><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9a7 7 0 0 1 11.6-2L20 12M4 12l2.8 5a7 7 0 0 0 11.6-2" /></svg>;
  }
  if (name === "check") {
    return <svg {...shared}><path d="m5 12 4 4L19 6" /></svg>;
  }
  if (name === "close") {
    return <svg {...shared}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  }
  return <svg {...shared}><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></svg>;
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
    <label className="field-label">
      <span>{label}</span>
      <input
        type={type}
        required={required}
        min={type === "number" ? "0" : undefined}
        step={type === "number" ? "any" : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="field-control"
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
    <label className="field-label">
      <span>{label}</span>
      <textarea
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={3}
        className="field-control field-textarea"
      />
    </label>
  );
}
