import { Response } from 'express';
import { writeSseEvent } from './analysis';

/**
 * S6 A3 — in-process SSE relay hub: a `Map<userId, Response[]>` of open
 * `/api/events` connections, fanned out to by the subscription webhook.
 * No external broker (single API process in this POC, per the plan's
 * ponytail pass) — state (and any open connections) is lost on restart;
 * clients reconnect and re-register.
 */
export interface EventHub {
  register(userId: string, res: Response): void;
  unregister(userId: string, res: Response): void;
  publish(userId: string, event: string, data: unknown): void;
  /**
   * S7 B3 — broadcasts to every open connection across every registered
   * user (unlike `publish`, which is scoped to one user's connections).
   * Used for cross-surface sync events (e.g. `task-updated`) that every
   * connected client should see, not just a task's owner.
   */
  publishAll(event: string, data: unknown): void;
}

export function createEventHub(): EventHub {
  const connections = new Map<string, Response[]>();

  return {
    register(userId, res) {
      const existing = connections.get(userId);
      if (existing) {
        existing.push(res);
      } else {
        connections.set(userId, [res]);
      }
    },

    unregister(userId, res) {
      const existing = connections.get(userId);
      if (!existing) return;
      const remaining = existing.filter((r) => r !== res);
      if (remaining.length > 0) {
        connections.set(userId, remaining);
      } else {
        connections.delete(userId);
      }
    },

    publish(userId, event, data) {
      for (const res of connections.get(userId) ?? []) {
        writeSseEvent(res, event, data);
      }
    },

    publishAll(event, data) {
      for (const conns of connections.values()) {
        for (const res of conns) {
          writeSseEvent(res, event, data);
        }
      }
    },
  };
}
