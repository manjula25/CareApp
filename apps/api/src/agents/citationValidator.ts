export interface AgentFlag {
  text: string;
  fhirResourceId: string;
}

// Kept as a named alias for back-compat with existing single-agent-shaped
// callers/tests; validateCitations itself is now generic (S3 B3) so it also
// works for CareGapOutput.gaps / SdohOutput.barriers, which share the same
// single-fhirResourceId shape as AgentFlag, just with different sibling fields.
export type CitationValidationResult = ListCitationValidationResult<AgentFlag>;

export interface ListCitationValidationResult<T> {
  valid: T[];
  dropped: T[];
}

/**
 * Seam 2 — GD11 citation enforcement, generalized to items that cite a LIST of
 * `ResourceType/id`s (e.g. the Action Planner's tasks, whose `fhirResources`
 * is a string[]). Pure, no I/O.
 *
 * `getIds` reads an item's cited id(s); `withIds` rebuilds the item with a
 * narrowed id list. Each id is trimmed of surrounding whitespace before
 * matching; FHIR ids are case-sensitive, so no case-folding is applied. An
 * item is KEPT iff at least one of its cited ids is in the bundle (`validIds`),
 * and when kept its id list is narrowed (via `withIds`) to only the valid ids;
 * an item whose citations all drop is dropped entirely (with its ids untouched).
 */
export function validateCitationList<T>(
  items: T[],
  getIds: (item: T) => string[],
  withIds: (item: T, validCitations: string[]) => T,
  validIds: Set<string>
): ListCitationValidationResult<T> {
  const valid: T[] = [];
  const dropped: T[] = [];

  for (const item of items) {
    const kept = getIds(item)
      .map((id) => id.trim())
      .filter((id) => validIds.has(id));
    if (kept.length > 0) {
      valid.push(withIds(item, kept));
    } else {
      dropped.push(item);
    }
  }

  return { valid, dropped };
}

/**
 * Seam 2 — GD11 citation enforcement for items that cite a single
 * `fhirResourceId`. Thin wrapper over {@link validateCitationList}: partitions
 * items by whether their (trimmed) `fhirResourceId` is present in the bundle,
 * returning kept items with the trimmed id and dropping the rest unchanged.
 *
 * Generic over any `{fhirResourceId}`-shaped item (not just `AgentFlag`) so
 * the same gate covers RiskOutput.flags, CareGapOutput.gaps, and
 * SdohOutput.barriers — they all cite a single resource, just with different
 * sibling fields (S3 B3).
 */
export function validateCitations<T extends { fhirResourceId: string }>(
  items: T[],
  validIds: Set<string>
): ListCitationValidationResult<T> {
  return validateCitationList(
    items,
    (item) => [item.fhirResourceId],
    (item, [trimmedId]) => ({ ...item, fhirResourceId: trimmedId }),
    validIds
  );
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
