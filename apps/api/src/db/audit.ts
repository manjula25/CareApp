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
