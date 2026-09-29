// What the screen-error measure (#959) reads INSIDE the page, served under `/runner/` and imported
// by its URL like `cutPage.ts`. One world on one backend holds each pose until its cut is held,
// then hands back what it drew: WebGPU the pages its cut selected (`selectedPageIds`, decoded in
// Node by `screenErrorSurface.ts`), WebGL2 the triangles of the meshes it drew, decoded by the
// engine's worker and placed by their own matrices. Both leave through the server's `/capture`.
import type * as SdkBrowser from '../witnesses/measurement.ts';
import type { CameraPose } from '../../packages/sdk-core/src/contracts/base.ts';

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
  selectedPageIds?: () => string[];
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
 *  corner through its instance matrix, if any, then through its mesh's own. */
function drawnCorners(meshes: DrawnMesh[]) {
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
    local = new Float64Array(3);
  let o = 0;
  for (const mesh of meshes) {
    const drawn = drawnOf(mesh);
    if (drawn === 0) continue;
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
  return out;
}

const capture = (file: string, bytes: Uint8Array) =>
  fetch(`/capture?file=${encodeURIComponent(file)}&w=${bytes.length / 4}&h=1`, {
    method: 'POST',
    body: bytes as Uint8Array<ArrayBuffer>,
  });

/** Holds every pose of `o` and captures what the backend drew, `<tag>-<view>.ids|tri`. */
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
    if (backend.selectedPageIds) {
      const text = new TextEncoder().encode(backend.selectedPageIds().join('\n'));
      const padded = new Uint8Array(Math.ceil(text.length / 4) * 4 || 4).fill(10);
      padded.set(text);
      await capture(`${file}.ids`, padded);
    } else
      await capture(
        `${file}.tri`,
        new Uint8Array(drawnCorners(backend.scene?.children ?? []).buffer),
      );
    rows.push({ view, held, canvas: [canvas.width, canvas.height] });
  }
  explorer.dispose();
  canvas.remove();
  return rows;
}
