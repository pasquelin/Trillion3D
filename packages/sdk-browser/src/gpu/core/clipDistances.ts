import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { CUT_RULES } from '../../../../sdk-core/src/contracts/cutOptions.ts'
import {
  readSetting,
  type SettingOptions,
} from '../../../../sdk-core/src/contracts/settingRules.ts'

/**
 * THE CLIP DISTANCE OF A VIEW'S PLANE (`Camera.clipPlane`), written by every vertex stage that draws
 * the scene's geometry: the signed distance of the vertex's world position to the plane, `dot(xyz,
 * p) + w` against the plane the stage's uniform holds — a view without a plane holds all zeros,
 * and a distance of zero is kept —, which the rasterizer cuts the primitive at.
 *
 * ONE PROJECT SWITCH decides it for every program, once (`clippingFor`): `cutClipPlane`, off by
 * default, is read when the session opens, as the reference's read-only switch is read when its
 * shaders are compiled; changing it later changes nothing. Off, no program holds any of the code
 * below. On, every program that draws the scene's geometry is made with it (`Clipping`), a view that
 * has no plane holding a zero plane, whose distance of zero is kept. There is no second set of
 * programs for the views that have a plane.
 *
 * Where the device grants `clip-distances` the stage writes the distance as the builtin of that
 * name, the hardware clipping the primitive exactly. WGSL gives that builtin to a vertex stage's
 * OUTPUT alone, so the stage returns a struct of its own (`clippedStructText`) and the fragment
 * stage keeps its input struct. Where it does not, the fragment stage tests the distance of its
 * pixel and discards the pixel behind the plane — the one coverage the clipped primitive would
 * have, a pixel centre being kept where the distance, linear along the primitive, is at least
 * zero: from the world position the stage already interpolates, or from one more interpolant where
 * it has none.
 */

/**
 * How a module cuts at the view's plane, when the project switch is on: `distance`, the vertex
 * stage returns the clip distance and the hardware clips (a device with the `clip-distances`
 * feature); `pixel`, each fragment leaves its pixel behind the plane (a device without it). A
 * module made with neither holds none of the code.
 */
export type Clipping = 'distance' | 'pixel'

/** Whether `device` was granted the `clip-distances` feature (`../../session/gpuDevice.ts`). */
const hasClipDistances = (device: GPUDevice) => device.features?.has('clip-distances') === true

/** The way `device` cuts at a plane (`Clipping`). */
const clippingOf = (device: GPUDevice): Clipping =>
  hasClipDistances(device) ? 'distance' : 'pixel'

/** How the programs of a session cut at a view's plane: none while the project switch
 *  `cutClipPlane` its context holds is off, else the device's way. Read once, when the session opens
 *  (`../../frame/prepare/setup.ts`). */
export const clippingFor = (
  context: SettingOptions<typeof CUT_RULES> & { readonly gpuDevice?: GPUDevice },
): Clipping | undefined =>
  context.gpuDevice && readSetting(CUT_RULES, context, 'cutClipPlane')
    ? clippingOf(context.gpuDevice)
    : undefined

/** The directive that turns the builtin on, in a module made for a device that has the feature. */
const CLIP_DISTANCES_WGSL = wgslBlock('CLIP_DISTANCES_WGSL', [], 'enable clip_distances;')

/** The declarations a module made with `clipping` lists for it: the directive, where the way is the
 *  distance. */
export const clipDirective = (clipping?: Clipping) =>
  clipping === 'distance' ? [CLIP_DISTANCES_WGSL] : []

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

/** What a vertex stage of the struct `name` returns, in a module made with `clipping`: the struct
 *  that carries the clip distance (`clippedStructText`) where the way is the distance, else `name`. */
export const clipReturnType = (name: string, clipping?: Clipping) =>
  clipping === 'distance' ? `${name}Clipped` : name

/** The vertex stage's `value`, a `name`, as it is returned: with the distance `d` where the way is
 *  the distance (`clippedStructText`), as it is otherwise. */
export const clipReturn = (
  name: string,
  clipping: Clipping | undefined,
  value: string,
  d: string,
) => (clipping === 'distance' ? `${name}WithClip(${value},${d})` : value)

/**
 * `code` with `guard` made the first statement of every fragment entry that takes the vertex
 * struct `struct` as its input `in`, in a module that cuts by pixel: the pixel test of a device
 * without clip distances, written once for the many entries a module holds (the blend's lit,
 * covered, transmissive and distorting ones) instead of once in each. As it is for the other ways.
 */
export const cutByPixel = (code: string, struct: string, guard: string, clipping?: Clipping) =>
  clipping === 'pixel'
    ? code.replace(
        new RegExp(`(@fragment fn \\w+\\(in:\\s*${struct}\\b[^{]*\\{)`, 'g'),
        `$1\n ${guard}`,
      )
    : code
