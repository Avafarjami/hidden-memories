/**
 * Three.js scene shared by both AR paths.
 *
 * Owns the renderer, the reticle shown while aiming at the floor, and the
 * floor square that messages are laid out on. Neither AR path knows how
 * messages are drawn; they only move the reticle and the square.
 */
import * as THREE from 'three';

export const SQUARE_SIZE = 0.9; // metres, side length of the floor square
const SQUARE_PADDING = 0.03;
const MESSAGE_GAP = 0.012;

// Text is rasterised to a canvas; these are canvas pixels, not metres.
const CANVAS_WIDTH = 1024;
const FONT_SIZE = 52;
const LINE_HEIGHT = 64;
const TEXT_MAX_WIDTH = 920;
const TEXT_PADDING = 16;
const FONT = `bold ${FONT_SIZE}px system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;

export function createScene() {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.01, 50);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.xr.enabled = true;
  renderer.domElement.id = 'scene';
  document.body.appendChild(renderer.domElement);

  const reticle = makeReticle();
  scene.add(reticle);

  const square = new THREE.Group();
  square.visible = false;
  square.add(makeSquareOutline());
  scene.add(square);

  /** Messages currently drawn on the square, so they can be disposed later. */
  const textMeshes = [];

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }
  window.addEventListener('resize', resize);

  function clearMessages() {
    for (const mesh of textMeshes) {
      square.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.map?.dispose();
      mesh.material.dispose();
    }
    textMeshes.length = 0;
  }

  /**
   * Draws messages oldest-to-newest from the far edge of the square toward
   * the viewer. When they do not all fit, the oldest are dropped so the
   * newest message is always visible.
   */
  function showMessages(messages) {
    clearMessages();
    const usable = SQUARE_SIZE - SQUARE_PADDING * 2;
    const built = messages.map((m) => makeTextMesh(m.text, renderer));

    // Walk backwards from the newest, keeping as many as fit.
    let total = 0;
    let firstIndex = built.length;
    for (let i = built.length - 1; i >= 0; i--) {
      const h = built[i].height + (total > 0 ? MESSAGE_GAP : 0);
      if (total + h > usable) break;
      total += h;
      firstIndex = i;
    }
    for (let i = 0; i < firstIndex; i++) disposeMesh(built[i].mesh);

    let z = -usable / 2;
    for (let i = firstIndex; i < built.length; i++) {
      const { mesh, height } = built[i];
      mesh.position.set(0, 0.004, z + height / 2);
      square.add(mesh);
      textMeshes.push(mesh);
      z += height + MESSAGE_GAP;
    }
    return built.length - firstIndex;
  }

  /** Puts the scene back to its pre-session state. */
  function reset() {
    clearMessages();
    square.visible = false;
    reticle.visible = false;
    // The animation loop has stopped, so wipe the last frame by hand or the
    // square lingers on screen behind the start button.
    renderer.clear();
  }

  return { scene, camera, renderer, reticle, square, showMessages, clearMessages, reset, resize };
}

function makeReticle() {
  const group = new THREE.Group();
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthTest: false
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.08, 0.1, 40), ringMat);
  const dot = new THREE.Mesh(
    new THREE.CircleGeometry(0.015, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
  );
  ring.rotation.x = -Math.PI / 2;
  dot.rotation.x = -Math.PI / 2;
  group.add(ring, dot);
  group.visible = false;
  return group;
}

/** A faint white plate and outline so the square reads on any floor. */
function makeSquareOutline() {
  const group = new THREE.Group();
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(SQUARE_SIZE, SQUARE_SIZE),
    new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false
    })
  );
  plate.rotation.x = -Math.PI / 2;
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(SQUARE_SIZE, SQUARE_SIZE)),
    new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
  );
  edges.rotation.x = -Math.PI / 2;
  edges.position.y = 0.002;
  group.add(plate, edges);
  return group;
}

function disposeMesh(mesh) {
  mesh.geometry.dispose();
  mesh.material.map?.dispose();
  mesh.material.dispose();
}

/** Word-wraps text; a single word wider than the line is broken by character. */
function wrapText(ctx, text) {
  const lines = [];
  let current = '';
  const push = () => { if (current) lines.push(current); current = ''; };

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= TEXT_MAX_WIDTH) { current = candidate; continue; }
    push();
    if (ctx.measureText(word).width <= TEXT_MAX_WIDTH) { current = word; continue; }
    for (const ch of word) {
      if (ctx.measureText(current + ch).width > TEXT_MAX_WIDTH) push();
      current += ch;
    }
  }
  push();
  return lines.length ? lines : [''];
}

/** @returns {{ mesh: THREE.Mesh, height: number }} height is in metres */
function makeTextMesh(text, renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_WIDTH;
  const ctx = canvas.getContext('2d');
  ctx.font = FONT;
  const lines = wrapText(ctx, text);

  canvas.height = lines.length * LINE_HEIGHT + TEXT_PADDING * 2;
  ctx.font = FONT; // resizing the canvas resets its state
  ctx.fillStyle = '#111111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, TEXT_PADDING + i * LINE_HEIGHT));

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const width = SQUARE_SIZE - SQUARE_PADDING * 2;
  const height = width * (canvas.height / canvas.width);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  return { mesh, height };
}
