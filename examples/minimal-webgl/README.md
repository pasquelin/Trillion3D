# Minimal WebGL host

The SDK does not own the canvas, animation loop or asset URLs. A host:

1. Compiles a prepared source with `web-geometry-compile` (or `prepare` from `@web-geometry/sdk/node`).
2. Serves the cache directory and original textures.
3. Passes `manifestUrl` to `createExplorer`.

```js
import { createExplorer } from '@web-geometry/sdk/browser';

const canvas = document.querySelector('canvas');
const explorer = await createExplorer(canvas, {
  manifestUrl: '/cache/native/slice/manifest.json',
  scope: 'slice',
});
explorer.select('exact-cluster-pages');

function frame() {
  explorer.render();
  requestAnimationFrame(frame);
}
frame();
```

When WebGPU is available, `createExplorer` also prepares `webgpu-page-raster` (`createGpuPageCache`, GPU frustum + `lodScore` when compute exists, otherwise the CPU cut, visibility buffer + source-material second pass when `r32uint` is available). Select it explicitly; the default backend remains the WebGL2 reference.
