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
import { FULL_FACE } from '../../../../sdk-core/src/scene/light-shadow/volume.ts';
import { MAX_SHADOW_REGIONS } from '../../gpu/shadow/atlas.ts';
import { createSelectionUniforms } from '../../gpu/core/selection.ts';
import type { DagViewUniforms } from '../../gpu/dag/types.ts';

/** Cells per side of a run's window at most: the light cut's page mask is eight by eight. */
const CELLS = 8;

/**
 * The pages of one light view a frame draws — a sun level, or a lamp face at one mip —, as a light
 * cut sees them: the regions `[first, first + count)`, the bounding square of their pages, and the
 * selection view that square bounds.
 *
 * The window is cut into at most eight cells per side, each `2^shift` pages wide, and a cell is
 * marked when a drawn page lies in it: the cut keeps a caster only if it covers a marked cell.
 */
export interface ShadowRun {
  first: number;
  count: number;
  /** Bounding square of the run's pages, in the view's page coordinates, and its cell width. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  shift: number;
  near: number;
  pages: LightPages;
  face: FaceSelection;
  uniforms: DagViewUniforms;
}

export type ShadowRuns = ReturnType<typeof createShadowRuns>;

/**
 * The frame's runs, allocated once for the most a frame can draw — one run per page at worst —
 * and rewritten in place: planning a frame allocates nothing.
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
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 0,
      shift: 0,
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
    /** Opens the run of a new view at region `first`. */
    open(first: number, near: number) {
      const run = list[count++];
      run.first = first;
      run.count = 0;
      run.near = near;
      run.x0 = run.y0 = Infinity;
      run.x1 = run.y1 = -Infinity;
      return run;
    },
    /** Adds page `(x, y)` of the view to the open run. */
    add(x: number, y: number) {
      const run = list[count - 1];
      run.count++;
      run.x0 = Math.min(run.x0, x);
      run.y0 = Math.min(run.y0, y);
      run.x1 = Math.max(run.x1, x);
      run.y1 = Math.max(run.y1, y);
    },
    /**
     * The open run's cell width, once its pages are in: the smallest power of two that fits a
     * window `span` pages wide in eight cells — the bounding square of a sun level's pages, or a
     * whole lamp face.
     */
    shape(span: number) {
      const run = list[count - 1];
      run.shift = Math.max(0, Math.ceil(Math.log2(span / CELLS)));
      return run;
    },
    /**
     * Closes the open run while its window is the last face composed: its view, in the render
     * frame at `origin`, `rows` cells of `side / rows` texels, and the pages `(x, y)` its regions
     * draw, relative to the window's first page. The error threshold is the camera's: a texel
     * of the level a pixel reads is at most that pixel.
     */
    close(
      origin: ArrayLike<number>,
      pixelError: number,
      side: number,
      rows: number,
      pageXs: ArrayLike<number>,
      pageYs: ArrayLike<number>,
    ) {
      const run = list[count - 1],
        { face, uniforms, pages } = run;
      pages.rows = rows;
      pages.mask.fill(0);
      for (let i = 0; i < run.count; i++) {
        const cx = pageXs[i] >> run.shift,
          cy = pageYs[i] >> run.shift;
        markLightPages(pages, cx, cx, cy, cy);
      }
      writeFaceSelection(face, FULL_FACE, side, run.near, origin);
      pages.clipScale = face.clipScale;
      pages.clipPad = 2 / Math.max(1, side);
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
