// Public exact-pages proof: the scene copies — one transmissive, one blended — compose over the
// autonomous clusters on the host canvas and on a comparison target alike, through the same
// draw owner, and no mesh ever enters the host scene. A physical feature WebGL2 cannot draw is
// no refusal: the surface is drawn without it and the world says so once, by name.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { EngineError } from '../../../packages/sdk-core/src/index.ts';
import { pixel } from './webglClusterPixels.ts';
import { mountExplorerProof } from './webglClusterExplorerMount.ts';
import { transmissionCamera, transmissionScene } from './webglClusterTransmissionScene.ts';
import { listenMaterialDegraded } from './materialDegradedNotices.ts';

const anyMesh = (object: G.Object3D) => object instanceof G.Mesh;
/** The owner refuses a scene it cannot draw by throwing `EngineError`; anything else stays
 *  code- and reason-less, since the proof only names what the engine itself declared. */
const errorOf = (error: unknown) => ({
  code: error instanceof EngineError ? error.code : null,
  reason: error instanceof EngineError ? (error.details.reason ?? null) : null,
});

/** Runs `step`, returning what it threw as `errorOf` reads it, null when it drew. */
const refusalOf = async (step: () => unknown) => {
  try {
    await step();
    return null;
  } catch (error) {
    return errorOf(error);
  }
};

export async function execute() {
  const scene = transmissionScene({ name: 'glass' }),
    camera = transmissionCamera(),
    mutationNotices = listenMaterialDegraded(),
    mounted = mountExplorerProof(scene, camera, anyMesh, {
      clearColor: 0x0000ff,
      materialDegraded: mutationNotices.hear,
    });
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
  // The composer binds the target before asking the engine to draw (`packages/sdk-browser/src/world/render/compose.ts`).
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
  // A clearcoat set after the preparation, declared by `needsUpdate` as every change is, is drawn
  // without on the next frame and said once by name.
  const glass = scene.copy.material as G.GraphSurface;
  glass.clearcoat = 0.5;
  glass.needsUpdate = true;
  const mutationRefusal = await refusalOf(() => {
    for (let frame = 0; frame < 2; frame++) {
      backend.render(camera);
      draw(backend, null);
    }
  });
  const mutationPixel = pixel(gl, 32, 32),
    mutationNotice = await mutationNotices.said();
  const meshesInHostPass = mounted.countedInHostPass,
    hostCalls = mounted.calls.length;
  mounted.dispose();
  scene.dispose();

  // A physical extension beyond the transmission volume is prepared and drawn without, from the
  // first frame, and said once.
  const sheenScene = transmissionScene({ name: 'sheen glass', sheen: 1 }),
    sheenNotices = listenMaterialDegraded(),
    sheen = mountExplorerProof(sheenScene, camera, anyMesh, {
      clearColor: 0x0000ff,
      materialDegraded: sheenNotices.hear,
    });
  if (!sheen) return { unavailable: 'WebGL2 unavailable' };
  const refusal = await refusalOf(() => sheen.backend.prepare());
  const drawRefusal = await refusalOf(() => {
    for (let frame = 0; frame < 2; frame++) {
      sheen.backend.render(camera);
      sheen.draw(sheen.backend, null);
    }
  });
  const sheenPixel = pixel(sheen.gl, 32, 32),
    sheenNotice = await sheenNotices.said();
  sheen.dispose();
  sheenScene.dispose();
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
    mutationPixel,
    mutationNotice,
    refusal,
    drawRefusal,
    sheenPixel,
    sheenNotice,
  };
}
