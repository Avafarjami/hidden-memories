/**
 * WebXR path (Android Chrome and any browser with immersive-ar).
 *
 * Real floor detection via hit-test, an anchor so the text stays put while
 * the phone moves, and the page's own DOM as the overlay so the same UI works
 * in both AR modes.
 */
import * as THREE from 'three';

const poseMatrix = new THREE.Matrix4();
const viewerPosition = new THREE.Vector3();

export async function isXrAvailable() {
  if (!navigator.xr?.isSessionSupported) return false;
  try { return await navigator.xr.isSessionSupported('immersive-ar'); } catch { return false; }
}

/**
 * Prefers 'local-floor' (origin already at floor height) but falls back to
 * plain 'local', which every runtime that grants a session supports. Hit
 * testing works fine either way: the hit-test pose comes back in whichever
 * space is passed to getPose, floor height and all.
 */
async function requestLocalSpace(session) {
  try {
    return await session.requestReferenceSpace('local-floor');
  } catch {
    return await session.requestReferenceSpace('local');
  }
}

/**
 * @param {object} opts
 * @param {import('./scene.js')} opts.view      result of createScene()
 * @param {HTMLElement} opts.overlayRoot        DOM overlay root
 * @param {HTMLElement[]} opts.uiElements       taps on these must not place the area
 * @param {(position: THREE.Vector3) => void} opts.onPlace
 * @param {() => void} opts.onEnd
 */
export async function startXr({ view, overlayRoot, uiElements, onPlace, onEnd }) {
  const { renderer, scene, camera, reticle, area, orientArea } = view;

  // 'local' is requested (not just 'local-floor') because a required
  // reference-space feature the runtime doesn't support fails the whole
  // session request, with no chance to fall back afterwards — and not
  // every WebXR runtime offers 'local-floor' (notably Variant Launch's
  // iOS viewer, see README). 'local' is the one every runtime guarantees.
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test', 'local'],
    optionalFeatures: ['anchors', 'dom-overlay', 'local-floor'],
    domOverlay: { root: overlayRoot }
  });

  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(session);

  const localSpace = await requestLocalSpace(session);
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const hitTestSource = await session.requestHitTestSource({ space: viewerSpace });

  let placing = true;
  let anchor = null;

  // A tap on the input row or a button is UI, not a "place here" gesture.
  const swallow = (e) => e.preventDefault();
  for (const el of uiElements) el.addEventListener('beforexrselect', swallow);

  async function onSelect() {
    if (!placing || !reticle.visible) return;
    placing = false;
    area.position.copy(reticle.position);
    // Length runs away from where the phone is right now.
    renderer.xr.getCamera().getWorldPosition(viewerPosition);
    orientArea(viewerPosition);
    area.visible = true;
    reticle.visible = false;

    // Anchors survive tracking corrections; without one the text drifts
    // slightly as the phone refines its map of the room.
    const frame = renderer.xr.getFrame();
    if (frame?.createAnchor) {
      try {
        anchor = await frame.createAnchor(
          new XRRigidTransform(area.position, area.quaternion),
          localSpace
        );
      } catch {
        anchor = null;
      }
    }
    onPlace(area.position);
  }
  session.addEventListener('select', onSelect);

  function onFrame(_time, frame) {
    if (!frame) return;
    if (placing) {
      const hits = frame.getHitTestResults(hitTestSource);
      const pose = hits.length ? hits[0].getPose(localSpace) : null;
      if (pose) {
        poseMatrix.fromArray(pose.transform.matrix);
        reticle.position.setFromMatrixPosition(poseMatrix);
        reticle.quaternion.setFromRotationMatrix(poseMatrix);
        reticle.visible = true;
      } else {
        reticle.visible = false;
      }
    } else if (anchor && frame.trackedAnchors?.has(anchor)) {
      const pose = frame.getPose(anchor.anchorSpace, localSpace);
      if (pose) {
        poseMatrix.fromArray(pose.transform.matrix);
        area.position.setFromMatrixPosition(poseMatrix);
        area.quaternion.setFromRotationMatrix(poseMatrix);
      }
    }
    renderer.render(scene, camera);
  }

  session.addEventListener('end', () => {
    renderer.setAnimationLoop(null);
    for (const el of uiElements) el.removeEventListener('beforexrselect', swallow);
    hitTestSource.cancel?.();
    onEnd();
  });

  renderer.setAnimationLoop(onFrame);

  return {
    mode: 'xr',
    end: () => session.end().catch(() => {})
  };
}
