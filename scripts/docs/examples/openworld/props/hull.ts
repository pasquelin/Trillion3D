/**
 * A ship's hull as a loft of sections from the transom (−Z) to the stem (+Z): a flat deck,
 * round bilges, a fine bow that rises with the sheer. Origin on the waterline at mid-length.
 */
import type { MeshPart, Surface, Vec3 } from '../plan/contract.ts';
import { loft } from './round.ts';

export type HullShape = {
  length: number;
  beam: number;
  draft: number;
  freeboard: number;
  /** Section points around, and sections along. */
  around?: number;
  along?: number;
  /** Bilge fullness: 0.5 a wine-glass yacht, 0.9 a box-like freighter. */
  fullness?: number;
};

export function hull(surface: Surface, shape: HullShape): MeshPart {
  const { length, beam, draft, freeboard, around = 40, along = 60, fullness = 0.6 } = shape,
    rings = Array.from({ length: along + 1 }, (_, s) => {
      const t = s / along,
        bow = Math.max(0, (t - 0.5) / 0.5),
        half =
          (beam / 2) *
          Math.max(0.015, Math.pow(1 - bow * bow, 0.75)) *
          (t < 0.08 ? 0.88 + 1.5 * t : 1),
        deep = draft * (1 - 0.35 * bow * bow),
        deck = freeboard * (1 + 0.35 * bow * bow),
        z = length * (t - 0.5);
      // Around the section from the deck's centre line: port, keel, starboard (see `loft`).
      return Array.from({ length: around }, (_, k): Vec3 => {
        const a = (2 * Math.PI * k) / around,
          c = Math.cos(a),
          sn = Math.sin(a);
        return [
          half * Math.sign(sn) * Math.pow(Math.abs(sn), 1 - fullness * 0.6),
          c >= 0 ? deck * Math.pow(c, 0.05) : -deep * Math.pow(-c, fullness),
          z,
        ];
      });
    });
  return loft(surface, rings, { caps: true });
}
