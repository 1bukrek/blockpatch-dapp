"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BrowserProvider,
  Contract,
  formatEther,
  getAddress,
  id,
  isAddress,
} from "ethers";
import { bountyShieldAbi, contractAddress } from "@/lib/contract";
import { BountyDetails, getBountyDetails } from "@/lib/bounties";

type TrackedBounty = {
  projectHash: string;
  projectId: string;
  name: string;
  details: string;
  contributed: bigint;
  escrowBalance: bigint;
  depositCount: number;
  lastFundedBlock: number;
  latestTransaction: string;
};

const targetChainId = 10143;
const eventQueryBlockRange = 10_000;
const configuredDeploymentBlock = Number(process.env.NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK ?? 0);
const validContractAddress =
  isAddress(contractAddress) && contractAddress !== "0x0000000000000000000000000000000000000000";

export default function BountiesPage() {
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [bounties, setBounties] = useState<TrackedBounty[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const loadBounties = useCallback(async (owner: string) => {
    setIsLoading(true);
    setError("");

    try {
      if (!validContractAddress) {
        throw new Error("Set NEXT_PUBLIC_CONTRACT_ADDRESS in frontend/.env.local to the deployed contract.");
      }
      if (!Number.isSafeInteger(configuredDeploymentBlock) || configuredDeploymentBlock < 0) {
        throw new Error("NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK must be a non-negative block number.");
      }
      if (!window.ethereum) throw new Error("MetaMask was not found. Install the browser extension first.");

      const provider = new BrowserProvider(window.ethereum);
      const network = await provider.getNetwork();
      setChainId(Number(network.chainId));
      if (Number(network.chainId) !== targetChainId) {
        throw new Error("Switch MetaMask to Monad Testnet to view funded bounties.");
      }

      const contract = new Contract(contractAddress, bountyShieldAbi, provider);
      const latestBlock = await provider.getBlockNumber();
      const depositFilter = contract.filters.BountyDeposited(null, owner);
      const events: Awaited<ReturnType<typeof contract.queryFilter>> = [];
      for (
        let fromBlock = configuredDeploymentBlock;
        fromBlock <= latestBlock;
        fromBlock += eventQueryBlockRange
      ) {
        const toBlock = Math.min(fromBlock + eventQueryBlockRange - 1, latestBlock);
        events.push(...await contract.queryFilter(depositFilter, fromBlock, toBlock));
      }
      const projects = new Map<string, { contributed: bigint; count: number; block: number; tx: string }>();

      for (const event of events) {
        if (!("args" in event) || !event.args) {
          throw new Error("Could not decode a bounty deposit event returned by Monad Testnet.");
        }
        const projectHash = String(event.args.projectId);
        const current = projects.get(projectHash) ?? {
          contributed: 0n,
          count: 0,
          block: 0,
          tx: "",
        };
        current.contributed += BigInt(event.args.amount);
        current.count += 1;
        if (event.blockNumber >= current.block) {
          current.block = event.blockNumber;
          current.tx = event.transactionHash;
        }
        projects.set(projectHash, current);
      }

      let details: BountyDetails[] = [];
      try {
        details = getBountyDetails(owner);
      } catch (detailsError) {
        setError(
          `On-chain funding loaded, but saved project details could not be read: ${
            detailsError instanceof Error ? detailsError.message : "browser storage is unavailable."
          }`,
        );
      }
      const tracked = await Promise.all(
        [...projects.entries()].map(async ([projectHash, funding]) => {
          const metadata = details.find(
            (item: BountyDetails) => id(item.projectId.trim()) === projectHash,
          );
          const escrowBalance = BigInt(await contract.projectBalances(projectHash));
          return {
            projectHash,
            projectId: metadata?.projectId ?? projectHash,
            name: metadata?.name ?? "Bounty project",
            details: metadata?.details ?? "",
            contributed: funding.contributed,
            escrowBalance,
            depositCount: funding.count,
            lastFundedBlock: funding.block,
            latestTransaction: funding.tx,
          };
        }),
      );

      tracked.sort((a, b) => b.lastFundedBlock - a.lastFundedBlock);
      setBounties(tracked);
    } catch (loadError) {
      setBounties([]);
      setError(loadError instanceof Error ? loadError.message : "Could not load funded bounties.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const ethereum = window.ethereum;
    if (!ethereum) return;

    void ethereum.request({ method: "eth_accounts" }).then((accounts: unknown) => {
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !isAddress(accounts[0])) return;
      const owner = getAddress(accounts[0]);
      setAddress(owner);
      void loadBounties(owner);
    }).catch((requestError: unknown) => {
      setError(requestError instanceof Error ? requestError.message : "Could not read connected wallet.");
    });

    const onAccountsChanged = (accounts: unknown) => {
      const owner =
        Array.isArray(accounts) && typeof accounts[0] === "string" && isAddress(accounts[0])
          ? getAddress(accounts[0])
          : null;
      setAddress(owner);
      setBounties([]);
      if (owner) void loadBounties(owner);
    };
    const onChainChanged = () => {
      void ethereum.request({ method: "eth_accounts" }).then((accounts: unknown) => {
        if (Array.isArray(accounts) && typeof accounts[0] === "string" && isAddress(accounts[0])) {
          void loadBounties(getAddress(accounts[0]));
        }
      }).catch((requestError: unknown) => {
        setError(requestError instanceof Error ? requestError.message : "Could not refresh wallet network.");
      });
    };

    ethereum.on("accountsChanged", onAccountsChanged);
    ethereum.on("chainChanged", onChainChanged);
    return () => {
      ethereum.removeListener("accountsChanged", onAccountsChanged);
      ethereum.removeListener("chainChanged", onChainChanged);
    };
  }, [loadBounties]);

  async function connectWallet() {
    if (!window.ethereum) {
      setError("MetaMask was not found. Install the browser extension first.");
      return;
    }
    try {
      const accounts: unknown = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !isAddress(accounts[0])) {
        throw new Error("MetaMask did not return a valid account.");
      }
      const owner = getAddress(accounts[0]);
      setAddress(owner);
      await loadBounties(owner);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Wallet connection failed.");
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/#overview" aria-label="Blockpatch home">
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
          <a className="nav-link" href="/#overview"><Icon name="grid" /><span>Overview</span></a>
          <a className="nav-link" href="/#fund"><Icon name="coins" /><span>Fund a bounty</span></a>
          <a className="nav-link active" href="/bounties"><Icon name="grid" /><span>My bounties</span></a>
          <a className="nav-link" href="/profile"><Icon name="shield" /><span>Research profiles</span></a>
          <a className="nav-link" href="/#report"><Icon name="shield" /><span>Submit a report</span></a>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note-icon"><Icon name="spark" /></div>
          <p className="sidebar-note-title">On-chain tracking</p>
          <p className="sidebar-note-copy">Your deposits and remaining project escrow are read directly from Monad Testnet.</p>
          <span className="sidebar-version">MONAD TESTNET · 01</span>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <p className="breadcrumb">Workspace <span>/</span> My bounties</p>
          <div className="topbar-actions">
            <span className={`network-pill ${chainId !== null && chainId !== targetChainId ? "network-warning" : ""}`}>
              <span className="status-dot" />
              {chainId !== null && chainId !== targetChainId ? "Wrong network" : "Monad Testnet"}
            </span>
            {address ? (
              <a className="wallet-address" title={`View public profile for ${address}`} href={`/profile/${address}`}>
                <span className="wallet-dot" />
                {address.slice(0, 6)}…{address.slice(-4)}
              </a>
            ) : (
              <button className="button button-primary button-small" onClick={connectWallet}>
                Connect wallet <Icon name="arrow" />
              </button>
            )}
          </div>
        </header>

        <main className="workspace">
          <section className="welcome-section bounty-welcome">
            <div>
              <p className="eyebrow"><span className="eyebrow-line" /> PROJECT OWNER WORKSPACE</p>
              <h1>Your funded<br className="desktop-break" /> bounties.</h1>
              <p className="welcome-copy">Keep an eye on your contributions and the live MON balance available for researchers.</p>
            </div>
            <button
              className="button button-quiet"
              onClick={() => address && void loadBounties(address)}
              disabled={!address || isLoading}
            >
              <Icon name="refresh" /> {isLoading ? "Refreshing…" : "Refresh"}
            </button>
          </section>

          {!address && (
            <section className="bounty-empty-state">
              <span className="empty-state-icon"><Icon name="coins" /></span>
              <h2>Connect your wallet to see your bounties</h2>
              <p>Your funded projects are linked to the wallet that made each deposit.</p>
              <button className="button button-primary" onClick={connectWallet}>
                Connect wallet <Icon name="arrow" />
              </button>
            </section>
          )}

          {error && <p role="alert" className="feedback-message">{error}</p>}

          {address && !error && !isLoading && bounties.length === 0 && (
            <section className="bounty-empty-state">
              <span className="empty-state-icon"><Icon name="coins" /></span>
              <h2>No funded bounties yet</h2>
              <p>When you fund a project from this wallet, it will show up here with its live escrow balance.</p>
              <a className="button button-primary" href="/#fund">Fund your first bounty <Icon name="arrow" /></a>
            </section>
          )}

          {isLoading && (
            <p className="loading-state" role="status">Loading your on-chain funding history…</p>
          )}

          {bounties.length > 0 && (
            <>
              <section className="bounty-summary-grid" aria-label="Bounty totals">
                <SummaryCard label="FUNDED PROJECTS" value={String(bounties.length)} detail="Projects funded by this wallet" icon="grid" />
                <SummaryCard
                  label="TOTAL CONTRIBUTED"
                  value={`${formatEther(bounties.reduce((total, bounty) => total + bounty.contributed, 0n))} MON`}
                  detail="Lifetime deposits from this wallet"
                  icon="coins"
                />
                <SummaryCard
                  label="AVAILABLE ESCROW"
                  value={`${formatEther(bounties.reduce((total, bounty) => total + bounty.escrowBalance, 0n))} MON`}
                  detail="Current balance across these projects"
                  icon="shield"
                />
              </section>

              <section className="actions-section bounty-list-section" aria-labelledby="bounty-list-heading">
                <div className="section-heading">
                  <div>
                    <p className="card-overline">YOUR PROJECTS</p>
                    <h2 id="bounty-list-heading">Funding activity</h2>
                  </div>
                  <span className="section-caption">Live balances from Monad Testnet</span>
                </div>
                <div className="bounty-list">
                  {bounties.map((bounty) => (
                    <article className="bounty-item" key={bounty.projectHash}>
                      <div className="bounty-item-icon"><Icon name="shield" /></div>
                      <div className="bounty-item-main">
                        <div className="bounty-item-title">
                          <div>
                            <h3>{bounty.name}</h3>
                            <p className="bounty-project-id">Project ID: {bounty.projectId}</p>
                          </div>
                          <span className={`bounty-active ${bounty.escrowBalance === 0n ? "bounty-depleted" : ""}`}>
                            <span className="status-dot" />
                            {bounty.escrowBalance === 0n ? "Depleted" : "Active"}
                          </span>
                        </div>
                        {bounty.details ? (
                          <p className="bounty-description">{bounty.details}</p>
                        ) : (
                          <p className="bounty-description metadata-missing">
                            Project details are only available in the browser used to fund this bounty.
                          </p>
                        )}
                        <div className="bounty-metrics">
                          <div><span>Available escrow</span><strong>{formatEther(bounty.escrowBalance)} MON</strong></div>
                          <div><span>Your contributions</span><strong>{formatEther(bounty.contributed)} MON</strong></div>
                          <div><span>Deposits</span><strong>{bounty.depositCount}</strong></div>
                          <a
                            href={`https://testnet.monadvision.com/tx/${bounty.latestTransaction}`}
                            target="_blank"
                            rel="noreferrer"
                            className="bounty-transaction-link"
                          >
                            Latest transaction <Icon name="arrow" />
                          </a>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}

          <footer className="workspace-footer">
            <span>BLOCKPATCH <span className="footer-dot">·</span> BUILT FOR RESPONSIBLE DISCLOSURE</span>
            <a href="/#overview">Back to overview ↑</a>
          </footer>
        </main>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: "grid" | "coins" | "shield";
}) {
  return (
    <article className="bounty-summary-card">
      <span className="summary-icon"><Icon name={icon} /></span>
      <p className="card-overline">{label}</p>
      <strong>{value}</strong>
      <span className="summary-detail">{detail}</span>
    </article>
  );
}

function Icon({ name }: { name: "grid" | "coins" | "shield" | "arrow" | "spark" | "refresh" }) {
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
  return <svg {...shared}><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></svg>;
}
