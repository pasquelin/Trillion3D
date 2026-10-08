// The water composite's layout is made of the bindings it holds (`compositeGroup.ts`): the opaque
// resolve's deferred bounce layout with the pool where the composite reads a binding as the resolve
// does, its own where it does not — the water word, a colour in the flags' place, the backdrop and
// its depth, the blend view, the volumes —, then the lobes target. The very entries the layout was
// written as by hand.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { deferredLayoutEntries } from '../../lighting/deferred/setup.ts'
import { readOnly } from '../core/bindLayout.ts'
import { PHYSICAL_LOBES_TARGET } from '../../scene/physicalLobes.ts'
import { WATER_BINDINGS } from './compositeWgsl.ts'
import { waterCompositeLayoutEntries } from './compositeGroup.ts'

const byBinding = (entries: GPUBindGroupLayoutEntry[]) =>
  [...entries].sort((a, b) => a.binding - b.binding)

test('the water composite layout is the one its bindings name, laid out as the resolve reads them', () => {
  installGpuGlobals()
  const b = WATER_BINDINGS,
    fragment = GPUShaderStage.FRAGMENT
  const written = [
    ...deferredLayoutEntries(true, true, false).map((entry) =>
      entry.binding === b.word
        ? { ...entry, texture: { sampleType: 'unfilterable-float' as const } }
        : entry,
    ),
    { binding: b.backdrop, visibility: fragment, texture: { sampleType: 'unfilterable-float' } },
    { binding: b.backdropDepth, visibility: fragment, texture: { sampleType: 'depth' } },
    { binding: b.uniform, visibility: fragment, buffer: { type: 'uniform' } },
    { binding: b.volumes, visibility: fragment, buffer: readOnly },
    PHYSICAL_LOBES_TARGET.layoutEntry(),
  ] as GPUBindGroupLayoutEntry[]
  assert.deepEqual(byBinding(waterCompositeLayoutEntries()), byBinding(written))
})
