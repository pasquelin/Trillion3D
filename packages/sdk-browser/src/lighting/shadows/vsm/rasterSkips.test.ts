// The shadow raster's fragment (`render/renderRasterWgsl.ts`) does no work a fragment's word does not need:
// an unmasked row — whose `maskKeep` keeps every fragment at its first test — reads no page, and a
// depth no greater than the pool's word already held writes nothing (`vsmPoolAtomicMax`): a word
// only grows, so it ends the max of every depth drawn into it, whatever their order. A sun's
// clipmap leaves out, before any page is touched, the tested caster whose nearest point lies past the
// sun's far-shadow distance along the main view, unless its object casts far shadows.
import { mulberry32 } from '../../../../../math/src/sequence/random.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf, wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { MOBILITY_FAR_SHADOW } from '../mobilityBits.ts'
import { VSM_RENDER_CANDIDATE_BYTES } from './constants.ts'
import { wgslStructLayout } from './wgslStructLayout.fixture.ts'
import { vsmRenderCandidatesWgsl } from './render/renderCandidatesWgsl.ts'
import { vsmRenderCullWgsl } from './render/renderCullWgsl.ts'
import { vsmRenderExpandWgsl } from './render/renderExpandWgsl.ts'
import { vsmTransmissionCandidatesWgsl } from './transmission/transmissionClearWgsl.ts'
import { VSM_RENDER_PARAMS } from './render/renderParamsWgsl.ts'
import {
  DRAW_DISTANCE_MARK,
  DRAW_FAR_WORD,
  DRAW_NEAR_WORD,
  MARK_WORD,
} from '../../../geometry/dag/frameTable.ts'
import { f32Bits } from '../../../../../math/src/float/bits.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { FLAG_MASK } from '../../../visibility/types.ts'
import { vsmBindingsWgsl } from './resources.ts'
import { VSM_RENDER_RASTER_FRAGMENT_SPECS, vsmRenderRasterWgsl } from './render/renderRasterWgsl.ts'
import { vsmLayout } from './layout.ts'
import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'

const LAYOUT = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 })
const CODE = vsmRenderRasterWgsl(LAYOUT)

test('an unmasked row reads no page in the fragment: maskKeep keeps it whole', () => {
  const vertex = functionsOf(CODE, ['vsmRenderVs']),
    fragment = functionsOf(CODE, ['vsmRenderFs'])
  assert.ok(vertex.includes(`out.masked=page.flags&${FLAG_MASK}u;`))
  assert.ok(
    fragment.includes(
      'if(onEmitter||(in.masked!=0u&&!maskKeep(pages[in.row],in.uv,1.0,gx,gy))){discard;}',
    ),
  )
  assert.equal(fragment.match(/pages\[/g)?.length, 1, 'the one page read, behind the flag')
  // maskKeep's first test: a row without the mask flag keeps the fragment, whatever it holds.
  const { maskKeep } = shaderRun<{
    maskKeep: (page: object, uv: number[], a: number, dx: number[], dy: number[]) => boolean
  }>(CODE, ['maskKeep'], {})
  const unmasked = new Proxy(
    { flags: 0xffffffff & ~FLAG_MASK },
    {
      get: (page, key) => {
        if (key !== 'flags') throw new Error(`read ${String(key)}`)
        return page.flags
      },
    },
  )
  assert.equal(maskKeep(unmasked, [0, 0], 1, [0, 0], [0, 0]), true)
})

test('the pool max writes only a greater depth, and every word ends the max of its depths', () => {
  const pool = wgslModule(vsmBindingsWgsl(1, VSM_RENDER_RASTER_FRAGMENT_SPECS, LAYOUT))
  const accessor = functionsOf(pool, ['vsmPoolAtomicMax'])
  const parts = [...accessor.matchAll(/^ case \d+u:\{(.*)\}$/gm)].map((m) => m[1])
  assert.ok(parts.length >= 2, 'a part a slice at least')
  for (const body of parts)
    assert.match(body, /^if\(atomicLoad\(&(\w+)\[i\]\)<value\)\{atomicMax\(&\1\[i\],value\);\}$/)
  // The body run on random depths in random orders: the word, and the writes it took.
  let writes = 0
  const rand = mulberry32(5)
  for (let round = 0; round < 200; round++) {
    const word = [0]
    const run = shaderRun<{ join: (value: number) => void }>(
      `fn join(value:u32){${parts[0].replace(/\w+\[i\]/g, 'word[0]')}}`,
      ['join'],
      {
        word,
        atomicLoad: (p: { get: () => number }) => p.get(),
        atomicMax: (p: { get: () => number; set: (v: number) => void }, v: number) => (
          writes++,
          p.set(Math.max(p.get(), v))
        ),
      },
    )
    const depths = Array.from({ length: 1 + Math.floor(rand() * 40) }, () =>
      Math.floor(rand() * 2 ** 32),
    )
    writes = 0
    let rises = 0,
      best = 0
    for (const d of depths) {
      if (d > best) {
        rises++
        best = d
      }
      run.join(d)
    }
    assert.equal(word[0], best, 'the max of the depths')
    assert.equal(writes, rises, 'a write per new greatest depth, none else')
  }
})

const CULL = vsmRenderCullWgsl(LAYOUT)
const FAR = wgslConstants(CULL)
const TESTED = FAR.VSM_RENDER_CAND_FAR_TESTED,
  CASTS_FAR = FAR.VSM_RENDER_CAND_FAR_CAST

test('a sun leaves out a tested caster past its far-shadow distance that does not cast far shadows', () => {
  const { vsmFarShadowSkipped } = shaderRun<{
    vsmFarShadowSkipped: (flags: number, farDepth: number, distance: number) => boolean
  }>(CULL, ['vsmFarShadowSkipped'], FAR)
  assert.equal(vsmFarShadowSkipped(TESTED, 500, 400), true, 'past: left out')
  assert.equal(vsmFarShadowSkipped(TESTED, 400, 400), false, 'on the distance: kept')
  assert.equal(vsmFarShadowSkipped(TESTED, -60, 400), false, 'behind the eye: kept')
  assert.equal(vsmFarShadowSkipped(0, 5000, 400), false, 'a row the test does not reach')
  assert.equal(vsmFarShadowSkipped(TESTED | CASTS_FAR, 5000, 400), false, 'it casts far shadows')
  assert.equal(vsmFarShadowSkipped(TESTED, 5000, 0), false, 'no distance, no limit')
  // The cull applies it to a sun's views alone, before the distance cull of a local light's.
  const cull = functionsOf(CULL, ['vsmRenderCull'])
  const skip = cull.indexOf(
    'if(directional&&vsmFarShadowSkipped(cand.flags,cand.farDepth,pd.farShadowDistance)){return;}',
  )
  assert.ok(skip > 0 && skip < cull.indexOf('if(distanceCull)'))
})

test('a candidate is tested where the world’s merged shells are, or every mesh when asked, and casts far by its row', () => {
  const candidates = vsmRenderCandidatesWgsl()
  // Placement 7 is the world's; the others are drawn as themselves.
  const worldPlaced = (placement: number) => placement === 7
  const { vsmRenderFarFlags, vsmRenderFarDepth } = shaderRun<{
    vsmRenderFarFlags: (word: number, placement: number) => number
    vsmRenderFarDepth: (c: number[], l: number[], lod: object) => number
  }>(candidates, ['vsmRenderFarFlags', 'vsmRenderObjectDelta', 'vsmRenderFarDepth'], {
    ...wgslConstants(candidates),
    worldPlaced,
    params: {
      farMeshes: 0,
      eyeHigh: [100, 0, 0],
      eyeLow: [0.5, 0, 0],
      // The view looks along +x: its z row is −x, so a depth is a distance along +x.
      viewRow2: [-1, 0, 0, 0],
    },
  })
  assert.equal(vsmRenderFarFlags(0, 3), 0, 'an object drawn as itself keeps casting far')
  assert.equal(vsmRenderFarFlags(0, 7), TESTED, 'a placement of the world DAG is tested')
  assert.equal(vsmRenderFarFlags(MOBILITY_FAR_SHADOW, 7), TESTED | CASTS_FAR)
  assert.equal(vsmRenderFarFlags(MOBILITY_FAR_SHADOW, 3), CASTS_FAR)
  // The depth of the nearest point: the centre's distance along the view, the radius off, the high
  // and low halves of the eye subtracted together.
  const alone = { object: [0, 0, 0, 0] }
  assert.equal(vsmRenderFarDepth([600, 0, 0, 50], [0.25, 0, 0], alone), 600.25 - 100.5 - 50)
  assert.equal(vsmRenderFarDepth([40, 7, 3, 10], [0, 0, 0], alone), -70.5, 'behind the eye')
  // The row's whole object, when it has one (`lod.object`: the offset of its centre, then its
  // radius): its centre and radius, not the row's own.
  const object = { object: [30, 0, 0, 120] }
  assert.equal(vsmRenderFarDepth([600, 0, 0, 50], [0.25, 0, 0], object), 600.25 - 100.5 + 30 - 120)
  const aside = { object: [0, 12, 0, 80] }
  assert.equal(vsmRenderFarDepth([600, 40, 0, 50], [0, 0, 0], aside), 600 - 100.5 - 80)
  const every = shaderRun<{ vsmRenderFarFlags: (word: number, placement: number) => number }>(
    candidates,
    ['vsmRenderFarFlags'],
    { ...wgslConstants(candidates), worldPlaced, params: { farMeshes: 1 } },
  )
  assert.equal(every.vsmRenderFarFlags(0, 3), TESTED, 'every mesh, when the settings say so')
})

test('both candidate kernels give every candidate its far-shadow flags and depth, in the 48 bytes it had, and drop what no view takes', () => {
  for (const code of [vsmRenderCandidatesWgsl(), vsmTransmissionCandidatesWgsl()]) {
    assert.ok(code.includes('vsmRenderFarFlags(word,page.placement)'), 'one rule for both casters')
    assert.ok(code.includes('vsmRenderFarDepth(s.c,s.l.xyz,lod)'))
    assert.ok(code.includes('let word=mobility[row];'), 'its mobility word, read once')
    assert.ok(!code.includes('Flags(mobility[row]'), 'not again for each rule')
    const drop = code.indexOf('if(vsmFarShadowSkipped(flags,farDepth,params.farDrop)){return;}')
    assert.ok(drop > 0 && drop < code.indexOf('atomicAdd(&counts[0]'), 'dropped before the append')
  }
  const candidate = wgslStructLayout(CULL, 'VsmRenderCandidate')
  assert.deepEqual([candidate.size, candidate.offsets.farDepth], [VSM_RENDER_CANDIDATE_BYTES, 40])
  const { at } = VSM_RENDER_PARAMS
  assert.equal(
    [at.farMeshes, at.farDrop].every((word) => word !== undefined),
    true,
    'the scope',
  )
})

test('a caster whose object is out of the draw distances it names casts no shadow, from the main view’s eye', () => {
  const candidates = vsmRenderCandidatesWgsl()
  // Placement 4 names 10 to 100 metres; placement 5 names none (its mark has no bit).
  const words = new Map<string, number>([
    [`4 ${MARK_WORD}`, DRAW_DISTANCE_MARK],
    [`4 ${DRAW_NEAR_WORD}`, f32Bits(10)],
    [`4 ${DRAW_FAR_WORD}`, f32Bits(100)],
    [`5 ${DRAW_NEAR_WORD}`, f32Bits(10)],
    [`5 ${DRAW_FAR_WORD}`, f32Bits(100)],
  ])
  const run = (params: object) =>
    shaderRun<{
      vsmRenderOutsideDrawDistance: (w: number, delta: number[]) => boolean
      vsmRenderObjectDelta: (c: number[], l: number[], lod: object) => number[]
    }>(candidates, ['vsmRenderOutsideDrawDistance', 'vsmRenderObjectDelta'], {
      ...wgslConstants(candidates),
      params: { eyeHigh: [100, 0, 0], eyeLow: [0.5, 0, 0], ...params },
      markOf: (w: number) => words.get(`${w} ${MARK_WORD}`) ?? 0,
      framesWord: (w: number, k: number) => words.get(`${w} ${k}`) ?? 0,
    })
  const on = run({ drawDistances: 1, viewDistanceScale: 1 })
  const out = (w: number, distance: number) => on.vsmRenderOutsideDrawDistance(w, [distance, 0, 0])
  assert.equal(out(4, 50), false, 'within its distances')
  assert.equal(out(4, 5), true, 'nearer than its nearest')
  assert.equal(out(4, 101), true, 'past its farthest')
  assert.equal(out(5, 5000), false, 'a placement that names none, whatever its words hold')
  assert.equal(out(6, 5000), false, 'nor one whose words are zero')
  const scaled = run({ drawDistances: 1, viewDistanceScale: 2 })
  assert.equal(scaled.vsmRenderOutsideDrawDistance(4, [150, 0, 0]), false, 'the scale doubles it')
  const off = run({ drawDistances: 0, viewDistanceScale: 1 })
  assert.equal(off.vsmRenderOutsideDrawDistance(4, [5000, 0, 0]), false, 'the parameters say none')
  // The centre of the object the row belongs to, from the eye (high and low halves together), the
  // row's own sphere when it has no object.
  const alone = { object: [0, 0, 0, 0] }
  assert.deepEqual(on.vsmRenderObjectDelta([600, 1, 2, 50], [0.25, 0, 0], alone), [499.75, 1, 2])
  const object = { object: [30, 0, 0, 120] }
  assert.deepEqual(on.vsmRenderObjectDelta([600, 0, 0, 50], [0.25, 0, 0], object), [529.75, 0, 0])
  // Both candidate kernels take it, after the level of detail, before the far-shadow depth.
  for (const code of [vsmRenderCandidatesWgsl(), vsmTransmissionCandidatesWgsl()]) {
    const call =
      'vsmRenderOutsideDrawDistance(page.placement,vsmRenderObjectDelta(s.c,s.l.xyz,lod))'
    assert.ok(code.indexOf(call) > code.indexOf('drawsCluster(true'), 'after the level of detail')
    assert.ok(code.indexOf(call) < code.indexOf('atomicAdd(&counts[0]'), 'before the append')
  }
  assert.equal(VSM_RENDER_PARAMS.at.drawDistances !== undefined, true, 'the parameters carry it')
})

test('a caster the main view’s filter leaves out casts no shadow, in both candidate kernels, none where no filter is named', () => {
  const candidates = vsmRenderCandidatesWgsl()
  // Placements 1, 3 and 95 are left out; the bits start at word 7 of the cut's `work`.
  const bits = Array.from({ length: 12 }, () => 0)
  bits[7] = 0b1010
  bits[9] = 2 ** 31
  const run = (filterBase: number) =>
    shaderRun<{ vsmRenderFilteredOut: (w: number) => boolean }>(
      candidates,
      ['vsmRenderFilteredOut'],
      {
        ...wgslConstants(candidates),
        params: { filterBase },
        filterBits: bits,
        arrayLength: () => bits.length,
      },
    )
  const filtered = run(7)
  assert.deepEqual([0, 1, 2, 3, 4].map(filtered.vsmRenderFilteredOut), [
    false,
    true,
    false,
    true,
    false,
  ])
  assert.equal(filtered.vsmRenderFilteredOut(95), true, 'a bit of the third word')
  assert.equal(filtered.vsmRenderFilteredOut(94), false)
  assert.equal(filtered.vsmRenderFilteredOut(5000), false, 'a placement past the bits')
  assert.equal(run(0).vsmRenderFilteredOut(1), false, 'no filter named: every placement casts')
  // The skip, in the opaque candidates and the blended ones, after the cut's world gate.
  for (const code of [vsmRenderCandidatesWgsl(), vsmTransmissionCandidatesWgsl()])
    assert.ok(
      code.includes(
        '||!worldDraws(page.selectionIndex,page.placement)||vsmRenderFilteredOut(page.placement);',
      ),
    )
  assert.equal(VSM_RENDER_PARAMS.at.filterBase !== undefined, true, 'the parameters carry it')
})

// A displaced surface's pair is marked for the tessellation where its light's maps ask it
// (`VsmRenderParams.tessellated`): candidate, command (bit 22), pair (bit 23); the raster drops it.
test('a displaced surface’s pairs are marked from its candidate to the raster, which draws none of their triangles', () => {
  const expand = vsmRenderExpandWgsl(LAYOUT)
  const { vsmRenderCommandOf } = shaderRun<{
    vsmRenderCommandOf(cmd: number[]): { tessellated: number }
  }>(expand, ['bitAt', 'bitIsSet', 'lowBits', 'vsmRenderCommandOf'], wgslConstants(expand))
  assert.deepEqual(
    [1 << 22, 0, 1 << 21].map((y) => vsmRenderCommandOf([0, y, 0, 0]).tessellated),
    [1, 0, 0],
  )
  // An opaque row is marked; a masked one only where the device holds the vertex stage that cuts it out.
  const mark = 'params.tessellated!=0u&&tessellatedFlags(page)'
  assert.ok(vsmRenderCandidatesWgsl().includes(mark))
  assert.ok(vsmRenderCandidatesWgsl().includes('&VSM_RENDER_TESSELLATE_MASKED)!=0u'))
  assert.ok(!vsmTransmissionCandidatesWgsl().includes(mark), 'a blended one is not')
  const cull = functionsOf(CULL, ['vsmRenderCullView'])
  for (const text of [
    'select(VSM_RENDER_TESSELLATE_LOCAL,VSM_RENDER_TESSELLATE_DIRECTIONAL,directional)',
    '(cand.flags&VSM_RENDER_CAND_TESSELLATED)!=0u&&(params.tessellated&kind)!=0u',
    '|swapped|tessellated,',
  ])
    assert.ok(cull.includes(text), text)
  assert.ok(expand.includes('|(c.tessellated<<23u)'), 'the pair carries it')
  const vs = functionsOf(CODE, ['vsmRenderVs'])
  const drop = vs.indexOf('if(bitIsSet(pair.y,23u)){out.position=vsmRenderNan();return out;}')
  assert.ok(drop > 0 && drop < vs.indexOf('pages['), 'dropped before its row is read')
})
