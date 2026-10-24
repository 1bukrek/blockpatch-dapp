"use client";

import { FormEvent, useState } from "react";
import { isAddress } from "ethers";
import { useRouter } from "next/navigation";

export default function ResearcherProfilesPage() {
  const router = useRouter();
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [isConnecting, setIsConnecting] = useState(false);

  function openProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedAddress = address.trim();
    if (!isAddress(normalizedAddress)) {
      setError("Geçerli bir cüzdan adresi girin.");
      return;
    }
    setError("");
    router.push(`/profile/${normalizedAddress}`);
  }

  async function openMyProfile() {
    if (!window.ethereum) {
      setError("MetaMask bulunamadı. Bir cüzdan adresi girerek profili arayabilirsiniz.");
      return;
    }

    setIsConnecting(true);
    setError("");
    try {
      const accounts: unknown = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !isAddress(accounts[0])) {
        throw new Error("Cüzdandan geçerli bir adres alınamadı.");
      }
      router.push(`/profile/${accounts[0]}`);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Cüzdan bağlanamadı.");
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/#overview" aria-label="Blockpatch ana sayfa">
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M7 7h8v8H7zM17 7h8v8h-8zM7 17h8v8H7z" fill="currentColor" />
              <path d="M17 17h8v8h-8z" fill="currentColor" opacity=".48" />
            </svg>
          </span>
          <span>blockpatch<span className="brand-period">.</span></span>
        </a>
        <p className="sidebar-label">Workspace</p>
        <nav className="sidebar-nav" aria-label="Ana navigasyon">
          <a className="nav-link" href="/#overview"><Icon name="grid" /><span>Overview</span></a>
          <a className="nav-link" href="/#fund"><Icon name="coins" /><span>Fund a bounty</span></a>
          <a className="nav-link" href="/bounties"><Icon name="grid" /><span>My bounties</span></a>
          <a className="nav-link active" href="/profile"><Icon name="shield" /><span>Research profiles</span></a>
          <a className="nav-link" href="/#report"><Icon name="shield" /><span>Submit a report</span></a>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note-icon"><Icon name="spark" /></div>
          <p className="sidebar-note-title">Public researcher history</p>
          <p className="sidebar-note-copy">Look up a wallet to see project counts and public review outcomes.</p>
          <span className="sidebar-version">RESPONSIBLE DISCLOSURE</span>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <p className="breadcrumb">Community <span>/</span> Research profiles</p>
          <a className="button button-quiet button-small" href="/#overview">Back to app</a>
        </header>

        <main className="workspace">
          <section className="welcome-section profile-welcome">
            <div>
              <p className="eyebrow"><span className="eyebrow-line" /> COMMUNITY DIRECTORY</p>
              <h1>Researcher<br className="desktop-break" /> profiles.</h1>
              <p className="welcome-copy">
                View a researcher’s submitted projects and reviewer decisions. Finding details remain private.
              </p>
            </div>
          </section>

          <section className="profile-lookup-card">
            <span className="profile-avatar"><Icon name="shield" /></span>
            <p className="card-overline">LOOK UP A PUBLIC PROFILE</p>
            <h2>See a researcher’s track record.</h2>
            <p className="profile-lookup-copy">
              Enter any wallet address to see how many projects it has reported, along with accepted, rejected, and pending review counts.
            </p>
            <form className="profile-lookup-form" onSubmit={openProfile}>
              <label className="field-label" htmlFor="profile-address">
                Wallet address
              </label>
              <input
                id="profile-address"
                className="field-control"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="0x..."
                autoComplete="off"
                spellCheck={false}
                required
              />
              {error && <p className="profile-lookup-error" role="alert">{error}</p>}
              <div className="profile-lookup-actions">
                <button className="button button-primary" type="submit">
                  View profile <Icon name="arrow" />
                </button>
                <button
                  className="button button-quiet"
                  type="button"
                  onClick={openMyProfile}
                  disabled={isConnecting}
                >
                  {isConnecting ? "Connecting…" : "View my profile"}
                </button>
              </div>
            </form>
            <p className="profile-lookup-footnote">
              Public profiles show aggregate counts and project IDs only—not report titles, descriptions, or proofs of concept.
            </p>
          </section>

          <footer className="workspace-footer">
            <span>BLOCKPATCH <span className="footer-dot">·</span> BUILT FOR RESPONSIBLE DISCLOSURE</span>
            <a href="/#overview">Back to overview ↑</a>
          </footer>
        </main>
      </div>
    </div>
  );
}

function Icon({ name }: { name: "grid" | "coins" | "shield" | "arrow" | "spark" }) {
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
  return <svg {...shared}><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></svg>;
}
