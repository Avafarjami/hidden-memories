/**
 * Three.js scene shared by both AR paths.
 *
 * Owns the renderer, the reticle shown while aiming at the floor, and the
 * writing area that messages are laid out on. Text is drawn straight onto
 * the floor: there is no plate or outline, only the messages themselves.
 * Neither AR path knows how messages are drawn; they only move the reticle
 * and the area.
 */
import * as THREE from 'three';

// The writing area, in metres. Width runs left-right in front of the
// viewer, length runs away from them. Make AREA_LENGTH 2 or 3 for a strip
// people have to walk along to read.
export const AREA_WIDTH = 1.0;
export const AREA_LENGTH = 2.0;
const AREA_PADDING = 0.02;
const MESSAGE_GAP = 0.012;

// When the area is full, the messages already on it fade to DIM_OPACITY and
// the next messages start again from the far edge on top of them. DIM_PAGES
// is how many earlier, faded pages stay visible under the current one.
export const DIM_OPACITY = 0.3;
export const DIM_PAGES = 1;

// Text is rasterised to a canvas; these are canvas pixels, not metres.
const CANVAS_WIDTH = 1024;
const FONT_SIZE = 52;
const LINE_HEIGHT = 64;
const TEXT_MAX_WIDTH = 920;
const TEXT_PADDING = 16;
// Plain bold Arial, as in the first version of the app: simple black text
// straight on the ground.
const FONT = `bold ${FONT_SIZE}px Arial, Helvetica, sans-serif`;
// Width of one line of text on the floor, in metres. The same 0.9 m as the
// first version, which is the size that looked right on the pavement.
const TEXT_WIDTH = 0.9;

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

  /** The writing area. Local -Z is "away from the viewer". */
  const area = new THREE.Group();
  area.visible = false;
  scene.add(area);

  /** Text meshes currently on the floor, so they can be disposed later. */
  const drawn = [];

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  }
  window.addEventListener('resize', resize);

  function clearMessages() {
    for (const mesh of drawn) {
      area.remove(mesh);
      disposeMesh(mesh);
    }
    drawn.length = 0;
  }

  /**
   * Turns the area so its length runs away from `viewerPosition`: the
   * viewer stands at the near edge and reads (or walks) into it.
   */
  function orientArea(viewerPosition) {
    area.rotation.set(
      0,
      Math.atan2(viewerPosition.x - area.position.x, viewerPosition.z - area.position.z),
      0
    );
  }

  /**
   * Lays messages out oldest-to-newest from the far edge toward the viewer.
   * When they overflow the area, they are split into pages; the newest page
   * is drawn at full opacity and up to DIM_PAGES earlier pages underneath
   * it, faded, on the same floor.
   *
   * @returns {{ shown: number, faded: number, pages: number }}
   */
  function showMessages(messages) {
    clearMessages();
    const usableLength = AREA_LENGTH - AREA_PADDING * 2;

    const pages = [[]];
    let used = 0;
    for (const m of messages) {
      const built = makeTextMesh(m.text, renderer);
      const page = pages[pages.length - 1];
      const needed = built.height + (page.length ? MESSAGE_GAP : 0);
      if (page.length && used + needed > usableLength) {
        pages.push([built]);
        used = built.height;
      } else {
        page.push(built);
        used += needed;
      }
    }

    const keep = pages.slice(-(DIM_PAGES + 1));
    for (const page of pages.slice(0, -(DIM_PAGES + 1))) {
      for (const { mesh } of page) disposeMesh(mesh);
    }

    let shown = 0;
    let faded = 0;
    keep.forEach((page, index) => {
      const isCurrent = index === keep.length - 1;
      const opacity = isCurrent ? 1 : DIM_OPACITY;
      let z = -usableLength / 2;
      for (const { mesh, height } of page) {
        // A hair above the floor, each page a hair above the last, so the
        // overlapping planes never fight over the same depth.
        mesh.position.set(0, 0.003 + index * 0.002, z + height / 2);
        mesh.material.opacity = opacity;
        mesh.renderOrder = index;
        area.add(mesh);
        drawn.push(mesh);
        z += height + MESSAGE_GAP;
        shown++;
        if (!isCurrent) faded++;
      }
    });

    return { shown, faded, pages: pages.length };
  }

  /** Puts the scene back to its pre-session state. */
  function reset() {
    clearMessages();
    area.visible = false;
    reticle.visible = false;
    // The animation loop has stopped, so wipe the last frame by hand or the
    // text lingers on screen behind the start button.
    renderer.clear();
  }

  return { scene, camera, renderer, reticle, area, orientArea, showMessages, clearMessages, reset, resize };
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
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#000000';
  lines.forEach((line, i) => ctx.fillText(line, canvas.width / 2, TEXT_PADDING + i * LINE_HEIGHT));

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  const width = Math.min(TEXT_WIDTH, AREA_WIDTH - AREA_PADDING * 2);
  const height = width * (canvas.height / canvas.width);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide, depthWrite: false })
  );
  mesh.rotation.x = -Math.PI / 2;
  return { mesh, height };
}
