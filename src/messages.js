/**
 * Message storage.
 *
 * Talks to the shared API (same origin, or API_BASE) and falls back to
 * localStorage when it does not answer, so the app keeps working offline or
 * on a plain static server. Every function reports which store answered so
 * the UI can say "saved on this device only" when that is the case.
 */
import { API_BASE, MESSAGE_LIMIT, MAX_MESSAGE_LENGTH } from './config.js';

const LOCAL_KEY = 'hidden-memories.messages';
const REQUEST_TIMEOUT_MS = 8000;

function readLocal() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function writeLocal(list) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list.slice(-MESSAGE_LIMIT)));
  } catch {
    /* storage unavailable (private mode, quota); nothing to do */
  }
}

async function request(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(API_BASE + path, { ...options, signal: controller.signal });
    let body = null;
    try { body = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok) {
      const error = new Error(body?.error || `Request failed (${res.status})`);
      error.status = res.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

/** Normalises whatever came back so the scene never sees a malformed entry. */
function clean(entry) {
  return {
    id: entry.id ?? null,
    text: String(entry.text ?? '').slice(0, MAX_MESSAGE_LENGTH),
    createdAt: Number(entry.createdAt ?? entry.created_at ?? Date.now())
  };
}

/** @returns {Promise<{ messages: Array, source: 'api' | 'local', error?: Error }>} */
export async function loadMessages() {
  try {
    const body = await request('/api/memories');
    const messages = (body?.memories ?? []).map(clean);
    return { messages, source: 'api' };
  } catch (error) {
    return { messages: readLocal().map(clean), source: 'local', error };
  }
}

/** @returns {Promise<{ message: object, source: 'api' | 'local', error?: Error }>} */
export async function saveMessage(text) {
  const trimmed = text.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!trimmed) throw new Error('Write something first.');

  try {
    const body = await request('/api/memories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: trimmed })
    });
    return { message: clean(body.memory), source: 'api' };
  } catch (error) {
    // A rejection the server made on purpose (too long, too fast) should be
    // shown, not silently downgraded to a local save.
    if (error.status === 400 || error.status === 429 || error.status === 403) throw error;
    const message = storeLocally(trimmed);
    return { message, source: 'local', error };
  }
}

function storeLocally(text) {
  const message = { id: `local-${Date.now()}`, text, createdAt: Date.now() };
  writeLocal([...readLocal(), message]);
  return message;
}
