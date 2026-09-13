/**
 * App settings.
 *
 * API_BASE is the origin of the server that stores shared messages (the
 * portfolio server, which exposes GET/POST /api/memories). Leave it empty to
 * keep messages only in this browser's localStorage. No trailing slash.
 */
export const API_BASE = '';

/** How many of the most recent messages to fetch and show. */
export const MESSAGE_LIMIT = 50;

/** Maximum message length; the server enforces the same limit. */
export const MAX_MESSAGE_LENGTH = 200;
