import { describe, it, expect, vi, beforeEach } from 'vitest';
import { streamAnalysis } from './client';

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

    expect(onToken).toHaveBeenNthCalledWith(1, 'Risk ');
    expect(onToken).toHaveBeenNthCalledWith(2, 'is elevated.');
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
});
