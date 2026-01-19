/**
 * Passport Storage
 * 
 * SQLite-based persistent storage for Passport v4 events and scores.
 */

import Database from "better-sqlite3";
import type { PassportEvent, PassportScore } from "./types";

export class PassportStorage {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.initSchema();
  }

  /**
   * Initialize database schema.
   */
  private initSchema(): void {
    // Agents table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        identity_snapshot_hash TEXT NOT NULL
      )
    `);

    // Passport events table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS passport_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        event_type TEXT NOT NULL CHECK(event_type IN ('settlement_success', 'settlement_failure', 'dispute_resolved')),
        ts INTEGER NOT NULL,
        transcript_hash TEXT NOT NULL,
        counterparty_agent_id TEXT,
        value_usd REAL,
        failure_code TEXT,
        stage TEXT,
        fault_domain TEXT,
        terminality TEXT CHECK(terminality IN ('terminal', 'non_terminal')),
        dispute_outcome TEXT,
        metadata_json TEXT,
        FOREIGN KEY (agent_id) REFERENCES agents(agent_id),
        UNIQUE(transcript_hash, agent_id)
      )
    `);

    // Create index on transcript_hash for idempotency checks
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_passport_events_transcript_hash ON passport_events(transcript_hash)
    `);

    // Create index on agent_id for scoring queries
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_passport_events_agent_id ON passport_events(agent_id, ts)
    `);

    // Passport scores table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS passport_scores (
        agent_id TEXT PRIMARY KEY,
        computed_at INTEGER NOT NULL,
        score REAL NOT NULL CHECK(score >= 0 AND score <= 100),
        confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
        breakdown_json TEXT NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
      )
    `);

    // Credit accounts table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS credit_accounts (
        agent_id TEXT PRIMARY KEY,
        tier TEXT NOT NULL CHECK(tier IN ('A', 'B', 'C')),
        updated_at INTEGER NOT NULL,
        disabled_until INTEGER,
        reason TEXT,
        FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
      )
    `);

    // Credit exposure table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS credit_exposure (
        agent_id TEXT PRIMARY KEY,
        outstanding_usd REAL NOT NULL DEFAULT 0,
        per_counterparty_json TEXT NOT NULL DEFAULT '{}',
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(agent_id)
      )
    `);

    // Credit events table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS credit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        ts INTEGER NOT NULL,
        transcript_hash TEXT NOT NULL,
        delta_usd REAL NOT NULL,
        counterparty_agent_id TEXT,
        reason_code TEXT NOT NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(agent_id),
        UNIQUE(transcript_hash, agent_id)
      )
    `);

    // Create indexes for credit events
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_credit_events_agent_id ON credit_events(agent_id, ts)
    `);
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_credit_events_transcript_hash ON credit_events(transcript_hash)
    `);
  }

  /**
   * Upsert agent record.
   */
  upsertAgent(agentId: string, identitySnapshotHash: string, createdAt: number): void {
    const stmt = this.db.prepare(`
      INSERT INTO agents (agent_id, created_at, identity_snapshot_hash)
      VALUES (?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        identity_snapshot_hash = excluded.identity_snapshot_hash
    `);
    stmt.run(agentId, createdAt, identitySnapshotHash);
  }

  /**
   * Insert passport event (idempotent on transcript_hash + agent_id).
   */
  insertEvent(event: Omit<PassportEvent, "id">): boolean {
    const stmt = this.db.prepare(`
      INSERT INTO passport_events (
        agent_id, event_type, ts, transcript_hash, counterparty_agent_id,
        value_usd, failure_code, stage, fault_domain, terminality,
        dispute_outcome, metadata_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(transcript_hash, agent_id) DO NOTHING
    `);

    const result = stmt.run(
      event.agent_id,
      event.event_type,
      event.ts,
      event.transcript_hash,
      event.counterparty_agent_id,
      event.value_usd,
      event.failure_code,
      event.stage,
      event.fault_domain,
      event.terminality,
      event.dispute_outcome,
      event.metadata_json
    );

    // Return true if row was inserted (changes > 0), false if conflict (already exists)
    return result.changes > 0;
  }

  /**
   * Upsert passport score.
   */
  upsertScore(score: PassportScore): void {
    const stmt = this.db.prepare(`
      INSERT INTO passport_scores (agent_id, computed_at, score, confidence, breakdown_json)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        computed_at = excluded.computed_at,
        score = excluded.score,
        confidence = excluded.confidence,
        breakdown_json = excluded.breakdown_json
    `);
    stmt.run(score.agent_id, score.computed_at, score.score, score.confidence, score.breakdown_json);
  }

  /**
   * Check if transcript_hash + agent_id combination already exists (for idempotency).
   */
  hasTranscriptHash(transcriptHash: string, agentId?: string): boolean {
    if (agentId) {
      const stmt = this.db.prepare(`
        SELECT 1 FROM passport_events WHERE transcript_hash = ? AND agent_id = ? LIMIT 1
      `);
      const result = stmt.get(transcriptHash, agentId);
      return result !== undefined;
    } else {
      // Check if transcript_hash exists for any agent
      const stmt = this.db.prepare(`
        SELECT 1 FROM passport_events WHERE transcript_hash = ? LIMIT 1
      `);
      const result = stmt.get(transcriptHash);
      return result !== undefined;
    }
  }

  /**
   * Get all events for an agent (for testing/debugging).
   */
  getEventsByAgent(agentId: string): PassportEvent[] {
    const stmt = this.db.prepare(`
      SELECT * FROM passport_events WHERE agent_id = ? ORDER BY ts ASC
    `);
    return stmt.all(agentId) as PassportEvent[];
  }

  /**
   * Get score for an agent (for testing/debugging).
   */
  getScore(agentId: string): PassportScore | null {
    const stmt = this.db.prepare(`
      SELECT * FROM passport_scores WHERE agent_id = ?
    `);
    const result = stmt.get(agentId) as PassportScore | undefined;
    return result || null;
  }

  /**
   * Get event count by type (for testing).
   */
  getEventCounts(): { event_type: string; count: number }[] {
    const stmt = this.db.prepare(`
      SELECT event_type, COUNT(*) as count
      FROM passport_events
      GROUP BY event_type
    `);
    return stmt.all() as { event_type: string; count: number }[];
  }

  /**
   * Upsert credit account.
   */
  upsertCreditAccount(
    agentId: string,
    tier: "A" | "B" | "C",
    updatedAt: number,
    disabledUntil?: number | null,
    reason?: string | null
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO credit_accounts (agent_id, tier, updated_at, disabled_until, reason)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        tier = excluded.tier,
        updated_at = excluded.updated_at,
        disabled_until = excluded.disabled_until,
        reason = excluded.reason
    `);
    stmt.run(agentId, tier, updatedAt, disabledUntil ?? null, reason ?? null);
  }

  /**
   * Get credit account.
   */
  getCreditAccount(agentId: string): {
    agent_id: string;
    tier: "A" | "B" | "C";
    updated_at: number;
    disabled_until: number | null;
    reason: string | null;
  } | null {
    const stmt = this.db.prepare(`
      SELECT * FROM credit_accounts WHERE agent_id = ?
    `);
    const result = stmt.get(agentId) as
      | {
          agent_id: string;
          tier: "A" | "B" | "C";
          updated_at: number;
          disabled_until: number | null;
          reason: string | null;
        }
      | undefined;
    return result || null;
  }

  /**
   * Upsert credit exposure.
   */
  upsertCreditExposure(
    agentId: string,
    outstandingUsd: number,
    perCounterpartyJson: string,
    updatedAt: number
  ): void {
    const stmt = this.db.prepare(`
      INSERT INTO credit_exposure (agent_id, outstanding_usd, per_counterparty_json, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET
        outstanding_usd = excluded.outstanding_usd,
        per_counterparty_json = excluded.per_counterparty_json,
        updated_at = excluded.updated_at
    `);
    stmt.run(agentId, outstandingUsd, perCounterpartyJson, updatedAt);
  }

  /**
   * Get credit exposure.
   */
  getCreditExposure(agentId: string): {
    agent_id: string;
    outstanding_usd: number;
    per_counterparty_json: string;
    updated_at: number;
  } | null {
    const stmt = this.db.prepare(`
      SELECT * FROM credit_exposure WHERE agent_id = ?
    `);
    const result = stmt.get(agentId) as
      | {
          agent_id: string;
          outstanding_usd: number;
          per_counterparty_json: string;
          updated_at: number;
        }
      | undefined;
    return result || null;
  }

  /**
   * Insert credit event (idempotent on transcript_hash + agent_id).
   */
  insertCreditEvent(event: {
    agent_id: string;
    ts: number;
    transcript_hash: string;
    delta_usd: number;
    counterparty_agent_id: string | null;
    reason_code: string;
  }): boolean {
    const stmt = this.db.prepare(`
      INSERT INTO credit_events (
        agent_id, ts, transcript_hash, delta_usd, counterparty_agent_id, reason_code
      )
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(transcript_hash, agent_id) DO NOTHING
    `);

    const result = stmt.run(
      event.agent_id,
      event.ts,
      event.transcript_hash,
      event.delta_usd,
      event.counterparty_agent_id,
      event.reason_code
    );

    // Return true if row was inserted (changes > 0), false if conflict (already exists)
    return result.changes > 0;
  }

  /**
   * Get credit events for an agent (for testing/debugging).
   */
  getCreditEventsByAgent(agentId: string): Array<{
    id: number;
    agent_id: string;
    ts: number;
    transcript_hash: string;
    delta_usd: number;
    counterparty_agent_id: string | null;
    reason_code: string;
  }> {
    const stmt = this.db.prepare(`
      SELECT * FROM credit_events WHERE agent_id = ? ORDER BY ts ASC
    `);
    return stmt.all(agentId) as Array<{
      id: number;
      agent_id: string;
      ts: number;
      transcript_hash: string;
      delta_usd: number;
      counterparty_agent_id: string | null;
      reason_code: string;
    }>;
  }

  /**
   * Check if credit event exists for transcript_hash (idempotency check).
   */
  hasCreditEvent(transcriptHash: string, agentId?: string): boolean {
    if (agentId) {
      const stmt = this.db.prepare(`
        SELECT 1 FROM credit_events WHERE transcript_hash = ? AND agent_id = ? LIMIT 1
      `);
      const result = stmt.get(transcriptHash, agentId);
      return result !== undefined;
    } else {
      const stmt = this.db.prepare(`
        SELECT 1 FROM credit_events WHERE transcript_hash = ? LIMIT 1
      `);
      const result = stmt.get(transcriptHash);
      return result !== undefined;
    }
  }

  /**
   * Get recent failure events for kill switch checks.
   */
  getRecentFailures(
    agentId: string,
    windowMs: number,
    failureCodePattern?: string
  ): Array<{
    transcript_hash: string;
    failure_code: string | null;
    ts: number;
    fault_domain: string | null;
  }> {
    let query = `
      SELECT transcript_hash, failure_code, ts, fault_domain
      FROM passport_events
      WHERE agent_id = ? AND event_type = 'settlement_failure' AND ts >= ?
    `;
    const params: Array<string | number> = [agentId, Date.now() - windowMs];

    if (failureCodePattern) {
      query += ` AND failure_code LIKE ?`;
      params.push(failureCodePattern);
    }

    query += ` ORDER BY ts DESC`;

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Array<{
      transcript_hash: string;
      failure_code: string | null;
      ts: number;
      fault_domain: string | null;
    }>;
  }

  /**
   * Get recent dispute outcomes for kill switch checks.
   */
  getRecentDisputes(
    agentId: string,
    windowMs: number,
    outcome?: string
  ): Array<{
    transcript_hash: string;
    dispute_outcome: string | null;
    ts: number;
  }> {
    let query = `
      SELECT transcript_hash, dispute_outcome, ts
      FROM passport_events
      WHERE agent_id = ? AND event_type = 'dispute_resolved' AND ts >= ?
    `;
    const params: Array<string | number> = [agentId, Date.now() - windowMs];

    if (outcome) {
      query += ` AND dispute_outcome = ?`;
      params.push(outcome);
    }

    query += ` ORDER BY ts DESC`;

    const stmt = this.db.prepare(query);
    return stmt.all(...params) as Array<{
      transcript_hash: string;
      dispute_outcome: string | null;
      ts: number;
    }>;
  }

  /**
   * Close database connection.
   */
  close(): void {
    this.db.close();
  }
}
