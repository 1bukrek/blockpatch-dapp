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

  close() {
    this.database.close();
  }
}
