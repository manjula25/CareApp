import { describe, it, expect } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AgentGraph } from './AgentGraph';
import { initialAnalysisGraphState, type AnalysisGraphState } from '../lib/analysisGraph';

/**
 * Smoke coverage only — canvas painting itself isn't meaningfully
 * unit-testable under jsdom (no real `CanvasRenderingContext2D`; jsdom's
 * `getContext('2d')` returns `null` unless the `canvas` npm package is
 * installed, which this repo doesn't have). This test instead covers the
 * concerns the ponytail note calls out: it mounts/unmounts without throwing
 * (SSR-guard + cleanup), across every `GraphState`, without a real canvas
 * context — proving the null-ctx guard actually works rather than assuming it.
 */
const RUNNING: AnalysisGraphState = {
  graphState: 'analyzing',
  nodes: { risk: 'complete', careGap: 'analyzing', sdoh: 'pending', actionPlanner: 'pending' },
};

const COMPLETE: AnalysisGraphState = {
  graphState: 'complete',
  nodes: { risk: 'complete', careGap: 'complete', sdoh: 'complete', actionPlanner: 'complete' },
};

describe('AgentGraph', () => {
  it('mounts and unmounts cleanly for the idle state, with no real canvas context available (jsdom)', () => {
    const { unmount } = render(<AgentGraph state={initialAnalysisGraphState} />);
    expect(() => unmount()).not.toThrow();
  });

  it('mounts and unmounts cleanly mid-run, with mixed per-node statuses', () => {
    const { unmount } = render(<AgentGraph state={RUNNING} />);
    expect(() => unmount()).not.toThrow();
  });

  it('mounts and unmounts cleanly once complete', () => {
    const { unmount } = render(<AgentGraph state={COMPLETE} />);
    expect(() => unmount()).not.toThrow();
  });

  it('renders a canvas element', () => {
    const { container } = render(<AgentGraph state={initialAnalysisGraphState} />);
    expect(container.querySelector('canvas')).toBeInTheDocument();
    cleanup();
  });
});
