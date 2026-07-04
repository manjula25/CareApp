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
    const frame1 = 'event: token\ndata: {"text":"Risk "}\n\n';
    const frame2 = 'event: token\ndata: {"text":"is elevated."}\n\n';
    const frame3 =
      'event: finding\ndata: {"text":"HbA1c 8.9%","fhirResourceId":"Observation/hba1c-1"}\n\n';
    const frame4 =
      'event: complete\ndata: {"riskScore":87,"riskLevel":"high","readmissionProbability":0.42,"findingCount":1,"droppedCount":0}\n\n';

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
    expect(onFinding).toHaveBeenCalledWith({ text: 'HbA1c 8.9%', fhirResourceId: 'Observation/hba1c-1' });
    expect(onComplete).toHaveBeenCalledWith({
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
});
