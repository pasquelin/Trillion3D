/**
 * What the WebGL2 cluster renderer and the impostor card draw share (#1336): the pass a card draws
 * in and the draw's call. Kept apart from the draw, so the renderer — the core — loads none of the
 * card's code, which the impostor family brings (`code.ts`).
 */
import type { HostDrawCamera } from '../../camera/world.ts'
import type { WebglClusterLights } from '../cluster/lights.ts'

/** What the card program reads of the pass it draws in: the cluster program's output and
 *  reflection switches there (`../cluster/renderer.ts`). */
export type CardPass = {
  toneMapped: boolean
  srgbDestination: boolean
  /** The mirror capture pass; the screen reflections read; their reduced image resolved. */
  capture: boolean
  reflections: boolean
  resolve: boolean
  /** The display curve's rank (`TONE_MAPPING_RANK`). */
  toneCurve: number
}
/** The switches a pass of the cluster program sets, those it leaves out off. */
export type CardSwitches = Partial<
  Pick<CardPass, 'toneMapped' | 'srgbDestination' | 'capture' | 'reflections'>
>
const OFF = { toneMapped: false, srgbDestination: false, capture: false, reflections: false }
/** The one pass a card draw reads, written again for each: its switches `on`, the frame's curve and
 *  whether it resolved its reflections. */
const PASS = { ...OFF, resolve: false, toneCurve: 0 }
export const cardPassOf = (toneCurve: number, resolve: boolean, on: CardSwitches): CardPass =>
  Object.assign(PASS, OFF, on, { toneCurve, resolve })

/** The image's card draw as the WebGL2 renderer calls it, in each pass its clusters draw in, lit by
 *  the lights the renderer uploaded for them; false when it drew nothing. */
export type WebglCards = (
  camera: HostDrawCamera,
  lights: WebglClusterLights,
  pass: CardPass,
  linear: boolean,
) => boolean
