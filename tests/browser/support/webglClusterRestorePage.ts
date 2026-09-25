import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';
import { WebglClusterOwner } from '../../../packages/sdk-browser/src/webgl/cluster/owner.ts';
import { createFrameComposer } from '../../../packages/sdk-browser/src/world/render/compose.ts';
import { prepareExplorerWebglSurface } from '../../../packages/sdk-browser/src/world/render/webglHost.ts';
import { baseCapabilities } from '../../../bench/witnesses/capabilities.ts';
import type { HostDrawCamera } from '../../../packages/sdk-browser/src/camera/world.ts';
import { IDENTITY_MATRIX4 } from '../../../packages/sdk-core/src/index.ts';

const readPixel = (gl: WebGL2RenderingContext) => {
  const value = new Uint8Array(4);
  gl.readPixels(4, 4, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, value);
  return [...value];
};

const waitFor = (read: () => boolean) =>
  new Promise<void>((resolve, reject) => {
    const start = performance.now();
    const poll = () => {
      if (read()) resolve();
      else if (performance.now() - start > 2000) reject(new Error('Context event timeout'));
      else requestAnimationFrame(poll);
    };
    poll();
  });

/** Paints one flat color into a 1x1 canvas, the cheapest way to change a texture's content. */
const paint = (image: HTMLCanvasElement, color: string) => {
  const context = image.getContext('2d');
  if (!context) throw new Error('2d context unavailable');
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
};

const texturedTriangle = () => {
  const geometry = new G.GraphGeometry();
  geometry.setAttribute(
    'position',
    new G.BufferAttribute(new Float32Array([-1, -1, -2, 1, -1, -2, 0, 1, -2]), 3),
  );
  geometry.setAttribute('uv', new G.BufferAttribute(new Float32Array(6), 2));
  geometry.setIndex(new G.BufferAttribute(new Uint32Array([0, 1, 2]), 1));
  const index = geometry.index;
  if (!index) throw new Error('texturedTriangle requires an indexed geometry');
  const image = document.createElement('canvas');
  image.width = image.height = 1;
  const texture = G.canvasTexture(image);
  const material = G.basicSurface({ map: texture });
  return {
    image,
    texture,
    geometry,
    material,
    mesh: {
      geometry: { index, attributes: geometry.attributes },
      material: material as G.GraphSurface | G.GraphSurface[],
      renderOrder: 0,
      polygonOffsetUnits: undefined,
      matrix: { elements: new Float64Array(IDENTITY_MATRIX4) },
      _multiDrawCounts: new Int32Array([3]),
      _multiDrawStarts: new Int32Array([0]),
      _multiDrawCount: 1,
    },
  };
};

export async function heldRestore() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 8;
  document.body.append(canvas);
  const events: ('lost' | 'restored')[] = [],
    surface = prepareExplorerWebglSurface({
      canvas,
      size: { width: 8, height: 8 },
      onLifecycle: (state) => events.push(state),
    }),
    gl = surface.context,
    camera = G.perspectiveCamera(),
    scene = new G.GraphScene(),
    fixture = texturedTriangle(),
    owner = new WebglClusterOwner(gl);
  let draws = 0;
  const backend = {
    id: 'restore',
    capabilities: baseCapabilities,
    scene,
    frameHeld: false,
    overBudget: false,
    prepare: async () => {},
    render: () => {},
    metrics: () => ({}),
    dispose: () => {},
    drawHostGeometry: (drawCamera: HostDrawCamera) => {
      draws++;
      owner.draw([fixture.mesh], scene, drawCamera, false, true);
    },
  };
  paint(fixture.image, 'red');
  fixture.texture.needsUpdate = true;
  const draw = createFrameComposer(gl, camera);
  draw(backend, null);
  backend.frameHeld = true;
  paint(fixture.image, 'lime');
  fixture.texture.needsUpdate = true;
  const extension = gl.getExtension('WEBGL_lose_context');
  if (!extension) return { unavailable: 'WEBGL_lose_context unavailable' };
  extension.loseContext();
  await waitFor(() => events.includes('lost'));
  extension.restoreContext();
  await waitFor(() => events.includes('restored'));
  draw(backend, null);
  const restoredPixel = readPixel(gl);
  draw.dispose();
  owner.dispose();
  fixture.geometry.dispose();
  fixture.material.dispose();
  fixture.texture.dispose();
  surface.dispose();
  return { draws, restoredPixel };
}
