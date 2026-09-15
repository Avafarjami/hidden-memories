/**
 * App settings.
 *
 * API_BASE is the origin of the server that stores shared messages. Empty
 * means the same origin the app is served from, which is the portfolio
 * server at avafarjami.com/hidden-memories. Set an absolute origin (no
 * trailing slash) only when the app is hosted somewhere else.
 */
export const API_BASE = '';

/** How many of the most recent messages to fetch and show. */
export const MESSAGE_LIMIT = 50;

/** Maximum message length; the server enforces the same limit. */
export const MAX_MESSAGE_LENGTH = 200;
