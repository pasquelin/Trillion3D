import {
  CLOSURE_OUTPUTS,
  type ClosureNode,
  type ClosureOutput,
  type Operand,
} from '../../../../sdk-core/src/world/material/graph/closures.ts'
import type { Pin } from '../../../../sdk-core/src/world/material/graph/graph.ts'
import {
  GRAPH_OUTPUTS,
  type GraphOutput,
} from '../../../../sdk-core/src/world/material/graph/outputs.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { SRGB_LUMINANCE } from '../../../../math/src/color/color.ts'

/**
 * THE PARAMETER BLENDING OF A BLENDED CLOSURE: a subtree of the closure tree that does not fit the pixel's closures is mixed into
 * one closure, its parameters combined operator by operator as the reference's blending of two closures does, deepest first
 * (the horizontal mix, the add, the vertical layering, the weight), each node giving a
 * coverage and the parameters weighed by it. The parameters mixed are those of our slabs: the base colour, the metalness, the
 * specular, the roughness, the emission, the occlusion and the normal (in the tangent space); the lobes (the anisotropy, the coat, the
 * cloth, the subsurface colour) are those of the subtree's first slab. The slabs carry no mean free path nor thickness, so a top is
 * an opaque slab: its transmittance is zero (the reference's slab transmittance of the layering, Substrate.ush:3225, with no medium), the
 * base shows only where the top is absent (SurfaceBottom, ShadingCommon.ush:233) and the top adds no scattered albedo.
 *
 * The add follows the reference's rule per quantity: the quantities that add light are summed, the others
 * are mixed by the share. The emission is summed; the diffuse albedo, F0 and F90 are summed and held to one, in the reference's own
 * quantities: each slab's (base colour, metalness, specular) is taken to them as the reference's conversion does:
 * diffuse albedo = base colour x (1 - metalness), F0 = lerp(0.08 x specular, base colour, metalness)
 * (F90 = 1, which has nothing to bake into F0), the sum of the
 * albedos and of the F0s is held to one (F90 stays one), and the result is brought back to (base, metalness, specular). That
 * inverse is exact where the sum can be written so, as the sum of dielectrics (a grey F0 up to the specular's most), of metals (no
 * albedo), of a metal and a dielectric of the same hue; our three scalars have five degrees of freedom to the two colours' six, so
 * elsewhere it is the nearest that holds the F0 and the albedo together: the metalness is the share of the F0's colour part against
 * the albedo, the base colour the sum of the albedo and of what the metal gives the F0, the specular the grey the rest of the F0 leaves.
 * The metalness (of the sum, no longer mixed), the roughness, the occlusion and the normal otherwise: mixed.
 */
const FIELD_NAMES: Partial<Record<ClosureOutput, string>> = {
  baseColor: 'base',
  metallic: 'metal',
  specular: 'spec',
  roughness: 'rough',
  emissive: 'emissive',
  ambientOcclusion: 'ao',
  normal: 'normal',
}

/** The fields a blend mixes: the closure outputs named above, with the type of the outputs' catalogue. */
export const BLEND_FIELDS = CLOSURE_OUTPUTS.filter((output) => output in FIELD_NAMES).map(
  (output) => [FIELD_NAMES[output]!, output, GRAPH_OUTPUTS[output].type] as const,
)

const FIELD_OF = new Map<GraphOutput, string>(
  BLEND_FIELDS.map(([field, output]) => [output, field]),
)

/** The field of the blended structure an output is mixed in, none for an output taken from the first slab. */
export const blendFieldOf = (name: GraphOutput) => FIELD_OF.get(name)

/** The name of the structure of a blend. */
const structOf = (suffix: string) => `MgBlend${suffix}`

/** The structure a blend gives: the fields above, and the closure's coverage. */
export const blendStruct = (suffix: string) =>
  `struct ${structOf(suffix)}{${BLEND_FIELDS.map(([field, , type]) => `${field}:${type === 'f3' ? 'vec3f' : 'f32'},`).join('')}cov:f32,}`

/** The smallest sum a coverage ratio divides by. */
const EPSILON = '1e-10'

/** What the blend of one subtree is written over. */
export interface BlendNames {
  /** The code of the attribute `name` of the slab `slab` at the pixel: its call, or the output's fallback where the slab wires none. */
  readonly attribute: (slab: number, name: GraphOutput) => string
  /** The call of the scalar an operand reads. */
  readonly operand: (pin: Pin) => string
}

/** How an operator combines one field of its two children `a` and `b` (the code of their structures), given the share of `a`. */
type Rule = (field: string, a: string, b: string, t: string) => string

const lerp: Rule = (field, a, b, t) => `mix(${b}.${field},${a}.${field},${t})`
/** The add's rule per field: summed where the quantity adds light, mixed otherwise; the base colour,
 *  the metalness and the specular are the inverse of the summed albedo and F0 (`addReflectance`). */
const ADD_RULES: Record<string, Rule> = {
  emissive: (field, a, b) => `${a}.${field}+${b}.${field}`,
}

/** The metal-to-dielectric reflectance of a unit specular (the dielectric specular to F0). */
const DIELECTRIC_F0 = '0.08'
const LUMA = `vec3f(${SRGB_LUMINANCE.join(',')})`

/**
 * The lines of an add's reflectance, `id` its node, `a` and `b` its children: the diffuse albedo D and the F0 K of each (base x (1 - metal),
 * mix(0.08 x specular, base, metal)) summed and saturated, then the base colour, the metalness and the
 * specular that give them back; the locals `ab`, `am` and `sp` of `id` hold the three.
 *
 * A slab is D = (1 - m) base and K = (1 - m) f + m base, with f the dielectric's grey: K = c D + g with c = m / (1 - m) and
 * g = (1 - m) f, so the pair is found by the two scalars c and g that fit K by D and the grey (least squares, exact when K
 * lies in their plane: a dielectric, a metal, a metal and a dielectric of the same hue); where D is grey or null the plane is a line
 * and the metal share is the K's colour part against D, the grey the K's least channel (at most the dielectric's). Then m = c / (1 + c),
 * base = D + K - g (both of D = (1 - m) base and K - g = m base hold), f = g (1 + c), the specular f / 0.08.
 */
function addReflectance(id: number, a: string, b: string) {
  const [d, k, dd, du, dk, uk, det, c, g] = [
    'dd',
    'kk',
    'dq',
    'du',
    'dk',
    'uk',
    'dt',
    'kc',
    'kg',
  ].map((n) => `${n}${id}`)
  const [metal, base] = [`am${id}`, `ab${id}`]
  const albedo = (s: string) => `${s}.base*(1.0-${s}.metal)`
  const reflect = (s: string) => `mix(vec3f(${DIELECTRIC_F0}*${s}.spec),${s}.base,${s}.metal)`
  const grey = `min(min(${k}.x,min(${k}.y,${k}.z)),${DIELECTRIC_F0})`
  return [
    `let ${d}=saturate(${albedo(a)}+${albedo(b)});`,
    `let ${k}=saturate(${reflect(a)}+${reflect(b)});`,
    `let ${dd}=dot(${d},${d});`,
    `let ${du}=${d}.x+${d}.y+${d}.z;`,
    `let ${dk}=dot(${d},${k});`,
    `let ${uk}=${k}.x+${k}.y+${k}.z;`,
    `let ${det}=3.0*${dd}-${du}*${du};`,
    `let ${c}=select(dot(${k}-vec3f(${grey}),${LUMA})/max(${EPSILON},dot(${d},${LUMA})),max(0.0,(3.0*${dk}-${du}*${uk})/${det}),${det}>1e-4*${dd});`,
    `let ${g}=select(${grey}/(1.0+${c}),max(0.0,(${dd}*${uk}-${du}*${dk})/${det}),${det}>1e-4*${dd});`,
    `let ${metal}=${c}/(1.0+${c});`,
    `let ${base}=saturate(${d}+${k}-vec3f(${g}));`,
    `let sp${id}=saturate(${g}*(1.0+${c})/${DIELECTRIC_F0});`,
  ]
}

/**
 * The lines of the function that blends the subtree rooted at `root` of `nodes`, over the structure `MgBlend` of `suffix`: each node a
 * local, each leaf its slab's attributes (an unwired one its fallback) with a coverage of one. A horizontal mix and an add mix their
 * children's parameters by their normalised coverages (the foreground's share of the mix, a child's of the sum), a weight scales the
 * coverage, a vertical layering weighs the top by its coverage and the base by what the top leaves uncovered (Substrate.ush:3233-3235).
 */
export function blendBody(
  nodes: readonly ClosureNode[],
  root: number,
  names: BlendNames,
  suffix: string,
) {
  const lines: string[] = []
  const T = structOf(suffix)
  const operand = (value: Operand) =>
    typeof value === 'number' ? wgslF32(value) : names.operand(value)
  /** The structure of a node, its fields by `rule`, the normal made a unit one (the plane's where the mix cancels). */
  const combine = (id: number, cov: string, rule: (field: string) => string) => {
    const fields = BLEND_FIELDS.map(([field]) => {
      const code = rule(field)
      if (field !== 'normal') return code
      lines.push(`let n${id}=${code};`)
      return `select(vec3f(0.0,0.0,1.0),n${id}/length(n${id}),dot(n${id},n${id})>1e-8)`
    })
    lines.push(`let b${id}=${T}(${fields.join(',')},${cov});`)
  }
  const visit = (id: number): string => {
    const node = nodes[id]
    const here = `b${id}`
    switch (node.kind) {
      case 'slab': {
        const field = BLEND_FIELDS.map(([, output]) => names.attribute(id, output))
        lines.push(`let ${here}=${T}(${field.join(',')},1.0);`)
        break
      }
      case 'weight': {
        const input = visit(node.input)
        lines.push(
          `var ${here}=${input};`,
          `${here}.cov=${input}.cov*saturate(${operand(node.weight)});`,
        )
        break
      }
      case 'horizontal': {
        const back = visit(node.background),
          fore = visit(node.foreground)
        lines.push(
          `let m${id}=saturate(${operand(node.mix)});`,
          `let f${id}=saturate(${fore}.cov)*m${id}/max(${EPSILON},saturate(${fore}.cov)*m${id}+saturate(${back}.cov)*(1.0-m${id}));`,
        )
        combine(id, `mix(${back}.cov,${fore}.cov,m${id})`, (field) =>
          lerp(field, fore, back, `f${id}`),
        )
        break
      }
      case 'add': {
        const a = visit(node.a),
          b = visit(node.b)
        lines.push(
          `let f${id}=saturate(${a}.cov)/max(${EPSILON},saturate(${a}.cov)+saturate(${b}.cov));`,
        )
        lines.push(...addReflectance(id, a, b))
        const reflectance: Record<string, string> = {
          base: `ab${id}`,
          metal: `am${id}`,
          spec: `sp${id}`,
        }
        combine(
          id,
          `saturate(${b}.cov+${a}.cov)`,
          (field) => reflectance[field] ?? (ADD_RULES[field] ?? lerp)(field, a, b, `f${id}`),
        )
        break
      }
      case 'vertical': {
        const top = visit(node.top),
          base = visit(node.base)
        const [tc, bc, cov, bottom, topFactor] = ['tc', 'bc', 'cv', 'bf', 'tf'].map(
          (n) => `${n}${id}`,
        )
        lines.push(
          `let ${tc}=saturate(${top}.cov);`,
          `let ${bc}=saturate(${base}.cov);`,
          `let ${cov}=${tc}+(1.0-${tc})*${bc};`,
          `let ${bottom}=(1.0-${tc})*${bc}/max(${EPSILON},${cov});`,
          `let ${topFactor}=${tc}/max(${EPSILON},${cov});`,
        )
        const weighed = (f: string) => `${bottom}*${base}.${f}+${topFactor}*${top}.${f}`
        combine(id, cov, (f) =>
          f === 'base'
            ? `saturate(${weighed(f)})`
            : f === 'emissive'
              ? weighed(f)
              : f === 'normal'
                ? `mix(${base}.normal,${top}.normal,${tc}*0.5)`
                : `mix(${top}.${f},${base}.${f},saturate(${bottom}))`,
        )
        break
      }
    }
    return here
  }
  const result = visit(root)
  return `${lines.join('\n ')}\n return ${result};`
}
