import { createWebgpuCutAdopter } from './webgpuCutAdoption.ts';
import { createCutDelta } from './webgpuCutDelta.ts';
import { createCutCounts } from './webgpuCutCounts.ts';
import type { GpuCut, GpuSelection, SelectionUniforms } from './gpuSelection.ts';
import type { PageRec } from './pageSelection.ts';

/** Le bloc d'uniformes d'un banc : jamais comparé à autre chose qu'à lui-même ou à sa copie. */
export const fixtureUniforms = (): SelectionUniforms => ({
  planes: new Float32Array(24),
  view: new Float32Array(16),
  pixelScale: [1, 1],
  pixelError: 0,
  near: 0.1,
  cameraWorld: [0, 0, 0],
});

/** Un catalogue de `count` grappes, une par rang, toutes avec leurs octets. */
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

/** Une sélection qui ne sait que rendre le relevé du moment : tout ce qu'un adopteur lui demande. */
export const peekOnly = (peek: () => GpuCut | null) => ({ peek }) as unknown as GpuSelection;

/**
 * L'adopteur câblé comme le moteur le câble (`webgpuCutPublication.ts`) : une différence pour la
 * coupe demandée, une autre pour la coupe dessinable, et les totaux de triangles attachés à la
 * seconde. Quatre bancs le montaient à la main, et le même câblage recopié quatre fois n'épingle
 * rien de plus que celui-ci.
 */
export function mountCutAdopter(options: {
  packedPages: PageRec[];
  residentOffsetWords: Int32Array;
  uniforms: SelectionUniforms;
  selection: () => GpuSelection | undefined;
  onDrawnMirrored?: () => void;
}) {
  const { packedPages, residentOffsetWords } = options;
  const desired: PageRec[] = [],
    shown: PageRec[] = [],
    drawn: PageRec[] = [];
  const drawnDelta = createCutDelta(packedPages, []);
  const counts = createCutCounts(packedPages, residentOffsetWords, drawnDelta);
  const adopter = createWebgpuCutAdopter({
    selection: options.selection,
    packedPages,
    desired,
    shown,
    drawn,
    uniforms: options.uniforms,
    counts,
    delta: createCutDelta(packedPages, desired),
    drawnDelta,
    onCutDelta: () => {},
    onDrawnDelta: () => counts.apply(),
    onDrawnMirrored: options.onDrawnMirrored ?? (() => {}),
  });
  return { adopter, counts, desired, shown, drawn };
}
