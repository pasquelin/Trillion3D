/**
 * Two more archetypes for the edge and the heart of downtown: residential towers (a rendered
 * body, framed windows, glass-fronted balconies on every face) and diagrid towers (a tapering
 * glass drum wrapped in a lattice of crossing steel helices tied by ring beams).
 */
import type { MeshPart } from '../../plan/contract.ts';
import { lathe, prop, SURFACES, tube, type ProfilePoint } from '../../props/index.ts';
import type { Vec3 } from '../../plan/contract.ts';
import { polygon, rectangle } from './facade.ts';
import { CITY } from './surfaces.ts';
import { flatRoof, PODIUM, towerProp, type Tower } from './tower-kit.ts';

export function residentialTower(height: number, wall: typeof CITY.render, seed: number): Tower {
  const lower = height * 0.7;
  return towerProp({
    id: `city/tower-residential-${height}`,
    glass: CITY.glassTeal,
    mullion: CITY.stone,
    bay: 3.6,
    podium: [18, 15],
    sections: [
      { outline: rectangle(30, 24, 1.5), height: lower },
      { outline: rectangle(26, 20, 1.5), height: height - lower - 8 },
    ],
    punched: { wall, floor: 3.1 },
    crown: () => flatRoof(26, 20, CITY.stone),
    roof: [13, 10],
    lit: 0.3,
    seed,
  });
}

/** The lattice: `n` helices each way from the podium to `top`, radius shrinking with height. */
function diagrid(n: number, top: number, radius: (y: number) => number): MeshPart[] {
  const levels = Math.round((top - PODIUM) / 8),
    parts: MeshPart[] = [];
  for (const turn of [-1, 1])
    for (let k = 0; k < n; k++) {
      const points = Array.from({ length: levels + 1 }, (_, m): Vec3 => {
        const y = PODIUM + ((top - PODIUM) * m) / levels,
          a = (2 * Math.PI * k) / n + (turn * m * Math.PI) / n;
        return [radius(y) * Math.cos(a), y, radius(y) * Math.sin(a)];
      });
      parts.push(tube(SURFACES.steel, points, 0.45, { segments: 5 }));
    }
  for (let m = 0; m <= levels; m += 2) {
    const y = PODIUM + ((top - PODIUM) * m) / levels;
    parts.push(
      lathe(
        SURFACES.steel,
        [
          [radius(y) + 0.3, y - 0.4],
          [radius(y) + 0.3, y + 0.4],
        ],
        { segments: 2 * n, caps: false },
      ),
    );
  }
  return parts;
}

export function diagridTower(height: number, seed: number): Tower {
  const body = height - 24,
    r0 = 22,
    r1 = 15,
    radius = (y: number) => r0 + ((r1 - r0) * (y - PODIUM)) / body;
  const steps = 6;
  const tower = towerProp({
    id: `city/tower-diagrid-${height}`,
    glass: CITY.glassBlue,
    mullion: CITY.mullionDark,
    bay: 6,
    podium: [26, 26],
    sections: Array.from({ length: steps }, (_, i) => ({
      outline: polygon(32, radius(PODIUM + (body * (i + 1)) / steps) - 1.5),
      height: body / steps,
    })),
    crown: () => {
      const cap: ProfilePoint[] = [
        [r1 - 1.5, 0],
        [r1 - 3, 8],
        [4, 18],
        [0.5, 24],
      ];
      return [lathe(CITY.glassSilver, cap, { segments: 32 })];
    },
    lit: 0.2,
    seed,
  });
  return {
    ...tower,
    prop: prop(tower.prop.id, [...tower.prop.parts, ...diagrid(16, PODIUM + body, radius)]),
  };
}
