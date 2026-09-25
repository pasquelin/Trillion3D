import { createWebgpuCutAdopter } from './adoption.ts';
import { createCutDelta } from './delta.ts';
import {
  createSelectionUniforms,
  type GpuCut,
  type GpuSelection,
  type SelectionUniforms,
} from '../../gpu/core/selection.ts';
import type { PageRec } from '../../page/selection/selection.ts';

/** Uniform block of a bench: the engine's, so a field added to the contract arrives here
 *  without being copied in. Never compared to anything but itself or its copy. */
export const fixtureUniforms = createSelectionUniforms;

/** A catalogue of `count` clusters, one per rank, all with their bytes. */
export function fixturePages(count: number, transparent: (index: number) => boolean = () => false) {
  return Array.from(
    { length: count },
    (_, i) =>
      ({
        url: `p${i}`,
        triangles: i + 1,
        transparent: transparent(i),
        array: new Uint32Array(3),
        packedIndex: i,
      }) as unknown as PageRec,
  );
}

/** A selection that only knows how to return the current readback: all an adopter asks of it. */
export const peekOnly = (peek: () => GpuCut | null) => ({ peek }) as unknown as GpuSelection;

/** Triangle totals of a readback header, as `dagMask` ships them: all zero unless given. */
export const fixtureTotals = (totals: Partial<GpuCut['result']> = {}) => ({
  selectedTriangles: 0,
  drawnTriangles: 0,
  transparentTriangles: 0,
  ...totals,
});

/**
 * The adopter wired as the engine wires it (`publication.ts`): a difference for the
 * requested cut and another for the drawable cut. Four benches used to mount it by hand, and the
 * same wiring copied four times pins nothing more than this one.
 */
export function mountCutAdopter(options: {
  packedPages: PageRec[];
  uniforms: SelectionUniforms;
  selection: () => GpuSelection | undefined;
  onDrawnMirrored?: () => void;
}) {
  const { packedPages } = options;
  const desired: PageRec[] = [],
    shown: PageRec[] = [],
    drawn: PageRec[] = [];
  const drawnPages: PageRec[] = [];
  const drawnDelta = createCutDelta(packedPages, drawnPages);
  const adopter = createWebgpuCutAdopter({
    selection: options.selection,
    desired,
    shown,
    drawn,
    uniforms: options.uniforms,
    delta: createCutDelta(packedPages, desired),
    drawnDelta,
    drawnPages,
    onCutDelta: () => {},
    onDrawnDelta: () => {},
    onDrawnMirrored: options.onDrawnMirrored ?? (() => {}),
  });
  return { adopter, desired, shown, drawn };
}
