/**
 * S19 Thread E — `npm run outreach:log -- --reviewer "..." --channel email
 * --sent-at 2026-07-10T...Z [--status sent|returned|declined|no-response]
 * [--labels-affected N]`. Appends a single schema-validated entry to
 * `data/eval/clinician-outreach.json`.
 *
 * Mirrors `apply-clinician-review.ts`'s pattern:
 *   - Path resolved from `__dirname` (NOT `process.cwd()` — the same
 *     `__dirname`-anchored resolution `scripts/eval.ts` and
 *     `apply-clinician-review.ts` use so the script works the same
 *     regardless of the invoking shell's working directory).
 *   - `main()` guarded by `if (require.main === module)`.
 *   - Validates BEFORE writing — the file is read, the new entry is
 *     appended in-memory, the schema is re-validated as a whole, and only
 *     a successful validation causes a write. A failure throws and the
 *     file is NOT mutated.
 *   - `--status sent` is the default (matches the "email went out today"
 *     use case in s18-clinician-engagement.md §1). Other values
 *     ('returned', 'declined', 'no-response') match the §4 update protocol.
 *
 * Pure script-side logic; no LLM, no HTTP. The schema validator
 * (`validateOutreach` from `eval/outreachSchema.ts`) is the same one
 * `scripts/outreach-validate.ts` uses — a single source of truth.
 */
import fs from 'fs';
import path from 'path';
import { validateOutreach, CHANNEL_VALUES, STATUS_VALUES } from '../eval/outreachSchema';

const OUTREACH_PATH = path.resolve(__dirname, '../../../../data/eval/clinician-outreach.json');

interface AddArgs {
  reviewer: string;
  sentAt: string;
  channel: (typeof CHANNEL_VALUES)[number];
  status: (typeof STATUS_VALUES)[number];
  labelsAffected: number;
}

interface AddResult {
  ok: boolean;
  entry?: { reviewer: string; sentAt: string; channel: string; status: string; labelsAffected: number };
  errors: string[];
}

// Minimal _meta scaffold when bootstrapping a fresh file. The schema
// (`outreachSchema.ts`) requires _meta.purpose / _meta.lastUpdated /
// _meta.consentBoundary to all be strings; an empty `_meta: {}` fails
// validation. The bootstrap defaults below match the project's
// committable baseline at `data/eval/clinician-outreach.json`.
const BOOTSTRAP_META = {
  purpose: 'Tracks clinician review invitations — does not gate the eval, surfaces the engagement gap explicitly.',
  lastUpdated: new Date().toISOString().slice(0, 10), // YYYY-MM-DD
  consentBoundary:
    'By adding a `reviewer` entry, the committer affirms the reviewer has consented to their name being recorded in this public eval artifact.',
};

/** Read the existing JSON file or return a known-valid bootstrap baseline.
 *  Pure: no I/O outside the file system call. */
function readOrBootstrap(): { current: unknown; exists: boolean } {
  if (!fs.existsSync(OUTREACH_PATH)) {
    return { current: { _meta: BOOTSTRAP_META, invitations: [] }, exists: false };
  }
  let current: unknown;
  try {
    current = JSON.parse(fs.readFileSync(OUTREACH_PATH, 'utf-8'));
  } catch (err) {
    throw new Error(`failed to parse existing JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  // Defensive: if the existing file is missing the expected shape, start
  // from a known-empty baseline rather than failing silently.
  if (!current || typeof current !== 'object' || !Array.isArray((current as { invitations?: unknown }).invitations)) {
    return { current: { _meta: BOOTSTRAP_META, invitations: [] }, exists: true };
  }
  return { current, exists: true };
}

/** Atomic write: build the JSON string, then write in one shot. */
export function writeOutreachAppended(args: AddArgs): AddResult {
  const { current } = readOrBootstrap();
  const entry = {
    reviewer: args.reviewer,
    sentAt: args.sentAt,
    channel: args.channel,
    status: args.status,
    labelsAffected: args.labelsAffected,
  };
  const next = {
    ...(current as Record<string, unknown>),
    invitations: [...((current as { invitations: unknown[] }).invitations), entry],
  };

  // Validate before writing — the schema is the source of truth.
  const verdict = validateOutreach(next);
  if (!verdict.ok) {
    return { ok: false, errors: verdict.errors };
  }
  fs.writeFileSync(OUTREACH_PATH, JSON.stringify(next, null, 2), 'utf-8');
  return { ok: true, entry, errors: [] };
}

/**
 * Tiny CLI parser — `npm run outreach:log -- --reviewer "..." --channel
 * email --sent-at 2026-07-10T...Z`. Avoids a CLI dependency for the POC.
 */
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a && a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val !== undefined && !val.startsWith('--')) {
        out[key] = val;
        i++;
      } else {
        out[key] = 'true';
      }
    }
  }
  return out;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  // Required: --reviewer, --channel, --sent-at.
  // Optional: --status (default 'sent'), --labels-affected (default 0).
  const reviewer = args['reviewer'];
  const channel = args['channel'];
  const sentAt = args['sent-at'];
  const status = args['status'] ?? 'sent';
  const labelsAffectedRaw = args['labels-affected'] ?? '0';
  const labelsAffected = Number.parseInt(labelsAffectedRaw, 10);

  if (!reviewer || !channel || !sentAt) {
    console.error('outreach:log usage: --reviewer "..." --channel email|in-person|slack|phone --sent-at 2026-07-10T...Z [--status sent|returned|declined|no-response] [--labels-affected N]');
    process.exit(1);
  }
  if (!CHANNEL_VALUES.includes(channel as (typeof CHANNEL_VALUES)[number])) {
    console.error(`outreach:log: --channel must be one of ${CHANNEL_VALUES.join(', ')}`);
    process.exit(1);
  }
  if (!STATUS_VALUES.includes(status as (typeof STATUS_VALUES)[number])) {
    console.error(`outreach:log: --status must be one of ${STATUS_VALUES.join(', ')}`);
    process.exit(1);
  }
  if (!Number.isInteger(labelsAffected) || labelsAffected < 0) {
    console.error(`outreach:log: --labels-affected must be a non-negative integer (got "${labelsAffectedRaw}")`);
    process.exit(1);
  }

  // After the .includes() guards above, the cast is safe.
  const result = writeOutreachAppended({
    reviewer,
    sentAt,
    channel: channel as (typeof CHANNEL_VALUES)[number],
    status: status as (typeof STATUS_VALUES)[number],
    labelsAffected,
  });
  if (!result.ok) {
    console.error('outreach:log: validation failed:');
    for (const err of result.errors) console.error(`  - ${err}`);
    process.exit(1);
  }
  console.log(`outreach:log: appended entry — reviewer=${result.entry!.reviewer}, channel=${result.entry!.channel}, status=${result.entry!.status}, sentAt=${result.entry!.sentAt}, labelsAffected=${result.entry!.labelsAffected}`);
  console.log(`wrote ${OUTREACH_PATH}`);
}

if (require.main === module) {
  main();
}
