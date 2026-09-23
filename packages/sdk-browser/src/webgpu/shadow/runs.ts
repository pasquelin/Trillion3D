import {
  createFaceSelection,
  writeFaceSelection,
  type FaceSelection,
} from '../../../../sdk-core/src/scene/light-shadow/selectionView.ts';
import {
  createLightPages,
  markLightPages,
  type LightPages,
} from '../../../../sdk-core/src/scene/light-shadow/pageOverlap.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import { createSelectionUniforms } from '../../gpu/core/selection.ts';
import type { DagViewUniforms } from '../../gpu/dag/types.ts';

/**
 * One redrawn face of a frame, as a light cut sees it: the regions `[first, first + count)` the
 * scheduler gave it, the pages they cover, and the selection view those pages bound — the planes,
 * the view and the texel scale of `writeFaceSelection`.
 */
export interface ShadowRun {
  first: number;
  count: number;
  /** Union of the regions, normalised face coordinates `u0, u1, v0, v1`. */
  rect: Float64Array;
  side: number;
  near: number;
  pages: LightPages;
  face: FaceSelection;
  uniforms: DagViewUniforms;
}

export type ShadowRuns = ReturnType<typeof createShadowRuns>;

/**
 * The frame's face runs, allocated once for the most a frame can redraw — one face per region at
 * worst — and rewritten in place: planning a frame allocates nothing.
 */
export function createShadowRuns() {
  const list: ShadowRun[] = [];
  for (let run = 0; run < MAX_SHADOW_REGIONS; run++) {
    const face = createFaceSelection(),
      pages = createLightPages(),
      uniforms: DagViewUniforms = createSelectionUniforms();
    uniforms.planes = face.planes;
    uniforms.view = face.view;
    uniforms.light = pages;
    list.push({
      first: 0,
      count: 0,
      rect: new Float64Array(4),
      side: 1,
      near: 0,
      pages,
      face,
      uniforms,
    });
  }
  let count = 0;
  return {
    list,
    get count() {
      return count;
    },
    reset() {
      count = 0;
    },
    /** Opens the run of a new face at region `first`, `side` texels and `rows` pages wide. */
    open(first: number, side: number, rows: number, near: number) {
      const run = list[count++];
      run.first = first;
      run.count = 0;
      run.side = side;
      run.near = near;
      run.rect[0] = run.rect[2] = Infinity;
      run.rect[1] = run.rect[3] = -Infinity;
      run.pages.rows = rows;
      run.pages.mask.fill(0);
      return run;
    },
    /** Adds a region to the open run: its extent pages `[x0, x1] × [y0, y1]`, and its rectangle. */
    add(x0: number, x1: number, y0: number, y1: number, rect: ArrayLike<number>) {
      const run = list[count - 1];
      run.count++;
      markLightPages(run.pages, x0, x1, y0, y1);
      run.rect[0] = Math.min(run.rect[0], rect[0]);
      run.rect[1] = Math.max(run.rect[1], rect[1]);
      run.rect[2] = Math.min(run.rect[2], rect[2]);
      run.rect[3] = Math.max(run.rect[3], rect[3]);
    },
    /**
     * Closes the open run while its face is still the last one composed: the view comes from that
     * composition, in the render frame at `origin`, and the error threshold is the camera's — one
     * screen pixel is one shadow texel, the unit the atlas sizes its faces in.
     */
    close(origin: ArrayLike<number>, pixelError: number) {
      if (!count) return;
      const run = list[count - 1],
        { face, uniforms, pages } = run;
      writeFaceSelection(face, run.rect, run.side, run.near, origin);
      pages.clipScale = face.clipScale;
      pages.clipPad = 2 / Math.max(1, run.side);
      uniforms.pixelScale[0] = uniforms.pixelScale[1] = face.focal;
      uniforms.pixelError = pixelError;
      uniforms.near = face.near;
      uniforms.cameraWorld[0] = origin[0];
      uniforms.cameraWorld[1] = origin[1];
      uniforms.cameraWorld[2] = origin[2];
      uniforms.cameraStretch = face.stretch;
      uniforms.perspective = face.perspective;
    },
  };
}
