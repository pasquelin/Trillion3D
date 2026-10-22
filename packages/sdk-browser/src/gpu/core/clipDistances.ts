import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE CLIP DISTANCE OF A VIEW'S PLANE (`Camera.clipPlane`), written by every vertex stage that draws
 * the scene's geometry: the signed distance of the vertex's world position to the plane, `dot(xyz,
 * p) + w` against the plane the stage's uniform holds — a view without a plane holds all zeros,
 * and a distance of zero is kept —, which the rasterizer cuts the primitive at.
 *
 * Where the device grants `clip-distances` the stage writes it as the builtin of that name, the
 * hardware clipping the primitive exactly. WGSL gives that builtin to a vertex stage's OUTPUT alone,
 * so the stage returns a struct of its own (`clippedStructText`) and the fragment stage keeps its
 * input struct. Where it does not, the fragment stage tests the distance of its pixel and discards
 * the pixel behind the plane — the one coverage the clipped primitive would have, a pixel centre
 * being kept where the distance, linear along the primitive, is at least zero: from the world
 * position the stage already interpolates, or from one more interpolant where it has none.
 */

/** Whether `device` was granted the `clip-distances` feature (`../../session/gpuDevice.ts`). */
export const hasClipDistances = (device: GPUDevice) =>
  device.features?.has('clip-distances') === true

/** The directive that turns the builtin on, in a module made for a device that has the feature. */
export const CLIP_DISTANCES_WGSL = wgslBlock('CLIP_DISTANCES_WGSL', [], 'enable clip_distances;')

/** The name a member's text declares: the word before its colon. */
const nameOf = (member: string) => /(\w+)\s*:/.exec(member)![1]

/**
 * The output struct of a vertex stage on a device with the feature: the `members` of the struct
 * `name` — each as written inside it —, then `clip_distances`, named `${name}Clipped`, and the
 * function `${name}WithClip(out, distance)` that makes one of a `name` and the distance.
 */
export function clippedStructText(name: string, members: readonly string[]) {
  const clipped = `${name}Clipped`,
    copies = members.map((member) => `c.${nameOf(member)}=o.${nameOf(member)};`).join('')
  return `struct ${clipped}{${members.join(',')},@builtin(clip_distances) clipDistances:array<f32,1>,}
fn ${name}WithClip(o:${name},d:f32)->${clipped}{var c:${clipped};${copies}c.clipDistances[0]=d;return c;}`
}

/**
 * `code` with `guard` made the first statement of every fragment entry that takes the vertex
 * struct `struct` as its input `in`: the pixel test of a device without clip distances, written
 * once for the many entries a module holds (the blend's lit, covered, transmissive and distorting
 * ones) instead of once in each.
 */
export const guardedFragments = (code: string, struct: string, guard: string) =>
  code.replace(
    new RegExp(`(@fragment fn \\w+\\(in:\\s*${struct}\\b[^{]*\\{)`, 'g'),
    `$1\n ${guard}`,
  )
