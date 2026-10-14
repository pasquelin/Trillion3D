// The per-command kernels of the transmission (`transmissionShared.ts`) run on their own width, not
// the dispatch's tunable one: the bin holds a projected triangle a thread in the group's memory,
// which a wider `WORKGROUP_THREADS` would push past the 16 KiB every device guarantees.
import test from 'node:test'
import assert from 'node:assert/strict'
import { vsmLayout } from './layout.ts'
import { GUARANTEED_WORKGROUP_BYTES } from '../gpu/core/textureLimits.ts'
import { vsmTransmissionBinWgsl } from './transmissionBinWgsl.ts'
import { vsmTransmissionPagesWgsl } from './transmissionPagesWgsl.ts'

test('the bin and the pages kernels take the command group, never the dispatch width', () => {
  const layout = vsmLayout({ fullMapCapacity: 1 })
  for (const code of [vsmTransmissionBinWgsl(layout), vsmTransmissionPagesWgsl(layout)]) {
    assert.match(code, /@workgroup_size\(VSM_T_COMMAND_GROUP\)/)
    assert.doesNotMatch(code, /@workgroup_size\(WORKGROUP_THREADS\)|\+=WORKGROUP_THREADS/)
  }
  assert.match(vsmTransmissionBinWgsl(layout), /tris:array<VsmTTri,VSM_T_COMMAND_GROUP>/)
})

/** WGSL's size and alignment of `type` in `code` (scalars, vectors, atomics, fixed arrays, the
 *  structures `code` declares), as the address-space rules lay workgroup memory out. */
function layoutOf(code: string, type: string): { size: number; align: number } {
  const roundUp = (n: number, k: number) => Math.ceil(n / k) * k
  const scalar = /^(?:f32|u32|i32|atomic<u32>|atomic<i32>)$/.exec(type)
  if (scalar) return { size: 4, align: 4 }
  const vector = /^vec([234])[fiu]$/.exec(type)
  if (vector) {
    const n = Number(vector[1])
    return { size: 4 * n, align: n === 2 ? 8 : 16 }
  }
  const array = /^array<(.+),(\w+)>$/.exec(type)
  if (array) {
    const element = layoutOf(code, array[1])
    const count = /^\d+$/.test(array[2])
      ? Number(array[2])
      : Number(new RegExp(`const ${array[2]}:u32=(\\d+)u;`).exec(code)![1])
    return { size: count * roundUp(element.size, element.align), align: element.align }
  }
  const body = new RegExp(`struct ${type}\\{([^}]*)\\}`).exec(code)
  assert.ok(body, `unknown WGSL type ${type}`)
  let size = 0,
    align = 1
  for (const field of body[1].split(/,(?![^<]*>)/).filter(Boolean)) {
    const member = layoutOf(code, field.slice(field.indexOf(':') + 1))
    size = roundUp(size, member.align) + member.size
    align = Math.max(align, member.align)
  }
  return { size: roundUp(size, align), align }
}

test('the bin’s workgroup memory stays within the 16 KiB every device holds', () => {
  const code = vsmTransmissionBinWgsl(vsmLayout({ fullMapCapacity: 1 }))
  assert.equal(layoutOf(code, 'VsmTTri').size, 160)
  const bytes = [...code.matchAll(/var<workgroup> \w+:([^;]+);/g)].reduce(
    (sum, [, type]) => sum + layoutOf(code, type).size,
    0,
  )
  assert.ok(bytes <= GUARANTEED_WORKGROUP_BYTES, `${bytes} bytes of workgroup memory`)
})
