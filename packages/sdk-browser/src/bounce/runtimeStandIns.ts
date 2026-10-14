import { RUNTIME_HEADER_WORDS } from './runtimeLayout.ts'
import { arrayView } from '../gpu/core/textureViews.ts'
import { standInTexture } from '../gpu/core/standInTexture.ts'
import { WORLD_TABLE } from '../gpu/dag/worldTable.ts'
import { TREE_TABLE } from '../gpu/dag/treeTable.ts'

/**
 * THE PROXY'S STAND-INS, what every program that casts proxy rays binds when no placement wears one:
 * one buffer of zeros, a header that says no placement holds an instance (`runtimeLayout.ts`), and
 * one texel of each record table the rays read beside it — the culling's records, worlds and
 * instances (`../gpu/dag/worldTable.ts`), and its placement tree (`../gpu/dag/treeTable.ts`) —, which
 * no ray reads. A session without proxy renders exactly the same image on opaque and on blend.
 */
export function runtimeStandIns(device: GPUDevice) {
  const runtime = device.createBuffer({
    label: 'Trillion3D empty run-time proxy',
    // The header and one word of the arena: what a binding of the program's struct holds at least.
    size: (RUNTIME_HEADER_WORDS + 1) * 4,
    usage: GPUBufferUsage.STORAGE,
  })
  // Each a texel of its table's own format.
  const worlds = standInTexture(
      device,
      'Trillion3D empty run-time proxy worlds',
      WORLD_TABLE.format,
    ),
    tree = standInTexture(device, 'Trillion3D empty run-time proxy tree', TREE_TABLE.format)
  return {
    runtime,
    runtimeWorlds: arrayView(worlds),
    runtimeTree: arrayView(tree),
    destroy() {
      runtime.destroy()
      worlds.destroy()
      tree.destroy()
    },
  }
}
