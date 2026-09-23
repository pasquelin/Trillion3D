// Public exact-pages proof: the scene copies — one transmissive, one blended — compose over the
// autonomous clusters on the host canvas and on a comparison target alike, through the same
// draw owner, and no mesh ever enters the host scene. A scene the owner cannot draw in full is
// refused by name.
import * as THREE from 'three';
import { EngineError } from '../../../packages/sdk-core/index.ts';
import { pixel } from './webglClusterPixels.ts';
import { mountExplorerProof } from './webglClusterExplorerMount.ts';
import { transmissionCamera, transmissionScene } from './webglClusterTransmissionScene.ts';

const anyMesh = (object: THREE.Object3D) => object instanceof THREE.Mesh;
/** The owner refuses a scene it cannot draw by throwing `EngineError`; anything else stays
 *  code- and reason-less, since the proof only names what the engine itself declared. */
const errorOf = (error: unknown) => ({
  code: error instanceof EngineError ? error.code : null,
  reason: error instanceof EngineError ? (error.details.reason ?? null) : null,
});

export async function execute() {
  const scene = transmissionScene(),
    camera = transmissionCamera(),
    mounted = mountExplorerProof(scene, camera, anyMesh, { clearColor: 0x0000ff });
  if (!mounted) return { unavailable: 'WebGL2 unavailable' };
  const { gl, backend, draw, target } = mounted;
  await backend.prepare();
  backend.render(camera);
  draw(backend, null);
  const canvasPixel = pixel(gl, 32, 32),
    blendedPixel = pixel(gl, 55, 32);
  const metrics = backend.metrics();
  backend.render(camera);
  draw(backend, null);
  const repeatPixel = pixel(gl, 32, 32);
  // The composer binds the target before asking the engine to draw (`explorerCompose.ts`).
  draw(backend, target);
  const targetPixel = mounted.targetPixel(32, 32);
  const targetMetrics = backend.metrics();
  if (!backend.setDiagnostic) throw new Error('the exact pages backend must set diagnostics');
  // A diagnostic mode paints the glass like any copy: the owner draws it as a whole mesh.
  backend.setDiagnostic('wireframe');
  backend.render(camera);
  draw(backend, null);
  const wireframe = {
    copyDraws: backend.metrics().autonomousCopyDraws,
    drawCalls: backend.metrics().drawCalls,
  };
  backend.setDiagnostic('beauty');
  // A mutation the program cannot preserve is refused by name on the next frame, no image drawn.
  scene.copy.material.clearcoat = 0.5;
  let mutationRefusal = null;
  try {
    backend.render(camera);
    draw(backend, null);
  } catch (error) {
    mutationRefusal = errorOf(error);
  }
  const meshesInHostPass = mounted.countedInHostPass,
    hostCalls = mounted.calls.length;
  mounted.dispose();
  scene.dispose();

  // A physical extension beyond the transmission volume fails the preparation and every draw.
  const refusedScene = transmissionScene({ sheen: 1 }),
    refused = mountExplorerProof(refusedScene, camera, anyMesh, { clearColor: 0x0000ff });
  if (!refused) return { unavailable: 'WebGL2 unavailable' };
  let refusal = null,
    drawRefusal = null;
  try {
    await refused.backend.prepare();
  } catch (error) {
    refusal = errorOf(error);
  }
  try {
    refused.backend.render(camera);
    refused.draw(refused.backend, null);
  } catch (error) {
    drawRefusal = errorOf(error);
  }
  refused.dispose();
  refusedScene.dispose();
  return {
    canvasPixel,
    blendedPixel,
    repeatPixel,
    targetPixel,
    copyDraws: metrics.autonomousCopyDraws,
    clusterDraws: metrics.autonomousClusterDrawsTotal,
    targetCopyDraws: targetMetrics.autonomousCopyDraws,
    backdropBytes: metrics.transmissionBackdropBytes,
    drawCalls: metrics.drawCalls,
    transparentMeshes: metrics.transparentMeshes,
    meshesInHostPass,
    hostCalls,
    wireframe,
    mutationRefusal,
    refusal,
    drawRefusal,
  };
}
