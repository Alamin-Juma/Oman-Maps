/**
 * The sync contract shared by every client (web, Unity) and the API.
 * The API rejects a request with more events than this; clients send in batches of at most this
 * many (findings register R4). One definition, so the two sides cannot drift apart.
 */
export const SYNC_MAX_EVENTS = 500;
