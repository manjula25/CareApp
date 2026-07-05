import Database from 'better-sqlite3';

export interface AnalysisCacheEntry {
  patientId: string;
  resultJson: unknown;
  modelVersion: string;
  createdTs: string;
}

export interface AnalysisCacheRow {
  patientId: string;
  resultJson: unknown;
  modelVersion: string;
  createdTs: string;
}

export function writeAnalysisCache(db: Database.Database, entry: AnalysisCacheEntry): void {
  db.prepare(
    `INSERT INTO analysis_cache (patient_id, result_json, model_version, created_ts)
     VALUES (@patient_id, @result_json, @model_version, @created_ts)
     ON CONFLICT(patient_id) DO UPDATE SET
       result_json = excluded.result_json,
       model_version = excluded.model_version,
       created_ts = excluded.created_ts`
  ).run({
    patient_id: entry.patientId,
    result_json: JSON.stringify(entry.resultJson),
    model_version: entry.modelVersion,
    created_ts: entry.createdTs,
  });
}

export function readAnalysisCache(db: Database.Database, patientId: string): AnalysisCacheRow | null {
  const row = db.prepare('SELECT * FROM analysis_cache WHERE patient_id = ?').get(patientId) as
    | { patient_id: string; result_json: string; model_version: string; created_ts: string }
    | undefined;

  if (!row) return null;

  return {
    patientId: row.patient_id,
    resultJson: JSON.parse(row.result_json),
    modelVersion: row.model_version,
    createdTs: row.created_ts,
  };
}
