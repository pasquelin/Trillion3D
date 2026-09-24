/**
 * Runway designator characters, 9 m tall and 4.5 m wide, painted as strokes of 1.2 m: the ten
 * digits on a seven-segment cell, and the L, C, R of parallel runways. The top of a character
 * points along +Z; its foot is at z = 0. Seen by a pilot flying along +Z, right is −X, so the
 * cell is drawn with its right-hand segments at negative x.
 */
import type { MeshPart, Surface } from '../../plan/contract.ts';
import { plane, transform } from '../../props/index.ts';
import { stripe } from './parts.ts';

const W = 4.5,
  H = 9,
  S = 1.2;

/** Segments a–g: top, upper right, lower right, bottom, lower left, upper left, middle. */
const SEGMENTS: Record<string, [number, number, number, number]> = {
  a: [0, H - S / 2, W, S],
  b: [-W / 2 + S / 2, (H * 3) / 4, S, H / 2],
  c: [-W / 2 + S / 2, H / 4, S, H / 2],
  d: [0, S / 2, W, S],
  e: [W / 2 - S / 2, H / 4, S, H / 2],
  f: [W / 2 - S / 2, (H * 3) / 4, S, H / 2],
  g: [0, H / 2, W, S],
};

const CHARACTERS: Record<string, string> = {
  '0': 'abcdef',
  '1': 'bc',
  '2': 'abged',
  '3': 'abgcd',
  '4': 'fgbc',
  '5': 'afgcd',
  '6': 'afgedc',
  '7': 'abc',
  '8': 'abcdefg',
  '9': 'abcdfg',
  L: 'fed',
  C: 'afed',
  R: 'abfeg',
};

/** The strokes of one character; R adds its leg from the middle to the lower right. */
export function glyph(surface: Surface, character: string): MeshPart[] {
  const segments = CHARACTERS[character];
  if (!segments) throw new Error(`airport: no glyph for "${character}"`);
  const strokes = [...segments].map((name) => {
    const [x, z, w, l] = SEGMENTS[name];
    return stripe(surface, x, z, w, l);
  });
  if (character === 'R') {
    const leg = Math.hypot(W / 2, H / 2);
    strokes.push(
      transform(plane(surface, S, leg), {
        at: [-W / 4, 0, H / 4],
        yaw: Math.atan2(-W / 2, -H / 2),
      }),
    );
  }
  return strokes;
}
