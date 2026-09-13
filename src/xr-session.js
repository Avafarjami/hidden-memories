/**
 * WebXR path (Android Chrome and any browser with immersive-ar).
 *
 * Real floor detection via hit-test, an anchor so the square stays put while
 * the phone moves, and the page's own DOM as the overlay so the same UI works
 * in both AR modes.
 */
import * as THREE from 'three';

const poseMatrix = new THREE.Matrix4();

export async function isXrAvailable() {
  if (!navigator.xr?.isSessionSupported) return false;
  try { return await navigator.xr.isSessionSupported('immersive-ar'); } catch { return false; }
}

/**
 * @param {object} opts
 * @param {import('./scene.js')} opts.view      result of createScene()
 * @param {HTMLElement} opts.overlayRoot        DOM overlay root
 * @param {HTMLElement[]} opts.uiElements       taps on these must not place the square
 * @param {(position: THREE.Vector3) => void} opts.onPlace
 * @param {() => void} opts.onEnd
 */
export async function startXr({ view, overlayRoot, uiElements, onPlace, onEnd }) {
  const { renderer, scene, camera, reticle, square } = view;

  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test', 'local-floor'],
    optionalFeatures: ['anchors', 'dom-overlay'],
    domOverlay: { root: overlayRoot }
  });

  renderer.xr.setReferenceSpaceType('local-floor');
  await renderer.xr.setSession(session);

  const localSpace = await session.requestReferenceSpace('local-floor');
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
    square.position.copy(reticle.position);
    square.quaternion.copy(reticle.quaternion);
    square.visible = true;
    reticle.visible = false;

    // Anchors survive tracking corrections; without one the square drifts
    // slightly as the phone refines its map of the room.
    const frame = renderer.xr.getFrame();
    if (frame?.createAnchor) {
      try {
        anchor = await frame.createAnchor(
          new XRRigidTransform(square.position, square.quaternion),
          localSpace
        );
      } catch {
        anchor = null;
      }
    }
    onPlace(square.position);
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
        square.position.setFromMatrixPosition(poseMatrix);
        square.quaternion.setFromRotationMatrix(poseMatrix);
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
