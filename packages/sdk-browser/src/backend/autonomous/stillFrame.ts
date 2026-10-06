import type { PageRec } from '../../page/selection/selection.ts'

/**
 * Whether a frame the gate held is the still frame a page waits for (`frameHeld`): as on WebGPU
 * (`../../webgpu/frame/hold.ts`, nothing pending), not while a page the view asks for is still
 * awaited — its arrival will change the image. A capture after a moving camera held the first
 * frame whose cut had not moved, pages missing, and its A/A drew what each run had loaded.
 */
export const stillFrame = (requested: readonly Pick<PageRec, 'array'>[]) =>
  requested.every((rec) => !!rec.array)
