import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamAnalysis, subscribeToEvents } from './client';

/** Builds a ReadableStream<Uint8Array> that emits the given string chunks in order. */
function sseStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

describe('streamAnalysis', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('caresync_token', 'header.payload.signature');
  });

  it('parses token, finding, and complete SSE events, including a frame split across chunks', async () => {
    const frame1 = 'event: token\ndata: {"agentId":"risk","text":"Risk "}\n\n';
    const frame2 = 'event: token\ndata: {"agentId":"risk","text":"is elevated."}\n\n';
    const frame3 =
      'event: finding\ndata: {"agentId":"risk","text":"HbA1c 8.9%","fhirResourceId":"Observation/hba1c-1"}\n\n';
    const frame4 =
      'event: complete\ndata: {"agentId":"risk","riskScore":87,"riskLevel":"high","readmissionProbability":0.42,"findingCount":1,"droppedCount":0}\n\n';

    // Split frame3 across two chunks to prove buffering works across `read()` calls.
    const splitPoint = Math.floor(frame3.length / 2);
    const chunks = [frame1, frame2, frame3.slice(0, splitPoint), frame3.slice(splitPoint), frame4];

    const body = sseStream(chunks);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(body));

    const onToken = vi.fn();
    const onFinding = vi.fn();
    const onComplete = vi.fn();

    await streamAnalysis('maria-1', { onToken, onFinding, onComplete });

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/patients/maria-1/analysis'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer header.payload.signature' }),
      })
    );

    expect(onToken).toHaveBeenNthCalledWith(1, 'risk', 'Risk ');
    expect(onToken).toHaveBeenNthCalledWith(2, 'risk', 'is elevated.');
    expect(onFinding).toHaveBeenCalledWith({
      agentId: 'risk',
      text: 'HbA1c 8.9%',
      fhirResourceId: 'Observation/hba1c-1',
    });
    expect(onComplete).toHaveBeenCalledWith({
      agentId: 'risk',
      riskScore: 87,
      riskLevel: 'high',
      readmissionProbability: 0.42,
      findingCount: 1,
      droppedCount: 0,
    });

    // Order: token, token, finding, complete
    const tokenCallOrder = onToken.mock.invocationCallOrder;
    const findingCallOrder = onFinding.mock.invocationCallOrder[0];
    const completeCallOrder = onComplete.mock.invocationCallOrder[0];
    expect(tokenCallOrder[0]).toBeLessThan(tokenCallOrder[1]);
    expect(tokenCallOrder[1]).toBeLessThan(findingCallOrder);
    expect(findingCallOrder).toBeLessThan(completeCallOrder);
  });

  it('routes finding/complete events from all four agents to the right agentId, unscrambled', async () => {
    const frames = [
      'event: finding\ndata: {"agentId":"risk","text":"HbA1c 8.9%","fhirResourceId":"Observation/hba1c-1"}\n\n',
      'event: finding\ndata: {"agentId":"careGap","gapType":"screening","description":"Overdue mammogram","urgency":"medium","fhirResourceId":"ServiceRequest/mammo-1"}\n\n',
      'event: finding\ndata: {"agentId":"sdoh","domain":"housing","finding":"Unstable housing","severity":"high","fhirResourceId":"Observation/sdoh-1"}\n\n',
      'event: complete\ndata: {"agentId":"risk","riskScore":87,"riskLevel":"high","readmissionProbability":0.42,"findingCount":1,"droppedCount":0}\n\n',
      'event: complete\ndata: {"agentId":"careGap","findingCount":1,"droppedCount":0}\n\n',
      'event: complete\ndata: {"agentId":"sdoh","findingCount":1,"droppedCount":0,"referralsNeeded":["housing-support"]}\n\n',
      'event: complete\ndata: {"agentId":"actionPlanner","findingCount":0,"droppedCount":0}\n\n',
    ];

    const body = sseStream(frames);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(body));

    const onFinding = vi.fn();
    const onComplete = vi.fn();

    await streamAnalysis('maria-1', { onFinding, onComplete });

    expect(onFinding).toHaveBeenCalledTimes(3);
    expect(onFinding).toHaveBeenNthCalledWith(1, expect.objectContaining({ agentId: 'risk' }));
    expect(onFinding).toHaveBeenNthCalledWith(2, expect.objectContaining({ agentId: 'careGap' }));
    expect(onFinding).toHaveBeenNthCalledWith(3, expect.objectContaining({ agentId: 'sdoh' }));

    expect(onComplete).toHaveBeenCalledTimes(4);
    expect(onComplete).toHaveBeenNthCalledWith(1, expect.objectContaining({ agentId: 'risk', riskScore: 87 }));
    expect(onComplete).toHaveBeenNthCalledWith(2, expect.objectContaining({ agentId: 'careGap' }));
    expect(onComplete).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ agentId: 'sdoh', referralsNeeded: ['housing-support'] })
    );
    expect(onComplete).toHaveBeenNthCalledWith(4, expect.objectContaining({ agentId: 'actionPlanner' }));
  });

  it('attributes interleaved token events to their own agentId, not whichever agent streamed last', async () => {
    // Risk and Care Gap tokens interleave, as they genuinely do when agents run
    // concurrently (see apps/api's orchestrator interleaving test). onToken must
    // carry the agentId from its own frame — never inferred from a prior frame.
    const frames = [
      'event: token\ndata: {"agentId":"risk","text":"Risk tok1"}\n\n',
      'event: token\ndata: {"agentId":"careGap","text":"CareGap tok1"}\n\n',
      'event: token\ndata: {"agentId":"risk","text":"Risk tok2"}\n\n',
      'event: token\ndata: {"agentId":"careGap","text":"CareGap tok2"}\n\n',
    ];

    const body = sseStream(frames);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(body));

    const onToken = vi.fn();

    await streamAnalysis('maria-1', { onToken });

    expect(onToken).toHaveBeenCalledTimes(4);
    expect(onToken).toHaveBeenNthCalledWith(1, 'risk', 'Risk tok1');
    expect(onToken).toHaveBeenNthCalledWith(2, 'careGap', 'CareGap tok1');
    expect(onToken).toHaveBeenNthCalledWith(3, 'risk', 'Risk tok2');
    expect(onToken).toHaveBeenNthCalledWith(4, 'careGap', 'CareGap tok2');
  });

  it('dispatches a task event to onTask with the full payload', async () => {
    const frame =
      'event: task\ndata: {"agentId":"actionPlanner","id":"task-1","reference":"Task/task-1","title":"Schedule follow-up","description":"Call patient","priority":"high","assignTo":"nurse-1","dueInDays":3,"fhirResources":["Observation/hba1c-1"]}\n\n';

    const body = sseStream([frame]);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(body));

    const onTask = vi.fn();

    await streamAnalysis('maria-1', { onTask });

    expect(onTask).toHaveBeenCalledWith({
      agentId: 'actionPlanner',
      id: 'task-1',
      reference: 'Task/task-1',
      title: 'Schedule follow-up',
      description: 'Call patient',
      priority: 'high',
      assignTo: 'nurse-1',
      dueInDays: 3,
      fhirResources: ['Observation/hba1c-1'],
    });
  });

  it('dispatches a done event to onDone with no arguments', async () => {
    const frame = 'event: done\ndata: {}\n\n';

    const body = sseStream([frame]);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(body));

    const onDone = vi.fn();

    await streamAnalysis('maria-1', { onDone });

    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith();
  });

  it('requests the plain analysis URL (no ?live=1) by default', async () => {
    const body = sseStream(['event: done\ndata: {}\n\n']);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(body));

    await streamAnalysis('maria-1', {});

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain('/api/patients/maria-1/analysis');
    expect(url).not.toContain('live=1');
  });

  it('appends ?live=1 when opts.live is true', async () => {
    const body = sseStream(['event: done\ndata: {}\n\n']);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(body));

    await streamAnalysis('maria-1', {}, { live: true });

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain('/api/patients/maria-1/analysis?live=1');
  });

  it('does not append ?live=1 when opts.live is false', async () => {
    const body = sseStream(['event: done\ndata: {}\n\n']);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(body));

    await streamAnalysis('maria-1', {}, { live: false });

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).not.toContain('live=1');
  });
});

describe('subscribeToEvents', () => {
  let unsubscribe: (() => void) | undefined;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('caresync_token', 'header.payload.signature');
  });

  afterEach(() => {
    unsubscribe?.();
    unsubscribe = undefined;
  });

  it('connects to /api/events with a bearer token', async () => {
    const body = sseStream(['event: connected\ndata: {}\n\n']);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(body));

    unsubscribe = subscribeToEvents({});
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/events'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer header.payload.signature' }) })
    );
  });

  it('dispatches an assignment event to onAssignment with the parsed task', async () => {
    const body = sseStream([
      'event: connected\ndata: {}\n\n',
      'event: assignment\ndata: {"id":"task-1","title":"Med rec follow-up","priority":"high","status":"Open","ownerId":"coordinator-1"}\n\n',
    ]);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(body));

    const onAssignment = vi.fn();
    unsubscribe = subscribeToEvents({ onAssignment });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'task-1', title: 'Med rec follow-up', ownerId: 'coordinator-1' })
    );
  });

  it('ignores non-assignment events (e.g. the initial "connected" event)', async () => {
    const body = sseStream(['event: connected\ndata: {}\n\n']);
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(body));

    const onAssignment = vi.fn();
    unsubscribe = subscribeToEvents({ onAssignment });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onAssignment).not.toHaveBeenCalled();
  });
});
