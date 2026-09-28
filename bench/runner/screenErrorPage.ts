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

/** The world-space corners of every visible mesh of a WebGL2 backend, three per triangle. */
function drawnCorners(meshes: DrawnMesh[]) {
  const out: number[] = [];
  for (const mesh of meshes) {
    const position = mesh.geometry?.attributes.position,
      index = mesh.geometry?.index;
    if (!position || !mesh.visible) continue;
    const matrices: ArrayLike<number>[] = [];
    if (mesh.isInstancedMesh && mesh.instanceMatrix)
      for (let k = 0; k < (mesh.count ?? 0); k++)
        matrices.push(Array.from(mesh.instanceMatrix.array).slice(16 * k, 16 * k + 16));
    else matrices.push(mesh.matrix.elements);
    const corners = index ? index.count : position.count;
    const drawn = Math.min(corners, mesh.geometry?.drawRange?.count ?? corners);
    const { array: a, itemSize: s } = position;
    for (const m of matrices)
      for (let c = 0; c < drawn; c++) {
        const v = index ? index.array[c] : c,
          x = a[v * s],
          y = a[v * s + 1],
          z = a[v * s + 2];
        out.push(
          m[0] * x + m[4] * y + m[8] * z + m[12],
          m[1] * x + m[5] * y + m[9] * z + m[13],
          m[2] * x + m[6] * y + m[10] * z + m[14],
        );
      }
  }
  return new Float64Array(out);
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
