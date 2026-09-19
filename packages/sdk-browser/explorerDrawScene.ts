import * as THREE from 'three';
import { createHeldFrame } from './explorerHeldFrame.ts';
import type { RenderBackend } from './backendTypes.ts';

/**
 * Draws on the host renderer the scene an engine hands over — the path of every engine that does
 * not present a surface of its own. It owns the two things that go with that drawing: the display
 * chain the engine asks for, and the copy of the last complete frame that spares a redraw.
 */
export function createSceneDrawer(
  ownedRenderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
) {
  const heldFrame = createHeldFrame();
  const drawingSize = new THREE.Vector2();
  /**
   * Display chain of the Three-rendered engine, set on the engine view — the same rule as the
   * contract path. A scene with no declared light composes by identity: from linear to sRGB
   * and nothing else, albedo as-is (P6). As soon as a light exists, exposure and ACES come
   * back, last links of the chain (P4). The flag comes from the installed lights, never from
   * a host setting, and is written only when it changes: Three otherwise recompiles its programs.
   */
  const setDisplayChain = (backend: RenderBackend) => {
    const tone = backend.sceneLit?.() === false ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
    if (ownedRenderer.toneMapping !== tone) ownedRenderer.toneMapping = tone;
  };
  /**
   * A held frame cannot differ from the previous one — the engine just said so — and is
   * redisplayed in one command, the scene not walked again; with none kept at this size, the
   * first or after a resize, it is drawn then kept.
   *
   * `reuse` is false where the kept frame is not this engine's: a fallback takes over the image
   * from the engine that failed, and redisplaying what is kept would put that engine's last
   * frame back on the screen. It draws, and what it draws is kept in turn.
   */
  return (backend: RenderBackend, target: THREE.WebGLRenderTarget | null, reuse = true) => {
    setDisplayChain(backend);
    ownedRenderer.getDrawingBufferSize(drawingSize);
    if (reuse && backend.frameHeld === true && !target && heldFrame.holds(drawingSize))
      heldFrame.present(ownedRenderer);
    else {
      ownedRenderer.render(backend.scene, camera);
      if (!target) heldFrame.keep(ownedRenderer, drawingSize);
    }
  };
}
