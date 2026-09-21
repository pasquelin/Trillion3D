// Public exact-pages proof: a transmissive scene copy composes over the autonomous clusters on
// the host canvas and on a comparison target alike, through the same draw owner, and never
// enters the host renderer's pass. A scene the owner cannot draw in full is refused by name.
import type * as THREE from 'three';
import { pixel } from './webglClusterPixels.ts';
import { mountExplorerProof } from './webglClusterExplorerMount.ts';
import { transmissionCamera, transmissionScene } from './webglClusterTransmissionScene.ts';

// A mesh's material is read as `unknown` and narrowed here: `THREE.Object3D` does not declare
// `material` generically, only `THREE.Mesh` does, and not every traversed node is one.
const physical = (object: THREE.Object3D) =>
  !!(object as { material?: { isMeshPhysicalMaterial?: boolean } }).material
    ?.isMeshPhysicalMaterial;
const errorOf = (error: unknown) => {
  const details = error as { code?: string; details?: { reason?: string } };
  return { code: details.code ?? null, reason: details.details?.reason ?? null };
};

export async function execute() {
  const scene = transmissionScene(),
    camera = transmissionCamera(),
    mounted = mountExplorerProof(scene, camera, physical, { clearColor: 0x0000ff });
  if (!mounted) return { unavailable: 'WebGL2 unavailable' };
  const { gl, host, backend, draw, target } = mounted;
  if (!backend.setDiagnostic) throw new Error('backend missing setDiagnostic');
  const setDiagnostic = backend.setDiagnostic;
  await backend.prepare();
  backend.render(camera);
  draw(backend, null);
  const canvasPixel = pixel(gl, 32, 32);
  const metrics = backend.metrics();
  backend.render(camera);
  draw(backend, null);
  const repeatPixel = pixel(gl, 32, 32);
  // The frame loop binds the target before handing the scene over (`explorerDraw.ts`).
  host.setRenderTarget(target);
  draw(backend, target);
  host.setRenderTarget(null);
  const targetPixel = new Uint8Array(4);
  host.readRenderTargetPixels(target, 32, 32, 1, 1, targetPixel);
  const targetMetrics = backend.metrics();
  // A diagnostic mode paints the glass like any copy: the owner draws it as a whole mesh.
  setDiagnostic('wireframe');
  backend.render(camera);
  draw(backend, null);
  const wireframe = {
    copyDraws: backend.metrics().autonomousCopyDraws,
    drawCalls: backend.metrics().drawCalls,
  };
  setDiagnostic('beauty');
  // A mutation the program cannot preserve is refused by name on the next frame, no image drawn.
  scene.copy.material.clearcoat = 0.5;
  let mutationRefusal = null;
  try {
    backend.render(camera);
    draw(backend, null);
  } catch (error) {
    mutationRefusal = errorOf(error);
  }
  const physicalInHostPass = mounted.countedInHostPass,
    hostCalls = mounted.calls.length;
  mounted.dispose();
  scene.dispose();

  // A physical extension beyond the transmission volume fails the preparation and every draw.
  const refusedScene = transmissionScene({ sheen: 1 }),
    refused = mountExplorerProof(refusedScene, camera, physical, { clearColor: 0x0000ff });
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
    repeatPixel,
    targetPixel: [...targetPixel],
    copyDraws: metrics.autonomousCopyDraws,
    clusterDraws: metrics.autonomousClusterDrawsTotal,
    targetCopyDraws: targetMetrics.autonomousCopyDraws,
    backdropBytes: metrics.transmissionBackdropBytes,
    drawCalls: metrics.drawCalls,
    transparentMeshes: metrics.transparentMeshes,
    physicalInHostPass,
    hostCalls,
    wireframe,
    mutationRefusal,
    refusal,
    drawRefusal,
  };
}
