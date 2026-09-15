/**
 * Startup and UI wiring.
 *
 * Picks the AR path the device can run (WebXR where it exists, the camera
 * fallback everywhere else), drives the small overlay UI, and keeps the
 * writing area in sync with the shared message list.
 */
import { createScene } from './scene.js';
import { isXrAvailable, startXr } from './xr-session.js';
import { isCameraAvailable, requestMotionPermission, startFallback } from './camera-fallback.js';
import { loadMessages, saveMessage } from './messages.js';
import { API_BASE, MAX_MESSAGE_LENGTH } from './config.js';

const els = {
  overlay: document.getElementById('overlay'),
  status: document.getElementById('status'),
  start: document.getElementById('start-btn'),
  exit: document.getElementById('exit-btn'),
  form: document.getElementById('input-row'),
  input: document.getElementById('msg-input'),
  send: document.getElementById('send-btn'),
  video: document.getElementById('camera-feed')
};
els.input.maxLength = MAX_MESSAGE_LENGTH;

const view = createScene();

let session = null;       // { mode, end }
let messages = [];
let xrOk = false;
let cameraOk = false;

function setStatus(text) { els.status.textContent = text; }

function countLabel(count, faded) {
  const m = count === 1 ? '1 message' : `${count} messages`;
  return faded ? `${m} · ${faded} faded` : m;
}

function storeLabel(source) {
  return source === 'api' ? 'shared with everyone' : 'saved on this device only';
}

async function detect() {
  xrOk = await isXrAvailable();
  cameraOk = isCameraAvailable();
  if (xrOk) {
    els.start.textContent = 'Start AR';
    setStatus('Press the button to start');
  } else if (cameraOk) {
    els.start.textContent = 'Start camera';
    setStatus(window.isSecureContext
      ? 'This browser has no WebXR, so camera mode will be used'
      : 'Camera mode needs HTTPS');
  } else {
    els.start.hidden = true;
    setStatus('This browser cannot access a camera.');
  }
}

function friendlyError(err) {
  switch (err?.name) {
    case 'NotAllowedError':
      return 'Camera access was denied. Allow the camera for this site in your browser settings and try again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No suitable camera was found on this device.';
    case 'NotReadableError':
      return 'The camera is in use by another app.';
    case 'SecurityError':
      return 'The camera only works over HTTPS.';
    default:
      return `Could not start: ${err?.message || err}`;
  }
}

async function start() {
  els.start.disabled = true;
  setStatus(xrOk ? 'Starting AR…' : 'Starting camera…');
  try {
    if (xrOk) {
      session = await startXr({
        view,
        overlayRoot: els.overlay,
        uiElements: [els.form, els.start, els.exit],
        onPlace: onPlaced,
        onEnd: onEnded
      });
      setStatus('Move the phone slowly, then tap the floor to start writing');
    } else {
      // Order matters on iOS: the sensor prompt must come straight from the tap.
      const motionGranted = await requestMotionPermission();
      session = await startFallback({ view, video: els.video, motionGranted, onPlace: onPlaced, onEnd: onEnded });
      setStatus(session.usingSensors() || motionGranted
        ? 'Point the phone at the floor, then tap to place'
        : 'Drag to look around, then click the floor to place');
    }
    els.start.hidden = true;
    els.exit.hidden = false;
  } catch (err) {
    console.error(err);
    setStatus(friendlyError(err));
  } finally {
    els.start.disabled = false;
  }
}

async function onPlaced() {
  els.form.hidden = false;
  setStatus('Loading messages…');
  const result = await loadMessages();
  messages = result.messages;
  const { faded } = view.showMessages(messages);
  if (result.error) console.warn('Falling back to local messages:', result.error);
  setStatus(messages.length
    ? `${countLabel(messages.length, faded)} · ${storeLabel(result.source)}`
    : `No messages yet. Write the first one ↑ (${storeLabel(result.source)})`);
  els.input.focus({ preventScroll: true });
}

async function onSubmit(event) {
  event.preventDefault();
  const text = els.input.value.trim();
  if (!text || els.send.disabled) return;
  els.send.disabled = true;
  setStatus('Saving…');
  try {
    const { message, source, error } = await saveMessage(text);
    els.input.value = '';
    messages = [...messages, message];
    const { faded } = view.showMessages(messages);
    if (error) console.warn('Saved locally because the server did not answer:', error);
    setStatus(`${countLabel(messages.length, faded)} · ${storeLabel(source)}`);
  } catch (err) {
    setStatus(err.message || 'Could not save the message.');
  } finally {
    els.send.disabled = false;
  }
}

function onEnded() {
  session = null;
  messages = [];
  view.reset();
  els.form.hidden = true;
  els.exit.hidden = true;
  els.start.hidden = false;
  els.input.value = '';
  setStatus('Press the button to start');
}

els.start.addEventListener('click', start);
els.exit.addEventListener('click', () => session?.end());
els.form.addEventListener('submit', onSubmit);
// Mobile keyboards send Enter as a key event; make it submit explicitly so
// the "send" key works even where implicit form submission does not fire.
els.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); els.form.requestSubmit(); }
});

// `?debug` exposes the scene for manual testing and screenshots from the console.
if (new URLSearchParams(location.search).has('debug')) window.hiddenMemories = { view };

console.info(`Shared messages API: ${API_BASE || location.origin}/api/memories (falls back to this browser if unreachable)`);
detect();
