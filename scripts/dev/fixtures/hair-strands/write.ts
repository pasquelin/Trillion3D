import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { HairStrandsExample } from './model.ts'

/** A number to the micrometre, as short as it reads. */
const metres = (value: number) => {
  const rounded = Math.round(value * 1e6) / 1e6
  return rounded === 0 ? '0' : String(rounded)
}

/** `(x, y, z), …` for a flat list of triples. */
function triples(values: readonly number[]) {
  const out: string[] = []
  for (let i = 0; i < values.length; i += 3)
    out.push(`(${metres(values[i]!)}, ${metres(values[i + 1]!)}, ${metres(values[i + 2]!)})`)
  return `[${out.join(', ')}]`
}

/** The example as a USD text file: the scalp as a mesh and the strands as one linear `BasisCurves`
 *  with a width at each point. */
export function hairStrandsUsda({ counts, points, widths, scalp }: HairStrandsExample) {
  const faceCounts = Array.from({ length: scalp.indices.length / 3 }, () => 3)
  return `#usda 1.0
(
    defaultPrim = "Root"
    metersPerUnit = 1
    upAxis = "Y"
)

def Xform "Root"
{
    def Mesh "Scalp"
    {
        int[] faceVertexCounts = [${faceCounts.join(', ')}]
        int[] faceVertexIndices = [${scalp.indices.join(', ')}]
        normal3f[] normals = ${triples(scalp.normals)} (
            interpolation = "vertex"
        )
        point3f[] points = ${triples(scalp.points)}
        uniform token subdivisionScheme = "none"
    }

    def BasisCurves "Hair"
    {
        uniform token type = "linear"
        int[] curveVertexCounts = [${counts.join(', ')}]
        point3f[] points = ${triples(points)}
        float[] widths = [${widths.map(metres).join(', ')}] (
            interpolation = "vertex"
        )
    }
}
`
}

/** Writes the example's source, `hair.usda`, into `directory`. */
export async function writeHairStrands(directory: string, example: HairStrandsExample) {
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, 'hair.usda'), hairStrandsUsda(example))
}
