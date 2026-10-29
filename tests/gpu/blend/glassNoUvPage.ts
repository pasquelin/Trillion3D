// Page of the glass-without-UV proof: a row of opaque meshes and a glass whose geometry carries no
// texture coordinates — a mesh the page made, the same wearing a picture, a compiled model's cubes
// (KHR transmission) —, opened together or the glass joining the running session. Generated scenes:
// no file of the site.
import { geometry } from '../../../packages/sdk-core/src/world/geometry/index.ts'
import { material } from '../../../packages/sdk-core/src/world/material/index.ts'
import { object } from '../../../packages/sdk-core/src/world/object/index.ts'
import { Texture } from '../../../packages/sdk-core/src/world/texture/texture.ts'
import { sessionOf } from '../../../packages/sdk-browser/src/session/world/session.ts'
import { changed, open, row, type World } from '../world/appendProof.ts'
import { crowdModel } from '../world/generatedModels.ts'

const opaque = material.meshStandard({ color: 0xb04a3a, roughness: 0.7 })
const glass = () =>
  material.meshPhysical({
    color: 0xd8e8ff,
    roughness: 0.1,
    transmission: 1,
    thickness: 0.5,
    ior: 1.5,
  })

/** The share of the captured pixels that are not the background's colour (the first pixel's). */
function covered(pixels: Uint8Array) {
  let drawn = 0
  for (let i = 0; i < pixels.length; i += 4)
    if (Math.abs(pixels[i] - pixels[0]) + Math.abs(pixels[i + 1] - pixels[1]) > 8) drawn++
  return drawn / (pixels.length / 4)
}

/** The glasses: a ball the page made, the same wearing a picture — the first the session's scene
 *  wears, so its texture feedback is turned on as the glass joins —, a compiled crowd of cubes. */
export const GLASSES = ['ball', 'pictured ball', 'model'] as const
type Glass = (typeof GLASSES)[number]

/** Adds the glass `kind` to `world`, none of its vertices with texture coordinates. */
async function addGlass(world: World, kind: Glass) {
  if (kind === 'model') {
    const transmission = { KHR_materials_transmission: { transmissionFactor: 1 } }
    const url = crowdModel('glass-crowd', 3, 2, [0.85, 0.9, 1, 1], undefined, {
      extensions: transmission,
    })
    const model = await world.scene.load(url)
    model.position.set(0, 0, 1)
    return
  }
  const shape = geometry.sphere(0.8, 24, 16)
  shape.deleteAttribute('uv')
  const paint = glass()
  if (kind === 'pictured ball')
    paint.map = new Texture({ data: new Uint8Array(8 * 8 * 4).fill(200), width: 8, height: 8 })
  const mesh = object.mesh(shape, paint)
  mesh.position.set(0, 0.8, 1)
  world.scene.add(mesh)
}

/** The covered share of a world drawing the opaque row and the glass `kind`, opened on both
 *  (`together`) or the glass joining it. */
async function read(kind: Glass, together: boolean) {
  const { world, close } = open()
  try {
    await world.ready
    // The coverage is a threshold on the colours: an automatic exposure, converged to a few
    // thousandths of a stop apart in two worlds, moves pixels across it.
    world.exposure = 1
    row(world, geometry.box(0.9, 0.9, 0.9), opaque, -1)
    if (together) await addGlass(world, kind)
    const before = await changed(world, '')
    if (!together) {
      await addGlass(world, kind)
      await changed(world, before)
    }
    return covered(new Uint8Array(await sessionOf(world).capture()))
  } finally {
    close()
  }
}

export async function run() {
  const errors: string[] = []
  try {
    const shares: Record<string, number> = {}
    for (const kind of GLASSES)
      for (const together of [true, false])
        shares[`${kind}${together ? '' : ' joined'}`] = await read(kind, together)
    return { shares, errors }
  } catch (error) {
    return { error: error instanceof Error ? error.stack : String(error), errors }
  }
}
