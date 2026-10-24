"use client";

import { useEffect, useState } from "react";
import { isAddress } from "ethers";
import { useParams } from "next/navigation";
import { apiUrl } from "@/lib/api";

type HistoryReport = {
  projectId: string;
  status: string;
  reviewStatus: string;
  severity: string;
  createdAt: number;
  reviewedAt: number | null;
};

type ResearcherProfile = {
  projects: number;
  submitted: number;
  accepted: number;
  rejected: number;
  pending: number;
  hasMore: boolean;
  reports: HistoryReport[];
};

export default function ResearcherProfilePage() {
  const { address: routeAddress } = useParams<{ address: string }>();
  const [profile, setProfile] = useState<ResearcherProfile | null>(null);
  const [error, setError] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const address = isAddress(routeAddress) ? routeAddress : "";

  async function copyProfileLink() {
    try {
      if (!navigator.clipboard) throw new Error("Clipboard access is unavailable in this browser.");
      await navigator.clipboard.writeText(window.location.href);
      setShareMessage("Public profile link copied.");
    } catch (copyError) {
      setShareMessage(
        copyError instanceof Error ? copyError.message : "Could not copy the profile link.",
      );
    }
  }

  useEffect(() => {
    if (!address) {
      setError("This profile wallet address is invalid.");
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setError("");

    Promise.resolve()
      .then(() => fetch(apiUrl(`/api/profiles/${address}`), { signal: controller.signal }))
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load this profile.");
        setProfile(data as ResearcherProfile);
      })
      .catch((requestError: unknown) => {
        if (controller.signal.aborted) return;
        setError(requestError instanceof Error ? requestError.message : "Could not load this profile.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [address]);

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
          <a className="nav-link" href="/bounties"><Icon name="grid" /><span>My bounties</span></a>
          <a className="nav-link active" href="/profile"><Icon name="shield" /><span>Research profiles</span></a>
          <a className="nav-link" href="/#report"><Icon name="shield" /><span>Submit a report</span></a>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note-icon"><Icon name="spark" /></div>
          <p className="sidebar-note-title">Public researcher profile</p>
          <p className="sidebar-note-copy">A transparent record of report outcomes, without exposing private finding details.</p>
          <span className="sidebar-version">RESPONSIBLE DISCLOSURE</span>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <p className="breadcrumb">Community <span>/</span> Researcher profile</p>
          <div className="topbar-actions">
            <span className="network-pill"><span className="status-dot" /> Public profile</span>
          </div>
        </header>

        <main className="workspace">
          <section className="welcome-section profile-welcome">
            <div>
              <p className="eyebrow"><span className="eyebrow-line" /> RESEARCHER HISTORY</p>
              <h1>Proof of<br className="desktop-break" /> good work.</h1>
              <p className="welcome-copy">A public summary of this wallet’s responsible disclosure history and reviewed outcomes.</p>
            </div>
          </section>

          <section className="profile-identity-card">
            <span className="profile-avatar"><Icon name="shield" /></span>
            <div className="profile-identity-copy">
              <span className="card-overline">PUBLIC WALLET PROFILE</span>
              <h2>{address ? `${address.slice(0, 10)}…${address.slice(-8)}` : "Invalid wallet address"}</h2>
              {address && <code>{address}</code>}
            </div>
            <div className="profile-actions">
              <button className="button button-quiet profile-share-link" onClick={copyProfileLink} disabled={!address}>
                Copy profile link <Icon name="copy" />
              </button>
              <a className="button button-quiet profile-share-link" href={address ? `https://testnet.monadvision.com/address/${address}` : "/#overview"} target={address ? "_blank" : undefined} rel={address ? "noreferrer" : undefined}>
                View on explorer <Icon name="arrow" />
              </a>
            </div>
          </section>

          {shareMessage && <p role="status" className="feedback-message">{shareMessage}</p>}
          {error && <p role="alert" className="feedback-message">{error}</p>}
          {isLoading && <p className="loading-state" role="status">Loading public history…</p>}

          {profile && (
            <>
              <section className="profile-stats-grid" aria-label="Researcher report totals">
                <ProfileStat label="PROJECTS REPORTED" value={profile.projects} tone="neutral" />
                <ProfileStat label="REPORTS SUBMITTED" value={profile.submitted} tone="neutral" />
                <ProfileStat label="ACCEPTED BY REVIEWERS" value={profile.accepted} tone="accepted" />
                <ProfileStat label="REJECTED BY REVIEWERS" value={profile.rejected} tone="rejected" />
                <ProfileStat label="AWAITING REVIEW" value={profile.pending} tone="pending" />
              </section>

              <section className="actions-section profile-history-section" aria-labelledby="profile-history-heading">
                <div className="section-heading">
                  <div>
                    <p className="card-overline">SUBMISSION RECORD</p>
                    <h2 id="profile-history-heading">Project history</h2>
                  </div>
                  <span className="section-caption">Most recent first · private report details are hidden</span>
                </div>

                {profile.reports.length === 0 ? (
                  <section className="bounty-empty-state profile-empty-state">
                    <span className="empty-state-icon"><Icon name="shield" /></span>
                    <h2>No public report history yet</h2>
                    <p>Reviewed and pending submissions from this wallet will appear here.</p>
                  </section>
                ) : (
                  <div className="profile-history-list">
                    {profile.reports.map((report, index) => (
                      <article className="profile-history-item" key={`${report.projectId}-${report.createdAt}-${index}`}>
                        <span className="history-marker"><Icon name="shield" /></span>
                        <div className="history-main">
                          <div className="history-heading">
                            <div>
                              <h3>{report.projectId}</h3>
                              <p>{formatDate(report.createdAt)} <span>·</span> {report.severity} severity</p>
                            </div>
                            <span className={`review-badge ${reviewBadgeClass(report)}`}>
                              {reviewLabel(report)}
                            </span>
                          </div>
                          {report.reviewedAt && (
                            <p className="history-reviewed">Reviewed {formatDate(report.reviewedAt)}</p>
                          )}
                        </div>
                      </article>
                    ))}
                    {profile.hasMore && (
                      <p className="history-limit-note">Showing the latest 100 submissions. Totals above include all submissions.</p>
                    )}
                  </div>
                )}
              </section>
              <p className="profile-privacy-note">
                This public page shows project IDs, severity, and reviewer outcomes only. Report titles, descriptions, and proofs of concept remain private.
              </p>
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

function ProfileStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "accepted" | "rejected" | "pending";
}) {
  return (
    <article className={`profile-stat-card profile-stat-${tone}`}>
      <span className="card-overline">{label}</span>
      <strong>{value}</strong>
      <span className="profile-stat-indicator" />
    </article>
  );
}

function reviewLabel(report: HistoryReport): string {
  if (report.status !== "ACCEPTED") return report.status === "DUPLICATE" ? "Duplicate" : "Not eligible";
  if (report.reviewStatus === "APPROVED") return "Accepted";
  if (report.reviewStatus === "REJECTED") return "Rejected";
  return "Pending review";
}

function reviewBadgeClass(report: HistoryReport): string {
  if (report.reviewStatus === "APPROVED") return "review-accepted";
  if (report.reviewStatus === "REJECTED") return "review-rejected";
  if (report.reviewStatus === "PENDING_REVIEW") return "review-pending";
  return "review-other";
}

function formatDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(timestamp));
}

function Icon({ name }: { name: "grid" | "coins" | "shield" | "arrow" | "spark" | "copy" }) {
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
  if (name === "copy") {
    return <svg {...shared}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></svg>;
  }
  return <svg {...shared}><path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z" /><path d="m19 15 .9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15Z" /></svg>;
}
