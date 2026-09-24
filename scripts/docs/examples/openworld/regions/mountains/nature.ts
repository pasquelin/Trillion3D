/**
 * The mountains' own natural props and small furniture: granite boulders, crags of stacked
 * blocks, a frosted pine and a golden larch (the shared pine's rule grown again under other
 * needles, never copied), a dead snag, a summit cross, the orange snow poles that mark the
 * mountain roads, and a lantern post.
 */
import type { MeshPart, PropMesh, Vec3 } from '../../plan/contract.ts';
import {
  blob,
  cylinder,
  prop,
  SURFACES,
  transform,
  tree,
  tube,
  type PropLamp,
} from '../../props/index.ts';
import { boxAt } from './parts.ts';
import { MOUNTAIN_SURFACES as S } from './surfaces.ts';

/** Four boulders about 1 m across at scale 1, sitting on y = 0 (instances scale them 1–6×). */
export const boulders = (seed: number): PropMesh[] =>
  [
    [0.6, 0.42, 0.5],
    [0.7, 0.3, 0.55],
    [0.5, 0.5, 0.45],
    [0.65, 0.36, 0.6],
  ].map(([rx, ry, rz], i) =>
    prop(`mountains/boulder-${i}`, [
      blob(i % 2 ? S.darkRock : S.granite, [rx, ry, rz], seed + i, { detail: 8, roughness: 0.2 }),
    ]),
  );

/** A blob of half-extents `r` has its top about this far over its base, in `r[1]`s. */
const BLOB_TOP = 1.35;

/** Three crags, 14–30 m high: blocks stacked and leaning, snow on the upper ledges. */
export const crags = (seed: number): PropMesh[] =>
  [14, 22, 30].map((height, c) => {
    const parts: MeshPart[] = [],
      blocks = 5 + c * 2,
      step = height / blocks;
    for (let k = 0; k < blocks; k++) {
      const t = k / blocks,
        r = height * (0.28 - 0.16 * t),
        angle = k * 2.4 + c,
        at = (y: number): Vec3 => [Math.cos(angle) * r * 0.3, y, Math.sin(angle) * r * 0.3],
        rock = k % 3 ? S.granite : S.darkRock;
      parts.push(
        transform(
          blob(rock, [r, (step * 1.2) / BLOB_TOP, r * 0.8], seed + c * 50 + k, { detail: 5 }),
          {
            at: at(t * height),
            yaw: angle,
          },
        ),
      );
      if (t > 0.4)
        parts.push(
          transform(
            blob(S.snow, [r * 0.7, step / 5, r * 0.55], seed + c * 50 + k + 20, { detail: 3 }),
            {
              at: at(t * height + step * 1.05),
              yaw: angle,
            },
          ),
        );
    }
    return prop(`mountains/crag-${c}`, parts);
  });

/** The shared small pine grown again under another needle colour (its own mesh, same rule). */
const repaintedPine = (id: string, seed: number, needles: typeof S.larch) =>
  prop(
    id,
    tree('pine', 'small', seed).parts.map((part) =>
      part.surface.name === SURFACES.needles.name ? { ...part, surface: needles } : part,
    ),
  );

/** A frosted pine for the tree line, a golden larch, and a dead snag above the forest. */
export function conifers(seed: number): PropMesh[] {
  const snag = [
    cylinder(SURFACES.bark, 0.3, 11, { top: 0.06, segments: 8 }),
    ...[3, 5, 7, 8.5].map((y, k) =>
      tube(
        SURFACES.bark,
        [
          [0, y, 0],
          [Math.cos(k * 2) * 1.6, y + 0.8, Math.sin(k * 2) * 1.6],
        ],
        [0.08, 0.02],
        { segments: 5 },
      ),
    ),
  ];
  return [
    repaintedPine('mountains/pine-frosted', seed, S.frost),
    repaintedPine('mountains/larch', seed + 7, S.larch),
    prop('mountains/snag', snag),
  ];
}

/** A 2.2 m snow pole: orange with black bands, on a small foot. */
export const snowPole = (): PropMesh =>
  prop('mountains/snow-pole', [
    boxAt(S.poleOrange, [0.07, 2.2, 0.07], { at: [0, 0, 0] }),
    ...[1.2, 1.6, 2.0].map((y) =>
      boxAt(SURFACES.darkMetal, [0.075, 0.15, 0.075], { at: [0, y, 0] }),
    ),
  ]);

/** A 4 m larch-wood summit cross on a cairn. */
export const summitCross = (): PropMesh =>
  prop('mountains/summit-cross', [
    blob(S.granite, [0.9, 0.5, 0.8], 11, { detail: 3 }),
    boxAt(S.logWood, [0.2, 4, 0.2], { at: [0, 0.2, 0] }),
    boxAt(S.logWood, [1.8, 0.18, 0.18], { at: [0, 3, 0] }),
    boxAt(S.gilt, [0.3, 0.3, 0.05], { at: [0, 2.95, 0.12] }),
  ]);

/** A 3.6 m wooden post, an iron lantern with glowing panes, a little roof. */
export const lanternPost = (): PropMesh =>
  prop('mountains/lantern-post', [
    boxAt(S.stoneWall, [0.5, 0.4, 0.5], { at: [0, 0, 0] }),
    boxAt(S.darkWood, [0.18, 3.2, 0.18], { at: [0, 0.4, 0] }),
    boxAt(SURFACES.darkMetal, [0.4, 0.06, 0.4], { at: [0, 3.25, 0] }),
    boxAt(S.lantern, [0.3, 0.4, 0.3], { at: [0, 3.3, 0] }),
    ...[-1, 1].flatMap((x) =>
      [-1, 1].map((z) =>
        boxAt(SURFACES.darkMetal, [0.04, 0.42, 0.04], { at: [x * 0.16, 3.3, z * 0.16] }),
      ),
    ),
    transform(cylinder(SURFACES.darkMetal, 0.32, 0.25, { top: 0.02, segments: 4 }), {
      at: [0, 3.72, 0],
      yaw: Math.PI / 4,
    }),
  ]);

/** A lantern of ~3 000 lm, all around: ≈ 250 cd; the range where it fades under a path's floor. */
export const LANTERN_LAMPS: readonly PropLamp[] = [
  {
    id: 'lantern',
    type: 'point',
    offset: [0, 3.5, 0],
    color: [1, 0.72, 0.45],
    intensity: 250,
    range: 16,
    night: true,
  },
];
