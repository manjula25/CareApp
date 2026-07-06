import Database from 'better-sqlite3';

export type AuditOutcome = 'success' | 'denied' | 'error';

export interface AuditEntry {
  actor: string;
  action: string;
  fhirResource: string;
  outcome: AuditOutcome;
}

export function writeAudit(db: Database.Database, entry: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit_log (ts, actor, action, fhir_resource, outcome) VALUES (?, ?, ?, ?, ?)`
  ).run(new Date().toISOString(), entry.actor, entry.action, entry.fhirResource, entry.outcome);
}

export interface AuditTrailEntry {
  ts: string;
  actor: string;
  action: string;
  resource: string;
  outcome: AuditOutcome;
}

export interface AuditTrailPage {
  entries: AuditTrailEntry[];
  total: number;
}

interface AuditLogRow {
  ts: string;
  actor: string;
  action: string;
  fhir_resource: string;
  outcome: AuditOutcome;
}

/**
 * S8 A1 — paged, most-recent-first read of the S1 `audit_log` table, backing
 * the W06 governance dashboard's live audit trail. Ordered by `id DESC`
 * (insertion order) rather than `ts DESC`: two rows can share the same
 * millisecond-resolution ISO timestamp under a fast burst of writes (e.g. a
 * guard-then-read pair), and `id` is the one column guaranteed to break that
 * tie in actual write order. `total` is the full unpaged row count, so a
 * caller can render "page X of Y" without a second round trip.
 */
export function readAuditTrail(db: Database.Database, limit: number, offset: number): AuditTrailPage {
  const total = (db.prepare('SELECT COUNT(*) as n FROM audit_log').get() as { n: number }).n;
  const rows = db
    .prepare('SELECT ts, actor, action, fhir_resource, outcome FROM audit_log ORDER BY id DESC LIMIT ? OFFSET ?')
    .all(limit, offset) as AuditLogRow[];

  const entries: AuditTrailEntry[] = rows.map((row) => ({
    ts: row.ts,
    actor: row.actor,
    action: row.action,
    resource: row.fhir_resource,
    outcome: row.outcome,
  }));

  return { entries, total };
}
