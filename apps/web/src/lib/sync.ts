/**
 * Send a learner's waiting events to the server in batches the server accepts
 * (findings register R4). The API rejects more than SYNC_MAX_EVENTS per request, so sending a
 * whole backlog in one request meant a child with a long offline stretch could never sync.
 *
 * Each batch is marked synced only after the server accepted it. If a batch fails, the batches
 * already sent stay sent and everything else stays waiting for the next try. Retrying is safe:
 * the server ignores events it already has (they come back as duplicates).
 */
import { SYNC_MAX_EVENTS, type AttemptEvent } from "@dunialab/mastery";
import type { EventQueue } from "./queue.js";

export interface SyncClient {
  sync(profileId: string, packId: string, events: AttemptEvent[]): Promise<{ accepted: number; duplicates: number }>;
}

export interface SyncOutcome {
  /** Events the server confirmed in this run. */
  sent: number;
  accepted: number;
  duplicates: number;
  /** Events of this learner still waiting after this run. */
  remaining: number;
  /** Set when a batch failed; the run stopped there. */
  error?: unknown;
}

export async function syncInBatches(
  queue: EventQueue,
  client: SyncClient,
  packId: string,
  profileId: string,
  batchSize: number = SYNC_MAX_EVENTS,
): Promise<SyncOutcome> {
  if (!(Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= SYNC_MAX_EVENTS)) {
    throw new RangeError(`batchSize must be a whole number from 1 to ${SYNC_MAX_EVENTS}`);
  }
  const outcome: SyncOutcome = { sent: 0, accepted: 0, duplicates: 0, remaining: 0 };
  const pending = queue.unsynced(packId, profileId);
  for (let i = 0; i < pending.length; i += batchSize) {
    const batch = pending.slice(i, i + batchSize);
    try {
      const r = await client.sync(profileId, packId, batch);
      queue.markSynced(batch.map((e) => e.eventId));
      outcome.sent += batch.length;
      outcome.accepted += r.accepted;
      outcome.duplicates += r.duplicates;
    } catch (error) {
      outcome.error = error;
      break;
    }
  }
  outcome.remaining = queue.unsynced(packId, profileId).length;
  return outcome;
}
