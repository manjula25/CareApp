import Database from 'better-sqlite3';
import { migrate } from './index';
import { writeAnalysisCache, readAnalysisCache } from './analysisCache';

describe('analysisCache', () => {
  it('round-trips the full result including nested Task-payload-shaped data', () => {
    const db = new Database(':memory:');
    migrate(db);

    const resultJson = {
      findings: {
        sdoh: [{ id: 'f1', text: 'housing instability', citations: ['obs-1'] }],
        careGap: [{ id: 'f2', text: 'missed colonoscopy screening', citations: ['proc-1'] }],
      },
      tasks: [
        {
          id: 'task-1',
          title: 'Schedule colonoscopy',
          status: 'open',
          payload: { assignedTo: 'social_worker', dueDate: '2026-08-01', notes: 'urgent' },
        },
      ],
      summary: 'Patient has 2 open findings requiring follow-up.',
    };

    writeAnalysisCache(db, {
      patientId: 'patient-123',
      resultJson,
      modelVersion: 'v1.0.0',
      createdTs: '2026-07-05T00:00:00.000Z',
    });

    const row = readAnalysisCache(db, 'patient-123');

    expect(row).not.toBeNull();
    expect(row?.patientId).toBe('patient-123');
    expect(row?.modelVersion).toBe('v1.0.0');
    expect(row?.createdTs).toBe('2026-07-05T00:00:00.000Z');
    expect(row?.resultJson).toEqual(resultJson);
  });

  it('overwrites the prior row for the same patientId on a second write', () => {
    const db = new Database(':memory:');
    migrate(db);

    writeAnalysisCache(db, {
      patientId: 'patient-123',
      resultJson: { summary: 'first run' },
      modelVersion: 'v1.0.0',
      createdTs: '2026-07-05T00:00:00.000Z',
    });

    writeAnalysisCache(db, {
      patientId: 'patient-123',
      resultJson: { summary: 'second run' },
      modelVersion: 'v1.1.0',
      createdTs: '2026-07-05T01:00:00.000Z',
    });

    const row = readAnalysisCache(db, 'patient-123');

    expect(row?.resultJson).toEqual({ summary: 'second run' });
    expect(row?.modelVersion).toBe('v1.1.0');
    expect(row?.createdTs).toBe('2026-07-05T01:00:00.000Z');

    const count = (
      db.prepare('SELECT COUNT(*) as n FROM analysis_cache WHERE patient_id = ?').get('patient-123') as {
        n: number;
      }
    ).n;
    expect(count).toBe(1);
  });

  it('returns null when no row exists for the patient', () => {
    const db = new Database(':memory:');
    migrate(db);

    const row = readAnalysisCache(db, 'nonexistent-patient');

    expect(row).toBeNull();
  });
});
