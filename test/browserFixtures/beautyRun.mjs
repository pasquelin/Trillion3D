import { cases } from './beautyCases.mjs';
import { runCase } from './beautyCase.mjs';

export async function run() {
  const THREE = await import('/.vite/deps/three.js');
  const { benchEngine } = await import('/15-virtualized-integration/implementation/engines.ts');
  const webgpuPagesBackend = benchEngine('webgpu-page-raster').factory;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw Error('No GPU');
  const device = await adapter.requestDevice({
    requiredFeatures: adapter.features.has('indirect-first-instance')
      ? ['indirect-first-instance']
      : [],
  });
  const errors = [];
  device.addEventListener('uncapturederror', (e) => errors.push(e.error.message));
  const canvas = document.createElement('canvas'),
    size = 64;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setSize(size, size);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  camera.position.z = 3;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const read = (scene) => {
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
    const p = new Uint8Array(size * size * 4);
    const gl = renderer.getContext();
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.UNSIGNED_BYTE, p);
    return p;
  };
  const results = [];
  for (const options of cases(THREE))
    results.push(await runCase(options, { THREE, webgpuPagesBackend, device, camera, size, read }));
  renderer.dispose();
  device.destroy();
  return {
    results,
    errors,
    adapter: {
      vendor: adapter.info.vendor,
      architecture: adapter.info.architecture,
      device: adapter.info.device,
      description: adapter.info.description,
    },
    userAgent: navigator.userAgent,
  };
}
