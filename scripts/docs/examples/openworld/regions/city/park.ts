/**
 * A park block: the fountain on its plaza (a `fountain` emitter), benches facing the gravel
 * paths, lamps reaching over them, a wood of oak, birch and pine (a forest patch,
 * `props/stands.ts`) in each corner lawn — two big trees where a wood does not fit — and a ring
 * of shrubs.
 */
import { hash01, STAND_SIDE, STREET_LAMP_LIGHTS } from '../../props/index.ts';
import { headingOf, sidewaysOf, turn, type Xz } from './frame.ts';
import { footprint, inCell, type Cell } from './grid.ts';
import { RANK, type Placer } from './placement.ts';

/** A park: the fountain on its plaza, benches on the paths, lamps, big trees in the lawns. */
export function park(placer: Placer, cell: Cell, y: number, support: number) {
  const put = (prop: string, uv: Xz, yaw: number, half: Xz, rank: number, extras = {}) =>
    placer.place(
      prop,
      inCell(placer, cell, uv, y),
      yaw,
      'solid',
      rank,
      footprint(placer, cell, uv, half),
      { support, ...extras },
    );
  const fountain = inCell(placer, cell, [0, 0], y + 5);
  put('city/fountain', [0, 0], placer.site.yaw, [7.5, 7.5], RANK.structure, {
    markers: [
      {
        kind: 'emitter',
        effect: 'fountain',
        name: placer.name('fountain-spray'),
        position: fountain,
        radius: 7,
      },
    ],
  });
  // Benches face their path; lamps reach over it.
  for (const [u, v, fu, fv] of [
    [20, 3.5, 0, -1],
    [-20, -3.5, 0, 1],
    [3.5, -20, -1, 0],
    [-3.5, 20, 1, 0],
  ] as const)
    put('bench', [u, v], headingOf(turn([fu, fv], placer.site.yaw)), [1, 1], RANK.furniture);
  for (const [u, v, fu, fv] of [
    [30, 3, 0, -1],
    [-30, -3, 0, 1],
    [3, -30, -1, 0],
    [-3, 30, 1, 0],
  ] as const)
    put(
      'street-lamp',
      [u, v],
      sidewaysOf(turn([fu, fv], placer.site.yaw)),
      [0.3, 0.3],
      RANK.street,
      { lamps: STREET_LAMP_LIGHTS },
    );
  // The level broadleaf wood, a quarter turn at random, set into each corner lawn, clear of the
  // street lamps a metre inside the kerb (`streets.ts`).
  const inset = placer.site.block / 2 - STAND_SIDE / 2 - 2;
  for (const [su, sv] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ] as const) {
    const turn = (Math.floor(hash01(cell.i, cell.j, su, sv) * 4) * Math.PI) / 2,
      half = STAND_SIDE / 2;
    if (
      put(
        'tree-stand-broadleaf-0',
        [su * inset, sv * inset],
        placer.site.yaw + turn,
        [half, half],
        RANK.garden,
      )
    )
      continue;
    for (const [u, v] of [[28, 28], su === sv ? [14, 32] : [32, 14]] as const)
      put(
        u === v ? 'tree-oak-large' : 'tree-birch-large',
        [su * u, sv * v],
        su * u + sv * v,
        [2, 2],
        RANK.garden,
      );
  }
  for (let k = 0; k < 8; k++) {
    const a = (k * Math.PI) / 4 + Math.PI / 8;
    put('bush-round', [Math.cos(a) * 16, Math.sin(a) * 16], a, [1.3, 1.3], RANK.garden);
  }
}
