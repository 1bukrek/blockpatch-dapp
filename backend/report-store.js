import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";
import { normalize } from "./analysis.js";

export class ReportStore {
  constructor(databasePath) {
    const resolvedPath = databasePath === ":memory:" ? databasePath : resolve(databasePath);
    if (resolvedPath !== ":memory:") mkdirSync(dirname(resolvedPath), { recursive: true });

    this.database = new Database(resolvedPath);
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        report_hash TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        normalized_project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        normalized_title TEXT NOT NULL,
        description TEXT NOT NULL,
        normalized_description TEXT NOT NULL,
        poc TEXT NOT NULL,
        researcher_address TEXT NOT NULL,
        triage_status TEXT NOT NULL,
        review_status TEXT NOT NULL,
        confidence_score REAL NOT NULL,
        severity TEXT NOT NULL,
        duplicate_of TEXT,
        suggested_payout_percentage INTEGER NOT NULL,
        reasoning TEXT NOT NULL,
        amount_wei TEXT,
        signature TEXT,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        reviewed_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS researcher_submissions (
        submission_id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_hash TEXT NOT NULL,
        researcher_address TEXT NOT NULL,
        project_id TEXT NOT NULL,
        triage_status TEXT NOT NULL,
        severity TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS researcher_submissions_profile
        ON researcher_submissions (researcher_address, created_at DESC);
      INSERT INTO researcher_submissions (
        report_hash, researcher_address, project_id, triage_status, severity, created_at
      )
      SELECT
        r.report_hash, r.researcher_address, r.project_id, r.triage_status, r.severity, r.created_at
      FROM reports r
      WHERE NOT EXISTS (
        SELECT 1 FROM researcher_submissions s WHERE s.report_hash = r.report_hash
      );
      CREATE INDEX IF NOT EXISTS reports_duplicate_lookup
        ON reports (normalized_project_id, normalized_title, normalized_description, triage_status);
    `);

    this.findDuplicateStatement = this.database.prepare(`
      SELECT report_hash AS reportHash
      FROM reports
      WHERE normalized_project_id = ?
        AND normalized_title = ?
        AND normalized_description = ?
        AND triage_status = 'ACCEPTED'
      ORDER BY created_at
      LIMIT 1
    `);
    this.insertReportStatement = this.database.prepare(`
      INSERT INTO reports (
        report_hash, project_id, normalized_project_id, title, normalized_title,
        description, normalized_description, poc, researcher_address, triage_status,
        review_status, confidence_score, severity, duplicate_of,
        suggested_payout_percentage, reasoning, created_at
      ) VALUES (
        @reportHash, @projectId, @normalizedProjectId, @title, @normalizedTitle,
        @description, @normalizedDescription, @poc, @researcherAddress, @status,
        @reviewStatus, @confidence_score, @severity, @duplicate_of,
        @suggested_payout_percentage, @reasoning, @createdAt
      )
    `);
    this.findReportStatement = this.database.prepare(`
      SELECT
        report_hash AS reportHash,
        project_id AS projectId,
        title,
        description,
        poc,
        researcher_address AS researcherAddress,
        triage_status AS status,
        review_status AS reviewStatus,
        confidence_score AS confidence_score,
        severity,
        duplicate_of AS duplicate_of,
        suggested_payout_percentage AS suggested_payout_percentage,
        reasoning,
        amount_wei AS amount,
        signature,
        expires_at AS expiresAt,
        created_at AS createdAt,
        reviewed_at AS reviewedAt
      FROM reports
      WHERE report_hash = ?
    `);
    this.approveStatement = this.database.prepare(`
      UPDATE reports
      SET review_status = 'APPROVED',
          amount_wei = @amount,
          signature = @signature,
          expires_at = @expiresAt,
          reviewed_at = @reviewedAt
      WHERE report_hash = @reportHash
        AND triage_status = 'ACCEPTED'
        AND review_status = 'PENDING_REVIEW'
    `);
    this.renewStatement = this.database.prepare(`
      UPDATE reports
      SET signature = @signature,
          expires_at = @expiresAt,
          reviewed_at = @reviewedAt
      WHERE report_hash = @reportHash
        AND triage_status = 'ACCEPTED'
        AND review_status = 'APPROVED'
        AND expires_at <= @now
    `);
    this.rejectStatement = this.database.prepare(`
      UPDATE reports
      SET review_status = 'REJECTED',
          reviewed_at = @reviewedAt
      WHERE report_hash = @reportHash
        AND triage_status = 'ACCEPTED'
        AND review_status = 'PENDING_REVIEW'
    `);
    this.researcherProfileStatement = this.database.prepare(`
      SELECT
        s.project_id AS projectId,
        s.triage_status AS status,
        CASE
          WHEN s.triage_status = 'ACCEPTED' THEN COALESCE(r.review_status, 'PENDING_REVIEW')
          ELSE s.triage_status
        END AS reviewStatus,
        s.severity,
        s.created_at AS createdAt,
        CASE WHEN s.triage_status = 'ACCEPTED' THEN r.reviewed_at ELSE NULL END AS reviewedAt
      FROM researcher_submissions s
      LEFT JOIN reports r ON r.report_hash = s.report_hash
      WHERE lower(s.researcher_address) = lower(?)
      ORDER BY s.created_at DESC, s.submission_id DESC
      LIMIT 100
    `);
    this.researcherProfileCountsStatement = this.database.prepare(`
      SELECT
        COUNT(*) AS submitted,
        COUNT(DISTINCT lower(s.project_id)) AS projects,
        COALESCE(SUM(CASE WHEN s.triage_status = 'ACCEPTED' AND r.review_status = 'APPROVED' THEN 1 ELSE 0 END), 0) AS accepted,
        COALESCE(SUM(CASE WHEN s.triage_status = 'ACCEPTED' AND r.review_status = 'REJECTED' THEN 1 ELSE 0 END), 0) AS rejected,
        COALESCE(SUM(CASE WHEN s.triage_status = 'ACCEPTED' AND (r.review_status = 'PENDING_REVIEW' OR r.review_status IS NULL) THEN 1 ELSE 0 END), 0) AS pending
      FROM researcher_submissions s
      LEFT JOIN reports r ON r.report_hash = s.report_hash
      WHERE lower(s.researcher_address) = lower(?)
    `);
    this.insertSubmissionStatement = this.database.prepare(`
      INSERT INTO researcher_submissions (
        report_hash, researcher_address, project_id, triage_status, severity, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `);
  }

  findDuplicate(report) {
    return this.findDuplicateStatement.get(
      normalize(report.projectId),
      normalize(report.title),
      normalize(report.description),
    );
  }

  add(report, result) {
    this.insertReportStatement.run({
      reportHash: result.reportHash,
      projectId: report.projectId,
      normalizedProjectId: normalize(report.projectId),
      title: report.title,
      normalizedTitle: normalize(report.title),
      description: report.description,
      normalizedDescription: normalize(report.description),
      poc: report.poc,
      researcherAddress: report.researcherAddress,
      status: result.status,
      reviewStatus: result.status === "ACCEPTED" ? "PENDING_REVIEW" : result.status,
      confidence_score: result.confidence_score,
      severity: result.severity,
      duplicate_of: result.duplicate_of,
      suggested_payout_percentage: result.suggested_payout_percentage,
      reasoning: result.reasoning,
      createdAt: Date.now(),
    });
  }

  addSubmission(report, result) {
    this.insertSubmissionStatement.run(
      result.reportHash,
      report.researcherAddress,
      report.projectId,
      result.status,
      result.severity,
      Date.now(),
    );
  }

  get(reportHash) {
    return this.findReportStatement.get(reportHash);
  }

  approve({ reportHash, amount, signature, expiresAt }) {
    return this.approveStatement.run({
      reportHash,
      amount,
      signature,
      expiresAt,
      reviewedAt: Date.now(),
    }).changes === 1;
  }

  renew({ reportHash, signature, expiresAt }) {
    return this.renewStatement.run({
      reportHash,
      signature,
      expiresAt,
      reviewedAt: Date.now(),
      now: Math.floor(Date.now() / 1000),
    }).changes === 1;
  }

  reject(reportHash) {
    return this.rejectStatement.run({
      reportHash,
      reviewedAt: Date.now(),
    }).changes === 1;
  }

  getResearcherProfile(address) {
    const counts = this.researcherProfileCountsStatement.get(address);
    const reports = this.researcherProfileStatement.all(address);
    return {
      submitted: counts.submitted,
      projects: counts.projects,
      accepted: counts.accepted,
      rejected: counts.rejected,
      pending: counts.pending,
      hasMore: counts.submitted > reports.length,
      reports,
    };
  }

  close() {
    this.database.close();
  }
}
