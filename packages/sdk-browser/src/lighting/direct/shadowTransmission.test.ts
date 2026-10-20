// The opaque resolve reads the projection's mask and, beside it, what the translucent casters let
// through along the same rays (`vsmMaskThrough`, the mask's transmission): only where the light is
// not fully shadowed, its tile stored a pane's colour of its layer (`VSM_MASK_THROUGH_SHIFT`) and
// the frame holds translucent casters.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { directShadowWgsl } from './shadowWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import { VSM_MASK_THROUGH_SHIFT } from '../../vsm/constants.ts'

type V = number[]

/** The opaque resolve's read (`shadowFactor` over the mask). */
const RESOLVE = `${wgslModule(directShadowWgsl(25, { pass: 'mask', resolveTransmission: 14 }))}
fn testTransmission()->vec3f{return shadowTransmission;}`
type Resolve = { shadowFactor: (...a: unknown[]) => number; testTransmission: () => V }

test('the resolve reads the transmission beside the mask, where its tile stored its panes', () => {
  const colour = [0x99, 0x66, 0x33].map((c) => c / 255)
  for (const mask of [0, 0.5, 1])
    for (const stored of [false, true])
      for (const casters of [false, true]) {
        const reads: V[] = []
        const r = shaderRun<Resolve>(
          RESOLVE,
          ['shadowFactor', 'vsmMaskThrough', 'testTransmission'],
          {
            shadowTransmission: [1, 1, 1],
            vsmMaskFactor: () => mask,
            vsmMaskPixel: [3, 4],
            vsmMaskTile: stored ? 1 | (1 << VSM_MASK_THROUGH_SHIFT) : 1,
            vsmShadowThrough: 'through',
            textureDimensions: () => [casters ? 1024 : 1, 1],
            textureLoad: (_t: string, at: V, layer: number) => (
              reads.push([...at, layer]),
              [...colour, 1]
            ),
          },
        )
        const where = `mask ${mask} stored ${stored} casters ${casters}`
        assert.equal(r.shadowFactor(64 * 8192 + 1, {}, [0, 0, 0], [0, 1, 0], true), mask, where)
        const through = mask > 0 && stored && casters
        assert.deepEqual(r.testTransmission(), through ? colour : [1, 1, 1], where)
        assert.deepEqual(reads, through ? [[3, 4, 1]] : [], `${where}: the light's own layer`)
      }
})
