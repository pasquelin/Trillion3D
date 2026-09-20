// Public exact-pages proof: a transmissive scene copy composes over the autonomous clusters on
// the host canvas and on a comparison target alike, through the same draw owner, and never
// enters the host renderer's pass. A scene the owner cannot draw in full is refused by name.
import * as THREE from 'three';
import { exactPagesBackend } from '../../packages/sdk-browser/exactPagesBackend.ts';
import { createSceneDrawer } from '../../packages/sdk-browser/explorerDrawScene.ts';
import { transmissionCamera, transmissionScene } from './webglClusterTransmissionScene.mjs';

const centre = (gl) => {
  const value = new Uint8Array(4);
  gl.readPixels(32, 32, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
  return [...value];
};

export async function execute() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const gl = canvas.getContext('webgl2');
  if (!gl) return { unavailable: 'WebGL2 unavailable' };
  const host = new THREE.WebGLRenderer({ canvas, context: gl }),
    scene = transmissionScene(),
    context = {
      source: scene.source,
      metadata: scene.metadata,
      indices: scene.indices,
      associations: scene.associations,
      pixelError: 0,
      viewport: [64, 64],
      clearColor: 0x0000ff,
      webglContext: gl,
    },
    backend = exactPagesBackend(context),
    camera = transmissionCamera(),
    draw = createSceneDrawer(host, camera),
    target = new THREE.WebGLRenderTarget(64, 64),
    hostScenes = [];
  await backend.prepare();
  const originalRender = host.render.bind(host);
  host.render = (drawn, view) => {
    let physical = 0;
    drawn.traverse((object) => {
      if (object.material?.isMeshPhysicalMaterial) physical++;
    });
    hostScenes.push(physical);
    return originalRender(drawn, view);
  };
  backend.render(camera);
  draw(backend, null);
  const canvasPixel = centre(gl);
  const metrics = backend.metrics();
  backend.render(camera);
  draw(backend, null);
  const repeatPixel = centre(gl);
  // The frame loop binds the target before handing the scene over (`explorerDraw.ts`).
  host.setRenderTarget(target);
  draw(backend, target);
  host.setRenderTarget(null);
  const targetPixel = new Uint8Array(4);
  host.readRenderTargetPixels(target, 32, 32, 1, 1, targetPixel);
  const targetMetrics = backend.metrics();
  draw.dispose();
  backend.dispose();
  target.dispose();
  scene.dispose();

  const refusedScene = transmissionScene({ sheen: 1 });
  const refused = exactPagesBackend({ ...context, ...refusedScene });
  let refusal = null;
  try {
    await refused.prepare();
  } catch (error) {
    refusal = { code: error.code, reason: error.details?.reason ?? null };
  }
  let drawRefused = false;
  try {
    refused.render(camera);
    draw(refused, null);
  } catch {
    drawRefused = true;
  }
  refused.dispose();
  refusedScene.dispose();
  host.dispose();
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
    physicalInHostPass: hostScenes.reduce((sum, count) => sum + count, 0),
    hostCalls: hostScenes.length,
    refusal,
    drawRefused,
  };
}
