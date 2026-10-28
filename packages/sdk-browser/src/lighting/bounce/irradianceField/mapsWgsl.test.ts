// The irradiance field's maps: the kernels that make a probe's irradiance and occlusion from the cache's maps.

import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import {
  IRRADIANCE_BINDINGS,
  OCCLUSION_BINDINGS,
  irradianceEntries,
  irradianceProgram,
  occlusionEntries,
  occlusionProgram,
} from './mapsWgsl.ts'

test('every kernel of the field’s maps is a module a device takes, its bindings the layout holds', () => {
  for (const [name, code, entries, point, table] of [
    [
      'irradiance',
      irradianceProgram(6),
      irradianceEntries(),
      'irradianceMaps',
      IRRADIANCE_BINDINGS,
    ],
    ['occlusion', occlusionProgram(16), occlusionEntries(), 'occlusionMaps', OCCLUSION_BINDINGS],
  ] as const) {
    assertProgramAssembles(code, undefined, name)
    const declared = [...code.matchAll(/@group\(0\)\s*@binding\((\d+)\)/g)].map((m) => +m[1])
    // The table names a group of consecutive bindings by its first (`field`: the global field's six).
    const FIELD_BINDINGS = 6
    const expected = Object.entries(table).flatMap(([key, binding]) =>
      key === 'field' ? Array.from({ length: FIELD_BINDINGS }, (_, at) => binding + at) : [binding],
    )
    assert.deepEqual(
      entries.map((entry) => entry.binding).sort((a, b) => a - b),
      expected.sort((a, b) => a - b),
      `${name}: the layout holds the table`,
    )
    // What a stage binds stays within the limits every device grants: 16 sampled textures, 8 storage buffers, 4 storage textures, 16 samplers.
    const count = (kind: 'texture' | 'storageTexture' | 'sampler' | 'storageBuffer') =>
      entries.filter((entry) =>
        kind === 'storageBuffer'
          ? entry.buffer !== undefined && entry.buffer.type !== 'uniform'
          : entry[kind] !== undefined,
      ).length
    assert.ok(count('texture') <= 16, `${name}: sampled textures`)
    assert.ok(count('storageBuffer') <= 8, `${name}: storage buffers`)
    assert.ok(count('storageTexture') <= 4, `${name}: storage textures`)
    assert.ok(count('sampler') <= 16, `${name}: samplers`)
    assert.ok(
      entries.every((entry) => declared.includes(entry.binding)),
      `${name}: its layout's bindings are declared`,
    )
    assert.ok(code.includes(`fn ${point}(`), name)
  }
})

test('the irradiance of a texel is the cosine-weighted mean of the probe’s radiance over eight by eight directions, over the sum of the weights, the border a wrap of the map’s edge', () => {
  const code = irradianceProgram(6)
  assert.match(code, /const FIELD_IRRADIANCE:u32 ?= ?6u;/)
  assert.match(code, /let factor=max\(res\/FIELD_DOWNSAMPLED,1u\);/)
  assert.match(
    code,
    /if\(heard>0\.0\)\{\n\s*total\+=downsampled\[y\]\[x\]\*heard;\n\s*weight\+=heard;/,
  )
  assert.match(code, /vec4f\(total\/max\(weight,1e-6\),0\.0\)/)
  assert.match(code, /octWrapBorder\(vec2u\(dx,dy\),side,FIELD_BORDER\)/)
})

test('the occlusion of a texel is the distance of the probe’s ray in its direction and its square, a two-sided surface’s four times as far', () => {
  const code = occlusionProgram(16)
  assert.match(code, /cacheDepthOf\(word\)\*select\(1\.0,4\.0,cacheTwoSidedIs\(word\)\)/)
  assert.match(code, /vec4f\(distance,distance\*distance,0\.0,0\.0\)/)
  assert.match(code, /let source=min\(texel\*res\/FIELD_OCCLUSION,vec2u\(res-1u\)\);/)
})

test('a probe is valid where its centre is farther from the global field’s surface than half the voxel of the clipmap it lies a voxel inside of, times the covered expansion, and valid with no clipmap', () => {
  const code = occlusionProgram(16)
  assert.match(code, /if\(gdfView\.clipmaps==0u\)\{return true;\}/)
  assert.match(code, /let extent=box\.w\*gdfView\.texel;/)
  assert.match(
    code,
    /return gdfDistanceToNearestSurface\(centre\)>voxel\*0\.5\*gdfView\.expandCovered;/,
  )
  assert.match(code, /probeValid\[queued\.slot\]=select\(0u,1u,fieldProbeOutside\(queued\)\);/)
})
