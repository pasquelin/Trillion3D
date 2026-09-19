import * as THREE from 'three';

/**
 * Held frame of a Three-rendered engine.
 *
 * Such an engine submits nothing itself: the host renders the graph it holds, and a held
 * frame therefore redrew the whole scene while the engine had already answered that it could
 * not change. The canvas content, for its part, does not survive from frame to frame —
 * `preserveDrawingBuffer` is false, and relying on it would display whatever the browser
 * happens to keep.
 *
 * What is kept is therefore an explicit copy: the last complete frame is copied from the
 * drawing buffer into a texture, and a held frame redisplays it with a fullscreen quad —
 * one draw command, no scene geometry, no scene material. The copy costs a whole frame of
 * bandwidth; it only happens after a complete frame, never after a held frame, which only
 * rereads what it just put back.
 */
export function createHeldFrame() {
  let texture: THREE.FramebufferTexture | undefined,
    width = 0,
    height = 0,
    kept = false;
  // The copied buffer already carries the display output: tone mapping was applied to it
  // before the copy, and reapplying it would brighten the held frame on every presentation.
  const material = new THREE.MeshBasicMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  return {
    /** True when a complete frame has been kept at the current drawing-buffer size. */
    holds(size: THREE.Vector2) {
      return kept && size.x === width && size.y === height;
    },
    /** Keeps the complete frame that was just submitted, by copying the drawing buffer. */
    keep(renderer: THREE.WebGLRenderer, size: THREE.Vector2) {
      if (!texture || size.x !== width || size.y !== height) {
        texture?.dispose();
        width = size.x;
        height = size.y;
        texture = new THREE.FramebufferTexture(width, height);
        material.map = texture;
        material.needsUpdate = true;
      }
      renderer.copyFramebufferToTexture(texture);
      kept = true;
    },
    /**
     * Redisplays the kept frame: a fullscreen quad, one command, nothing of the scene.
     *
     * The copy is a raw sample of the drawing buffer: it already carries the output conversion
     * and the tone mapping of the complete frame. Putting it back as-is therefore requires that
     * nothing retouch it — `toneMapped` is false on the material, and the output conversion is
     * neutral for this command. Without that, already-encoded values would be reread as linear
     * then re-encoded, and the held frame would brighten. The copy stays without a declared
     * colour space: an sRGB texture cannot receive `copyFramebufferToTexture`.
     */
    present(renderer: THREE.WebGLRenderer) {
      const sortie = renderer.outputColorSpace;
      renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
      renderer.render(scene, camera);
      renderer.outputColorSpace = sortie;
    },
  };
}
