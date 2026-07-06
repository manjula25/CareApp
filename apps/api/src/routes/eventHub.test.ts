import { Response } from 'express';
import { createEventHub } from './eventHub';

// A minimal stand-in for express.Response that only exercises the surface
// eventHub actually touches (`.write`) — no real HTTP connection needed to
// test the hub's own register/unregister/publish bookkeeping.
function fakeRes(): Response & { chunks: string[] } {
  const chunks: string[] = [];
  return { chunks, write: (chunk: string) => (chunks.push(chunk), true) } as unknown as Response & { chunks: string[] };
}

describe('EventHub', () => {
  it('publishes an event only to the target user\'s registered connection', () => {
    const hub = createEventHub();
    const coordinatorRes = fakeRes();
    const otherRes = fakeRes();
    hub.register('coordinator-1', coordinatorRes);
    hub.register('other-user', otherRes);

    hub.publish('coordinator-1', 'assignment', { taskId: 'task-1' });

    expect(coordinatorRes.chunks.join('')).toContain('event: assignment');
    expect(coordinatorRes.chunks.join('')).toContain('"taskId":"task-1"');
    expect(otherRes.chunks).toHaveLength(0);
  });

  it('delivers to every connection registered for the same user (e.g. two open tabs)', () => {
    const hub = createEventHub();
    const tab1 = fakeRes();
    const tab2 = fakeRes();
    hub.register('coordinator-1', tab1);
    hub.register('coordinator-1', tab2);

    hub.publish('coordinator-1', 'assignment', { taskId: 'task-1' });

    expect(tab1.chunks).toHaveLength(1);
    expect(tab2.chunks).toHaveLength(1);
  });

  it('stops delivering to a connection after it is unregistered', () => {
    const hub = createEventHub();
    const res = fakeRes();
    hub.register('coordinator-1', res);
    hub.unregister('coordinator-1', res);

    hub.publish('coordinator-1', 'assignment', { taskId: 'task-1' });

    expect(res.chunks).toHaveLength(0);
  });

  it('publishing to a user with no registered connections is a no-op (does not throw)', () => {
    const hub = createEventHub();
    expect(() => hub.publish('nobody-here', 'assignment', { taskId: 'task-1' })).not.toThrow();
  });

  it('publishAll delivers an event to every connection across every registered user (S7 B3 broadcast)', () => {
    const hub = createEventHub();
    const coordinatorRes = fakeRes();
    const otherRes = fakeRes();
    hub.register('coordinator-1', coordinatorRes);
    hub.register('other-user', otherRes);

    hub.publishAll('task-updated', { id: 'task-1', status: 'Done' });

    expect(coordinatorRes.chunks.join('')).toContain('event: task-updated');
    expect(coordinatorRes.chunks.join('')).toContain('"status":"Done"');
    expect(otherRes.chunks.join('')).toContain('event: task-updated');
  });

  it('publishAll delivers to every connection registered for the same user (e.g. two open tabs)', () => {
    const hub = createEventHub();
    const tab1 = fakeRes();
    const tab2 = fakeRes();
    hub.register('coordinator-1', tab1);
    hub.register('coordinator-1', tab2);

    hub.publishAll('task-updated', { id: 'task-1' });

    expect(tab1.chunks).toHaveLength(1);
    expect(tab2.chunks).toHaveLength(1);
  });

  it('publishAll is a no-op (does not throw) when no connections are registered at all', () => {
    const hub = createEventHub();
    expect(() => hub.publishAll('task-updated', { id: 'task-1' })).not.toThrow();
  });
});
