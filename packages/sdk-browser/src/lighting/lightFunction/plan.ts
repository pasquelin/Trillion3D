import type { SceneLight } from '../../../../sdk-core/src/scene/light/contracts.ts'
import type { SceneLightStore } from '../../../../sdk-core/src/scene/light/store.ts'
import type { Material } from '../../../../sdk-core/src/world/material/material.ts'
import { writeDefaultEntry, writeEntry } from './entries.ts'
import { ENTRY_STEP, tableRows } from './layout.ts'
import { alignUp } from '../../../../math/src/scalar/integers.ts'

/** The atlas's shape: slots a side, a slot's texels a side, and the texture's side. */
export interface AtlasShape {
  readonly edge: number
  readonly slot: number
  readonly side: number
}

/** One material's slot in the atlas, by its place in the grid of slots. */
interface AtlasSlot {
  readonly material: Material
  readonly x: number
  readonly y: number
}

/** The plan of an image's light functions: the atlas's slots, each light's entry in the table (0 for
 *  none), and the table. */
export interface LightFunctionPlan {
  readonly slots: readonly AtlasSlot[]
  /** By the store's slot: the entry the light reads. */
  readonly entryOf: readonly number[]
  /** The table's floats, its entries a multiple of `ENTRY_STEP`, padded to whole rows of the atlas. */
  readonly table: Float32Array<ArrayBuffer>
  /** The rows of the atlas the table takes. */
  readonly rows: number
  /** Whether a limit left a light without its light function this image. */
  readonly skipped: number
}

type Wearer = { slot: number; light: SceneLight; material: Material; far: number }

/** The lights of `store` that wear a light function material that exists, in the store's order,
 *  each with its squared distance from `eye` (a sun's is 0: it is everywhere). */
function wearers(
  store: SceneLightStore,
  eye: ArrayLike<number>,
  materialOf: (id: string) => Material | undefined,
) {
  const found: Wearer[] = []
  for (let slot = 0; slot < store.count; slot++) {
    const light = store.light(store.ids[slot])
    const material =
      light?.lightFunction === undefined ? undefined : materialOf(light.lightFunction)
    if (!light || !material) continue
    let far = 0
    if (light.position) {
      const [x, y, z] = light.position
      far = (x - eye[0]) ** 2 + (y - eye[1]) ** 2 + (z - eye[2]) ** 2
    }
    found.push({ slot, light, material, far })
  }
  return found
}

/**
 * Plans an image's light functions. The lights that wear one are taken in the store's order, or,
 * when a limit leaves some out — the atlas holds fewer materials than the lights wear, or
 * `maxLights` is below their number —, nearest the eye first, a sun first of all. A light gets the
 * next entry of the table, counted from 1 (entry 0 is none, and counts as one against `maxLights`,
 * as in the reference); its material takes the next slot of the atlas, once however many lights wear
 * it, or, with no slot left, the light has none. A negative `maxLights` is no limit. `fogLocals`
 * says whether the volumetric fog's local lights read the functions (it is written in the table).
 */
export function planLightFunctions(
  store: SceneLightStore,
  shape: AtlasShape,
  maxLights: number,
  eye: ArrayLike<number>,
  fogLocals: boolean,
  materialOf: (id: string) => Material | undefined,
): LightFunctionPlan {
  const found = wearers(store, eye, materialOf)
  const limited =
    (maxLights >= 0 && found.length + 1 > maxLights) ||
    new Set(found.map((w) => w.material)).size > shape.edge * shape.edge
  if (limited) found.sort((a, b) => a.far - b.far)
  const slots: AtlasSlot[] = []
  const slotOf = new Map<Material, AtlasSlot>()
  const entryOf = new Array<number>(store.count).fill(0)
  const granted: { wearer: Wearer; slot: AtlasSlot }[] = []
  let skipped = 0
  for (const wearer of found) {
    if (maxLights >= 0 && granted.length + 1 >= maxLights) {
      skipped++
      continue
    }
    let slot = slotOf.get(wearer.material)
    if (!slot && slots.length < shape.edge * shape.edge) {
      slot = {
        material: wearer.material,
        x: slots.length % shape.edge,
        y: Math.floor(slots.length / shape.edge),
      }
      slots.push(slot)
      slotOf.set(wearer.material, slot)
    }
    if (!slot) {
      skipped++
      continue
    }
    granted.push({ wearer, slot })
  }
  const entries = granted.length + 1
  const rows = tableRows(alignUp(entries, ENTRY_STEP), shape.side)
  const table = new Float32Array(rows * shape.side * 4)
  writeDefaultEntry(table, shape.slot, shape.side, fogLocals)
  granted.forEach(({ wearer, slot }, at) => {
    entryOf[wearer.slot] = at + 1
    writeEntry(table, at + 1, wearer.light, {
      x: slot.x,
      y: slot.y,
      slot: shape.slot,
      side: shape.side,
    })
  })
  return { slots, entryOf, table, rows, skipped }
}
