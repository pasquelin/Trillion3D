/**
 * Desert rock at real size: layered cliff faces (a mesa's wall, 40 m wide, 100 m high before
 * the instance's vertical scale), a natural arch, sandstone outcrops; the smaller stones are in
 * `stones.ts`.
 */
import type { MeshPart, PropMesh, Vec3 } from '../../plan/contract.ts';
import {
  between,
  blob,
  flatShade,
  hash01,
  jitter,
  prop,
  sheet,
  transform,
  tube,
} from '../../props/index.ts';
import { fbm, valueNoise } from './field.ts';
import { DESERT, STRATA } from './palette.ts';
import { stoneProps } from './stones.ts';

/** Wall width and unscaled height of a cliff face. */
export const CLIFF_FACE = { width: 40, height: 100 };
/** Variants of each, so neighbours differ. */
export const CLIFF_FACES = 5;

/**
 * A cliff face facing +Z, its foot at y = 0: beds of alternating hardness, hard beds standing
 * proud as ledges, soft beds recessed, all fractured by noise. The back is open: it stands
 * against the terrain's own cliff.
 */
function cliffFace(id: string, seed: number): PropMesh {
  const { width, height } = CLIFF_FACE,
    parts: MeshPart[] = [],
    // Vertical joints every 5–9 m split the beds into blocks.
    joint = between(seed, 99, 5, 9);
  let y = 0;
  for (let k = 0; y < height - 1; k++) {
    const thick = Math.min(height - y, between(seed, k, 7, 18)),
      hard = hash01(seed + 1, k) > 0.45,
      proud = hard ? between(seed + 2, k, 1.2, 2.6) : between(seed + 2, k, -0.4, 0.6),
      top = y + thick;
    const depth = (x: number, v: number) => {
      const lip = hard ? Math.min(1, (top - v) / 1.2) : 1,
        bulge = -((x / (width / 2)) ** 2) * 2.5,
        swell = 1.3 * fbm(seed + 4, x / 11, v / 11, 3),
        gap = Math.abs(((((x / joint + valueNoise(seed + 5, v / 14, k)) % 1) + 1) % 1) - 0.5),
        groove = -0.9 * Math.max(0, 1 - gap * 14),
        grit = hash01(seed + 3, Math.round(x * 3), Math.round(v * 3)) * (hard ? 0.18 : 0.35);
      return proud * lip + bulge + swell + groove - grit;
    };
    const rows = Math.max(4, Math.round(thick / 0.6)),
      bottom = y;
    parts.push(
      sheet(STRATA[k % STRATA.length], 80, rows, (u, v) => {
        const x = (u - 0.5) * width,
          h = bottom + v * thick;
        return [x, h, depth(x, h)];
      }),
    );
    y = top;
  }
  return prop(id, parts);
}

/** A natural arch spanning 26 m along X, 22 m high, its legs sunk into rubble. */
function arch(id: string, seed: number): PropMesh {
  const span = 13,
    rise = 20,
    path = Array.from({ length: 49 }, (_, i): Vec3 => {
      const a = Math.PI * (i / 48);
      return [-Math.cos(a) * span, Math.sin(a) * rise, 0];
    }),
    radii = path.map((_, i) => 2.2 + (1.8 * Math.abs(i - 24)) / 24);
  const body = flatShade(
    jitter(tube(DESERT.ochre, path, radii, { segments: 24, caps: true }), 0.45, seed),
  );
  const legs = [-1, 1].map((side) =>
    transform(blob(DESERT.rust, [4.5, 3, 4], seed + side, { detail: 6 }), {
      at: [side * span, -1, 0],
    }),
  );
  return prop(id, [transform(body, { scale: [1, 1, 1.4] }), ...legs]);
}

/** A sandstone outcrop 20–30 m across: three banded lumps stacked and offset, wind-scoured. */
function outcrop(id: string, seed: number): PropMesh {
  const size = between(seed, 1, 10, 15),
    lumps = [0, 1, 2].map((k) =>
      transform(
        blob(
          STRATA[(k + seed) % 4],
          [size * (1 - k * 0.22), size * 0.28, size * 0.8 * (1 - k * 0.2)],
          seed + k,
          { detail: 9, roughness: 0.2, frequency: 1.2 },
        ),
        {
          at: [between(seed, 10 + k, -2, 2), k * size * 0.3 - 0.8, between(seed, 20 + k, -2, 2)],
          yaw: k * 0.7,
        },
      ),
    );
  return prop(id, lumps);
}

/** Every rock prop of the desert, seeded. */
export const rockProps = (seed: number): PropMesh[] => [
  ...Array.from({ length: CLIFF_FACES }, (_, k) =>
    cliffFace(`desert/cliff-face-${k}`, seed + k * 31),
  ),
  ...stoneProps(seed + 200),
  arch('desert/arch', seed + 400),
  ...[0, 1, 2].map((k) => outcrop(`desert/outcrop-${k}`, seed + 700 + k * 13)),
];
