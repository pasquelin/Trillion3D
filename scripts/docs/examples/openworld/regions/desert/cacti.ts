/**
 * Cacti and succulents at real size, rooted at the origin: columnar cacti with ribbed stems and
 * upturned arms, prickly pears of stacked pads, agave rosettes of arching leaves, barrel cacti.
 */
import type { MeshPart, PropMesh, Vec3 } from '../../plan/contract.ts';
import {
  between,
  card,
  deform,
  lathe,
  meshPart,
  prop,
  sphere,
  transform,
  tube,
} from '../../props/index.ts';
import { DESERT, srgb } from './palette.ts';

const AGAVE = card('desert/agave', srgb(98, 132, 104), 0.6);

/** A ribbed column: `ribs` vertical folds on a lathe of the given profile. */
function ribbed(profile: readonly (readonly [number, number])[], ribs: number) {
  const stem = lathe(DESERT.cactus, profile, { segments: ribs * 4 });
  return deform(stem, ([x, y, z]) => {
    const fold = 1 + 0.08 * Math.abs(Math.cos((ribs / 2) * Math.atan2(z, x)));
    return [x * fold, y, z * fold];
  });
}

/** A stem profile of radius `r` and `height`: a slight waist at the root, a domed top. */
const stem = (r: number, height: number) =>
  Array.from({ length: 25 }, (_, i): readonly [number, number] => {
    const t = i / 24,
      top = t > 0.9 ? Math.sqrt(Math.max(0, 1 - ((t - 0.9) / 0.1) ** 2)) : 1;
    return [i === 24 ? 0 : r * (0.92 + 0.08 * Math.min(1, t * 8)) * top, height * t];
  });

/** A columnar cactus `height` metres high with `arms` upturned arms. */
export function columnar(id: string, height: number, arms: number, seed: number): PropMesh {
  const r = height * 0.045,
    parts: MeshPart[] = [ribbed(stem(r, height), 12)];
  for (let a = 0; a < arms; a++) {
    const angle = (a / arms) * Math.PI * 2 + between(seed, a, -0.4, 0.4),
      [dx, dz] = [Math.cos(angle), Math.sin(angle)],
      y0 = height * between(seed + 1, a, 0.35, 0.6),
      out = height * 0.16,
      up = height * between(seed + 2, a, 0.22, 0.38),
      // A quarter bend outward, then straight up to a rounded tip.
      path = Array.from({ length: 13 }, (_, i): Vec3 => {
        const t = i / 12,
          bend = Math.min(1, t * 2.2),
          reach = out * Math.sin((bend * Math.PI) / 2),
          rise =
            t < 0.45
              ? out * (1 - Math.cos((bend * Math.PI) / 2))
              : out + (up - out) * ((t - 0.45) / 0.55);
        return [dx * reach, y0 + rise, dz * reach];
      });
    parts.push(
      tube(
        DESERT.cactus,
        path,
        path.map((_, i) => r * (i === 12 ? 0.35 : 0.7)),
        { segments: 24, caps: true },
      ),
    );
  }
  return prop(id, parts);
}

/** A prickly pear: flat oval pads, each growing from the rim of the one below. */
export function pricklyPear(id: string, seed: number): PropMesh {
  const pads: MeshPart[] = [];
  const bud = (at: Vec3, yaw: number, depth: number, k: number) => {
    const size = 0.28 - depth * 0.04;
    pads.push(
      transform(sphere(DESERT.succulent, 1, { segments: 14, rings: 8 }), {
        at: [at[0], at[1] + size, at[2]],
        yaw,
        scale: [size * 0.8, size, 0.05],
      }),
    );
    if (depth < 3)
      for (let c = 0; c < 2; c++) {
        const a = yaw + between(seed, k * 4 + c, -0.9, 0.9);
        bud(
          [at[0] + Math.sin(a) * size * 0.7, at[1] + size * 1.7, at[2] + Math.cos(a) * size * 0.2],
          a,
          depth + 1,
          k * 4 + c + 1,
        );
      }
  };
  for (let s = 0; s < 3; s++)
    bud(
      [between(seed, 50 + s, -0.5, 0.5), 0, between(seed, 60 + s, -0.5, 0.5)],
      s * 2.1,
      0,
      s * 20,
    );
  return prop(id, pads);
}

/** A rosette of `leaves` stiff leaves arching out, `size` metres across, each a curved strip. */
export function agave(id: string, size: number, leaves: number, seed: number): PropMesh {
  const positions: number[] = [],
    indices: number[] = [],
    steps = 8;
  for (let i = 0; i < leaves; i++) {
    const angle = i * 2.39996 + between(seed, i, -0.1, 0.1),
      rise = 1.25 - 0.9 * ((i % 9) / 9),
      length = size * (0.4 + 0.2 * ((i % 9) / 9)),
      [dx, dz] = [Math.cos(angle), Math.sin(angle)],
      first = positions.length / 3;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps,
        // Rising at `rise` rad, drooping as it reaches out; tapering to a spine.
        a = rise - 0.8 * t * t,
        reach = length * t * Math.cos(a * 0.6),
        y = 0.05 + length * t * Math.sin(a) * 0.9,
        w = length * 0.09 * (1 - t) * (t < 0.15 ? 0.6 + t * 2.6 : 1);
      for (const side of [-1, 1])
        positions.push(dx * reach - dz * w * side, y, dz * reach + dx * w * side);
    }
    for (let s = 0; s < steps; s++) {
      const q = first + s * 2;
      indices.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
    }
  }
  return prop(id, [meshPart(AGAVE, positions, indices)]);
}

/** A barrel cactus: a ribbed squat globe. */
export const barrel = (id: string) =>
  prop(id, [
    ribbed(
      Array.from({ length: 13 }, (_, i): readonly [number, number] => {
        const a = (Math.PI / 2) * (i / 12);
        return [i === 12 ? 0 : 0.34 + 0.06 * Math.sin(a * 2), 0.72 * Math.sin(a)];
      }),
      20,
    ),
  ]);
