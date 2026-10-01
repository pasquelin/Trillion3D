/**
 * What the WebGL2 cluster renderer and the impostor card draw share (#1336): the pass a card draws
 * in and the draw's call. Kept apart from the draw, so the renderer — the core — loads none of the
 * card's code, which the impostor family brings (`code.ts`).
 */
import type { HostDrawCamera } from '../../camera/world.ts';
import type { WebglClusterScene } from '../cluster/lights.ts';

/** What the card program reads of the pass it draws in: the cluster program's output and
 *  reflection switches there (`../cluster/renderer.ts`). */
export type CardPass = {
  toneMapped: boolean;
  srgbDestination: boolean;
  /** The mirror capture pass; the screen reflections read; their reduced image resolved. */
  capture: boolean;
  reflections: boolean;
  resolve: boolean;
  /** The display curve's rank (`TONE_MAPPING_RANK`). */
  toneCurve: number;
};
/** The switches a pass of the cluster program sets: the output's curve and encoding, the mirror
 *  capture, the screen reflections. */
export type CardSwitches = [
  toneMapped: boolean,
  srgbDestination: boolean,
  capture: boolean,
  reflections: boolean,
];
export const cardPass = (
  toneCurve: number,
  resolve: boolean,
  ...[toneMapped, srgbDestination, capture, reflections]: CardSwitches
): CardPass => ({ toneMapped, srgbDestination, capture, reflections, resolve, toneCurve });

/** The image's card draw as the WebGL2 renderer calls it, in each pass its clusters draw in; false
 *  when it drew nothing. */
export type WebglCards = (
  camera: HostDrawCamera,
  scene: WebglClusterScene,
  pass: CardPass,
  linear: boolean,
) => boolean;
