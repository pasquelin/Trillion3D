// What the screen-error measure (#959) reads INSIDE the page, served under `/runner/` and imported
// by its URL like `series/cutPage.ts`. One world on one backend holds each pose until its cut is held,
// then hands back what it drew: WebGPU the clusters its cut selected (`selectedClusterIds`,
// decoded in Node by `screenError/screenErrorSurface.ts`), WebGL2 the triangles of the meshes it drew, decoded
// by the engine's worker and placed by their own matrices. Both leave through the server's `/capture`.
import type * as SdkBrowser from '../../witnesses/measurement.ts';
import type { CameraPose } from '../../../packages/sdk-core/src/contracts/base.ts';
import { posterCapture } from '../measurePage.ts';

export interface HoldOptions {
  sdkUrl: string;
  manifestUrl: string;
  backend: 'webgpu' | 'webgl2';
  pixelError: number;
  width: number;
  height: number;
  dpr: number;
  poses: { view: string; pose: CameraPose }[];
  tag: string;
}

interface DrawnMesh {
  visible: boolean;
  material: Parameters<typeof SdkBrowser.sideOf>[0];
  isInstancedMesh?: boolean;
  count?: number;
  instanceMatrix?: { array: ArrayLike<number> };
  matrix: { elements: ArrayLike<number> };
  geometry?: {
    index?: { array: ArrayLike<number>; count: number } | null;
    drawRange?: { count: number };
    attributes: { position?: { array: ArrayLike<number>; itemSize: number; count: number } };
  };
}
type Backend = SdkBrowser.RenderBackend & {
  selectedClusterIds?: () => string[];
  scene?: { children: DrawnMesh[] };
};

/** `m` (column-major, from `at`) applied to the point `(x, y, z)`, written to `out[o..o+3]`. */
function place(
  m: ArrayLike<number>,
  at: number,
  x: number,
  y: number,
  z: number,
  out: Float64Array,
  o: number,
) {
  out[o] = m[at] * x + m[at + 4] * y + m[at + 8] * z + m[at + 12];
  out[o + 1] = m[at + 1] * x + m[at + 5] * y + m[at + 9] * z + m[at + 13];
  out[o + 2] = m[at + 2] * x + m[at + 6] * y + m[at + 10] * z + m[at + 14];
}

/** The world-space corners of every visible mesh of a WebGL2 backend, three per triangle: each
 *  corner through its instance matrix, if any, then through its mesh's own; and per triangle, 1
 *  when its material is double-sided (`sideOf`, the engine's reading of the host's side). */
function drawnCorners(meshes: DrawnMesh[], sideOf: typeof SdkBrowser.sideOf) {
  const drawnOf = (mesh: DrawnMesh) => {
    const geometry = mesh.geometry,
      position = geometry?.attributes.position;
    if (!geometry || !position || !mesh.visible) return 0;
    const corners = geometry.index ? geometry.index.count : position.count;
    return Math.min(corners, geometry.drawRange?.count ?? corners);
  };
  const instancesOf = (mesh: DrawnMesh) => (mesh.isInstancedMesh ? (mesh.count ?? 0) : 1);
  let total = 0;
  for (const mesh of meshes) total += drawnOf(mesh) * instancesOf(mesh);
  const out = new Float64Array(3 * total),
    twoSided = new Uint8Array(Math.ceil(total / 12) * 4 || 4),
    local = new Float64Array(3);
  let o = 0;
  for (const mesh of meshes) {
    const drawn = drawnOf(mesh);
    if (drawn === 0) continue;
    if (sideOf(mesh.material) === 'double')
      twoSided.fill(1, o / 9, (o + 3 * drawn * instancesOf(mesh)) / 9);
    const { array: a, itemSize: s } = mesh.geometry!.attributes.position!,
      index = mesh.geometry!.index;
    for (let k = 0; k < instancesOf(mesh); k++)
      for (let c = 0; c < drawn; c++, o += 3) {
        const v = index ? index.array[c] : c;
        if (mesh.isInstancedMesh && mesh.instanceMatrix) {
          place(mesh.instanceMatrix.array, 16 * k, a[v * s], a[v * s + 1], a[v * s + 2], local, 0);
          place(mesh.matrix.elements, 0, local[0], local[1], local[2], out, o);
        } else place(mesh.matrix.elements, 0, a[v * s], a[v * s + 1], a[v * s + 2], out, o);
      }
  }
  return { corners: out, twoSided };
}

const capture = (file: string, bytes: Uint8Array) =>
  posterCapture(file, bytes, bytes.length / 4, 1);

/** Holds every pose of `o` and captures what the backend drew, `<tag>-<view>.ids|tri`, and
 *  WebGL2's per-triangle sides, `<tag>-<view>.two`. */
export async function holdAndCapture(o: HoldOptions) {
  const sdk = (await import(o.sdkUrl)) as typeof SdkBrowser;
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const explorer = await sdk.openMeasuredWorld(canvas, {
    manifestUrl: o.manifestUrl,
    scope: 'full',
    width: o.width,
    height: o.height,
    pixelRatio: o.dpr,
    replicaCount: 1,
    detail: 'source',
    pixelError: o.pixelError,
    lodAdaptive: false,
    preload: 'visible',
    ...(o.backend === 'webgl2'
      ? { autonomousGeometry: true }
      : { backends: [sdk.webgpuPagesBackend] }),
    comparisonLayout: 'single',
    clearColor: 0x2a303c,
    diagnosticDetail: 'summary',
  });
  const id = o.backend === 'webgl2' ? 'autonomous-pages-webgl' : 'webgpu-page-raster';
  const backend = explorer.backends.find((b) => b.id === id) as Backend | undefined;
  if (!backend) throw new Error(`backend ${id} absent: ${explorer.backends.map((b) => b.id)}`);
  const rows = [];
  for (const { view, pose } of o.poses) {
    explorer.setPose(pose);
    let held = -1;
    for (let i = 0; i < 400 && held < 0; i++) {
      await explorer.awaitPages();
      const frame = explorer.render(pose);
      await explorer.flush();
      if (i >= 8 && frame.frameHeld === true) held = i;
    }
    // Three more frames: the WebGPU readback of the cut is one frame behind the cut.
    for (let i = 0; i < 3; i++) {
      explorer.render(pose);
      await explorer.flush();
    }
    const file = `${o.tag}-${view}`;
    if (backend.selectedClusterIds) {
      const text = new TextEncoder().encode(backend.selectedClusterIds().join('\n'));
      const padded = new Uint8Array(Math.ceil(text.length / 4) * 4 || 4).fill(10);
      padded.set(text);
      await capture(`${file}.ids`, padded);
    } else {
      const { corners, twoSided } = drawnCorners(backend.scene?.children ?? [], sdk.sideOf);
      await capture(`${file}.tri`, new Uint8Array(corners.buffer));
      await capture(`${file}.two`, twoSided);
    }
    rows.push({ view, held, canvas: [canvas.width, canvas.height] });
  }
  explorer.dispose();
  canvas.remove();
  return rows;
}
