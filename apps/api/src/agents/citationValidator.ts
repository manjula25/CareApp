export interface AgentFlag {
  text: string;
  fhirResourceId: string;
}

export interface CitationValidationResult {
  valid: AgentFlag[];
  dropped: AgentFlag[];
}

/**
 * Seam 2 — GD11 citation enforcement. Pure, no I/O.
 *
 * Partitions agent flags into those whose `fhirResourceId` is present in the
 * retrieved bundle (`validIds`, a set of `ResourceType/id` strings) and those
 * that are not (hallucinated / out-of-bundle). The `fhirResourceId` is trimmed
 * of surrounding whitespace before matching; FHIR ids are case-sensitive, so no
 * case-folding is applied. Valid flags are returned with the trimmed id.
 */
export function validateCitations(flags: AgentFlag[], validIds: Set<string>): CitationValidationResult {
  const valid: AgentFlag[] = [];
  const dropped: AgentFlag[] = [];

  for (const flag of flags) {
    const trimmedId = flag.fhirResourceId.trim();
    if (validIds.has(trimmedId)) {
      valid.push({ ...flag, fhirResourceId: trimmedId });
    } else {
      dropped.push(flag);
    }
  }

  return { valid, dropped };
}

const CITATION_PATTERN = /\b[A-Z][A-Za-z]*\/[A-Za-z0-9][A-Za-z0-9._-]*\b/g;

/**
 * GD11 also covers the agent's free-text narration, not just the structured
 * `flags` array — a `ResourceType/id` mentioned in prose is just as much a
 * citation as one in a flag. Replaces any such mention absent from the
 * bundle with a visible placeholder; leaves everything else untouched.
 */
export function redactUnvalidatedCitations(text: string, validIds: Set<string>): string {
  return text.replace(CITATION_PATTERN, (match) => (validIds.has(match) ? match : '[unverified citation removed]'));
}

export interface NarrationBuffer {
  push(delta: string): string;
  flush(): string;
}

/**
 * Holds back the last `lookahead` characters of streamed narration so a
 * `ResourceType/id` pattern split across two token deltas is still whole by
 * the time it's checked, then redacts before releasing. Trades a small,
 * bounded delay in the live-streaming effect for a real enforcement
 * guarantee, instead of buffering the whole narration (which would lose the
 * streaming effect entirely).
 */
const TOKEN_CHAR = /[A-Za-z0-9._/-]/;

function isTokenChar(ch: string | undefined): boolean {
  return ch !== undefined && TOKEN_CHAR.test(ch);
}

export function createNarrationBuffer(validIds: Set<string>, lookahead = 96): NarrationBuffer {
  let pending = '';

  return {
    push(delta: string): string {
      pending += delta;
      if (pending.length <= lookahead) {
        return '';
      }
      // Never cut inside a contiguous run of id-shaped characters — back off
      // to the nearest boundary so a citation can't be split between the
      // emitted "safe" text and what's still pending.
      let cut = pending.length - lookahead;
      while (cut > 0 && isTokenChar(pending[cut - 1]) && isTokenChar(pending[cut])) {
        cut--;
      }
      const safeText = pending.slice(0, cut);
      pending = pending.slice(cut);
      return redactUnvalidatedCitations(safeText, validIds);
    },
    flush(): string {
      const rest = redactUnvalidatedCitations(pending, validIds);
      pending = '';
      return rest;
    },
  };
}
