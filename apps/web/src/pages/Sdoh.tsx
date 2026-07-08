import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { getSdohResources, postSdohReferral, type CommunityResource } from '../api/client';
import { DemoFallbackBadge } from '../components/DemoFallbackBadge';
import { MOCK_SDOH_RESOURCES } from '../lib/demoFallbacks';

/**
 * S11 A1 — M05 SDOH resource directory + referral, rendered against
 * `reference-materials/caresync-sdoh-mobile.html`'s content region (category
 * tabs / resource cards) — this component owns only that content; the
 * mockup's phone-shell chrome (status bar, nav header, bottom tab bar, FAB)
 * is out of scope per the S11 A1 plan (this app's real chrome is
 * `AppShell.tsx`, same convention as `Governance.tsx`/`Population.tsx`).
 *
 * Patient-scoped like every other per-patient screen (`PatientDetail`,
 * `TaskDetail`) — routed as `/patients/:id/sdoh`, matching the `:id` param
 * name those siblings already use (see `App.tsx`'s route table) rather than
 * inventing a new `:patientId` name.
 *
 * Ponytail scope (S11 A1): a referral creates exactly one FHIR
 * ServiceRequest — no referral-status tracking, no "active referrals" bottom
 * sheet, and no call-integration (the mockup's Call button and bottom sheet)
 * are intentionally out of scope; those are mockup flourishes this
 * partial-depth demo screen skips.
 */

const CATEGORY_TABS: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'transportation', label: 'Transportation' },
  { id: 'food', label: 'Food' },
  { id: 'housing', label: 'Housing' },
  { id: 'mental_health', label: 'Mental Health' },
  { id: 'utilities', label: 'Utilities' },
];

const CATEGORY_LABEL: Record<CommunityResource['category'], string> = {
  transportation: 'Transportation',
  food: 'Food',
  housing: 'Housing',
  mental_health: 'Mental Health',
  utilities: 'Utilities',
};

function ResourceCard({ resource, patientId }: { resource: CommunityResource; patientId: string }) {
  const [referred, setReferred] = useState(false);

  const referMutation = useMutation({
    mutationFn: () => postSdohReferral(patientId, resource.id),
    onSuccess: () => setReferred(true),
  });

  return (
    <div
      className="bg-surface border border-border rounded-card px-3.5 py-2.5"
      data-testid={`sdoh-resource-card-${resource.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-body font-bold text-text leading-tight">{resource.name}</span>
        <span className="text-xs font-bold uppercase tracking-wide rounded-pill px-2.5 py-0.5 bg-cyan-dim border border-cyan text-cyan whitespace-nowrap">
          {CATEGORY_LABEL[resource.category]}
        </span>
      </div>
      <p className="text-label text-text-muted mt-1.5">{resource.description}</p>
      <div className="flex items-center gap-2 mt-1.5 text-xs">
        <span className="text-emerald font-semibold">{resource.coverage}</span>
      </div>
      <div className="flex items-center gap-2 mt-2.5">
        <button
          type="button"
          onClick={() => referMutation.mutate()}
          disabled={referMutation.isPending}
          data-testid={`sdoh-refer-button-${resource.id}`}
          className="flex-1 h-8 rounded-md bg-cyan text-bg text-xs font-bold disabled:opacity-60 disabled:cursor-default"
        >
          {referMutation.isPending ? 'Referring…' : 'Refer Patient'}
        </button>
        {resource.phone && (
          <a
            href={`tel:${resource.phone}`}
            className="h-8 px-3.5 rounded-md bg-transparent border border-cyan text-cyan text-xs font-semibold flex items-center"
          >
            Call
          </a>
        )}
      </div>
      {referMutation.isError && (
        <p className="text-xs text-red mt-1.5">Could not create the referral. Please try again.</p>
      )}
      {referred && (
        <p className="font-mono text-xs text-text-dim mt-2">✓ Referral sent — ServiceRequest created</p>
      )}
    </div>
  );
}

export function Sdoh() {
  const { id: patientId } = useParams<{ id: string }>();
  const [category, setCategory] = useState('all');

  // Real implementation is primary. `MOCK_SDOH_RESOURCES` is a SAFETY NET only
  // — kicks in when the query has errored AND we have no real data. The
  // `DemoFallbackBadge` makes the fallback visible.
  const { data, isLoading, isError } = useQuery({
    queryKey: ['sdoh-resources'],
    queryFn: () => getSdohResources(),
    retry: 1,
  });

  const isUsingFallback = isError;
  const resources = isError ? MOCK_SDOH_RESOURCES : data;
  const filtered = (resources ?? []).filter((r) => category === 'all' || r.category === category);

  return (
    <div className="px-6 py-6">
      {patientId && (
        <Link to={`/patients/${patientId}`} className="text-label text-cyan hover:underline">
          ← Back to Patient
        </Link>
      )}

      <div className="flex items-center gap-3 mt-2 mb-4">
        <h1 className="text-section text-text font-bold">SDOH Resources</h1>
        {isUsingFallback && <DemoFallbackBadge />}
      </div>

      <div className="flex gap-1 border-b border-border mb-4 overflow-x-auto" data-testid="sdoh-category-tabs">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setCategory(tab.id)}
            data-testid={`sdoh-category-tab-${tab.id}`}
            className={`text-label font-semibold px-3 py-2 border-b-2 whitespace-nowrap transition-colors ${
              category === tab.id ? 'text-cyan border-cyan' : 'text-text-muted border-transparent hover:text-text'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {isLoading && <p className="text-body text-text-muted">Loading resources…</p>}
      {isError && <p className="text-body text-red">Could not load the resource directory.</p>}

      {!isLoading && !isError && (
        <div className="flex flex-col gap-2.5">
          {filtered.length === 0 && <p className="text-body text-text-muted">No resources in this category.</p>}
          {patientId &&
            filtered.map((resource) => <ResourceCard key={resource.id} resource={resource} patientId={patientId} />)}
        </div>
      )}
    </div>
  );
}
