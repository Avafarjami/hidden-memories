/**
 * Camera path for devices without WebXR AR (every browser on iPhone/iPad,
 * and desktop browsers).
 *
 * The rear camera is shown as a full-screen video; the Three.js canvas is
 * drawn on top with a transparent background. The phone's motion sensors
 * aim the virtual camera, and the floor is assumed to be a flat plane 1.4 m
 * below the phone. That gives a convincing "look down, tap, place" feel but
 * no real tracking: walking around will make the text drift. Desktop has
 * no sensors, so dragging with the pointer looks around instead.
 */
import * as THREE from 'three';

const EYE_HEIGHT = 1.4;     // metres from floor to phone
const MIN_DISTANCE = 0.35;  // ignore hits closer than this (aiming at feet)
const MAX_DISTANCE = 6;

const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
const hitPoint = new THREE.Vector3();
const centre = new THREE.Vector2(0, 0);

// Standard device-orientation to camera-quaternion conversion.
const zee = new THREE.Vector3(0, 0, 1);
const euler = new THREE.Euler();
const q0 = new THREE.Quaternion();
const q1 = new THREE.Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2); // -90° about X
const deg = THREE.MathUtils.degToRad;

export function isCameraAvailable() {
  return Boolean(navigator.mediaDevices?.getUserMedia);
}

/**
 * Must be called from a user gesture: iOS only grants motion-sensor access
 * from a tap, and a permission request made after an `await` may be refused.
 */
export async function requestMotionPermission() {
  const D = window.DeviceOrientationEvent;
  if (D && typeof D.requestPermission === 'function') {
    try { return (await D.requestPermission()) === 'granted'; } catch { return false; }
  }
  return typeof D !== 'undefined';
}

/**
 * @param {object} opts
 * @param {import('./scene.js')} opts.view
 * @param {HTMLVideoElement} opts.video
 * @param {boolean} opts.motionGranted   result of requestMotionPermission()
 * @param {(position: THREE.Vector3) => void} opts.onPlace
 * @param {() => void} opts.onEnd
 */
export async function startFallback({ view, video, motionGranted, onPlace, onEnd }) {
  const { renderer, scene, camera, reticle, area, orientArea } = view;

  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: false
  });
  video.srcObject = stream;
  video.hidden = false;
  // Do not let a slow or silent video element block the start: the stream
  // keeps rendering into it whenever frames do arrive.
  await Promise.race([
    video.play().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 1500))
  ]);

  camera.position.set(0, EYE_HEIGHT, 0);
  camera.rotation.set(0, 0, 0);

  let placing = true;
  let orientation = null;        // latest deviceorientation event
  let usingSensors = false;
  let yaw = 0, pitch = -0.55;    // pointer-look state for desktop

  function screenAngle() {
    const a = screen.orientation?.angle ?? window.orientation ?? 0;
    return deg(Number(a) || 0);
  }

  function onOrientation(e) {
    if (e.alpha === null || e.alpha === undefined) return;
    orientation = e;
    usingSensors = true;
  }
  if (motionGranted) window.addEventListener('deviceorientation', onOrientation, true);

  // Desktop / no sensors: drag to look, click (without dragging) to place.
  let dragging = false, moved = false, lastX = 0, lastY = 0;
  const canvas = renderer.domElement;
  function onPointerDown(e) { dragging = true; moved = false; lastX = e.clientX; lastY = e.clientY; }
  function onPointerMove(e) {
    if (!dragging || usingSensors) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
    yaw -= dx * 0.005;
    pitch = THREE.MathUtils.clamp(pitch - dy * 0.005, -1.4, 0.6);
    lastX = e.clientX; lastY = e.clientY;
  }
  function onPointerUp() {
    const wasClick = dragging && !moved;
    dragging = false;
    if (wasClick) place();
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  function place() {
    if (!placing || !reticle.visible) return;
    placing = false;
    area.position.copy(reticle.position);
    orientArea(camera.position);
    area.visible = true;
    reticle.visible = false;
    onPlace(area.position);
  }

  function updateCamera() {
    if (usingSensors && orientation) {
      const alpha = deg(orientation.alpha || 0);
      const beta = deg(orientation.beta || 0);
      const gamma = deg(orientation.gamma || 0);
      euler.set(beta, alpha, -gamma, 'YXZ');
      camera.quaternion.setFromEuler(euler);
      camera.quaternion.multiply(q1);
      camera.quaternion.multiply(q0.setFromAxisAngle(zee, -screenAngle()));
    } else {
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
    }
  }

  function updateReticle() {
    raycaster.setFromCamera(centre, camera);
    const hit = raycaster.ray.intersectPlane(FLOOR, hitPoint);
    const distance = hit ? camera.position.distanceTo(hitPoint) : Infinity;
    if (hit && distance >= MIN_DISTANCE && distance <= MAX_DISTANCE) {
      reticle.position.copy(hitPoint);
      reticle.rotation.set(0, camera.rotation.y, 0);
      reticle.visible = true;
    } else {
      reticle.visible = false;
    }
  }

  function onFrame() {
    updateCamera();
    if (placing) updateReticle();
    renderer.render(scene, camera);
  }
  renderer.setAnimationLoop(onFrame);

  let ended = false;
  function end() {
    if (ended) return;
    ended = true;
    renderer.setAnimationLoop(null);
    window.removeEventListener('deviceorientation', onOrientation, true);
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
    video.hidden = true;
    onEnd();
  }

  return { mode: 'camera', usingSensors: () => usingSensors, end };
}
