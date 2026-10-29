import { rowFlags } from '../../geometry/rows/surfaceRow.ts'
import type { GeometryBlock } from '../../geometry/rows/page/pageRowMaterial.ts'
import type { WebgpuPagesRuntime } from '../../frame/backend/runtime.ts'
import { graphClassKey } from '../../materials/graph/surfaceClasses.ts'
import { materialWord } from '../../materials/table/materialTable.ts'
import { PT_NO_CLASS, PT_PLACEMENT_WORDS } from './traceBounceWgsl.ts'
import { PT_PASS_ROUNDS } from './viewWgsl.ts'

/** What the path tracer shades its hits with: the table of the surfaces the placements wear (`PT_PLACEMENT_WORDS` a placement, in the order of the cut's roots), and the class keys the image shades
 *  (`rowFlags`'s resolve classes), each at its number in the table. */
export interface HitPlacements {
  readonly words: Uint32Array<ArrayBuffer>
  readonly classes: ReadonlySet<number>
  /** The rounds a bounce takes after its own: `PT_PASS_ROUNDS` while a surface of the scene may let a ray through (a material opacity under one), none otherwise, so that a scene of opaque surfaces encodes nothing for them. */
  readonly passRounds: number
}

/** The geometry a triangle with corner attributes has, as the resolve's rows say it: a texture coordinate and a normal, no stored tangent, the vertex colour where the surface reads it. */
const attributed = (colours: boolean): GeometryBlock => ({
  vertexBase: 0,
  count: 0,
  hasUv: true,
  hasNormal: true,
  hasTangent: false,
  hasColor: colours,
})

/**
 * THE SURFACES THE HITS ARE SHADED WITH: for each root of the cut (`layout.selectionRoots`, a placement's rank), the record its surface has in the material table (`materialWord`), and for a triangle
 * with corner attributes and one without, the row flags and the resolve class key its surface has on such geometry (`rowFlags`: the class of a triangle without attributes reads no texture coordinate, normal or
 * colour). A root that wears no surface has none: its hits are given the tracer's default surface (`PT_NO_CLASS`). A blended surface's graph is shaded by its own program (the one its record holds the
 * values of): its class is the graph's over the features, where the resolve gives it the features' alone since it draws no blended surface.
 */
export function hitPlacementsOf(rt: WebgpuPagesRuntime): HitPlacements {
  const roots = rt.layout.selectionRoots
  const words = new Uint32Array(Math.max(roots.length, 1) * PT_PLACEMENT_WORDS).fill(PT_NO_CLASS)
  const classes = new Set<number>()
  let translucent = false
  roots.forEach((root, placement) => {
    const surface = root.worn?.surface
    if (!surface) return
    const seen = rt.vis.materialTable.surface(surface, rt.vis)
    const at = placement * PT_PLACEMENT_WORDS
    const colours = !!surface.vertexColors
    const withAttributes = rowFlags(seen.row, attributed(colours), rt.vis.textures)
    const without = rowFlags(seen.row, undefined, rt.vis.textures)
    const program = seen.row.graph?.kind === 'blend' ? seen.row.graph : undefined
    translucent ||= surface.opacity < 1 || !!program?.compiled.functions.opacity
    const classOf = (features: number) => (program && graphClassKey(program, features)) || features
    const withClass = classOf(withAttributes.classKey)
    const withoutClass = classOf(without.classKey)
    words[at] = materialWord(seen.rank, false)
    words[at + 1] = withAttributes.flags
    words[at + 2] = without.flags
    words[at + 3] = withClass
    words[at + 4] = withoutClass
    classes.add(withClass).add(withoutClass)
  })
  // The census of the resolve keeps these classes from release while the tracer places them.
  rt.vis.pathTracedClasses = [...classes]
  return { words, classes, passRounds: translucent ? PT_PASS_ROUNDS : 0 }
}
