// Public exact-pages proof: a transmissive scene copy composes over the autonomous clusters on
// the host canvas and on a comparison target alike, through the same draw owner, and never
// enters the host renderer's pass. A scene the owner cannot draw in full is refused by name.
import { pixel } from './webglClusterPixels.mjs';
import { mountExplorerProof } from './webglClusterExplorerMount.mjs';
import { transmissionCamera, transmissionScene } from './webglClusterTransmissionScene.mjs';

const physical = (object) => !!object.material?.isMeshPhysicalMaterial;
const errorOf = (error) => ({ code: error.code ?? null, reason: error.details?.reason ?? null });

export async function execute() {
  const scene = transmissionScene(),
    camera = transmissionCamera(),
    mounted = mountExplorerProof(scene, camera, physical, { clearColor: 0x0000ff });
  if (!mounted) return { unavailable: 'WebGL2 unavailable' };
  const { gl, host, backend, draw, target } = mounted;
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
  const physicalInHostPass = mounted.countedInHostPass,
    hostCalls = mounted.calls.length;
  mounted.dispose();
  scene.dispose();

  // A physical extension beyond the transmission volume fails the preparation and every draw.
  const refusedScene = transmissionScene({ sheen: 1 }),
    refused = mountExplorerProof(refusedScene, camera, physical, { clearColor: 0x0000ff });
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
    refusal,
    drawRefusal,
  };
}
