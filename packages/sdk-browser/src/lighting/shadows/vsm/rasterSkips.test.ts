// The shadow raster's fragment (`render/renderRasterWgsl.ts`) does no work a fragment's word does not need:
// an unmasked row — whose `maskKeep` keeps every fragment at its first test — reads no page, and a
// depth no greater than the pool's word already held writes nothing (`vsmPoolAtomicMax`): a word
// only grows, so it ends the max of every depth drawn into it, whatever their order. A sun's
// clipmap leaves out, before any page is touched, the tested caster whose nearest point lies past the
// sun's far-shadow distance along the main view, unless its object casts far shadows. The occlusion
// culling skips what a map's pyramid hides: its build and its test, run as shipped.
import { mulberry32 } from '../../../../../math/src/sequence/random.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { functionsOf, wgslConstants } from '../../../materials/texture/shaderRule.fixture.ts'
import { MOBILITY_FAR_SHADOW } from '../mobilityBits.ts'
import { VSM_RENDER_CANDIDATE_BYTES } from './constants.ts'
import { wgslStructLayout } from './wgslStructLayout.fixture.ts'
import { vsmRenderCandidatesWgsl } from './render/renderCandidatesWgsl.ts'
import { vsmRenderCullWgsl } from './render/renderCullWgsl.ts'

import { VSM_RENDER_PARAMS, VSM_RENDER_RECORD_WGSL } from './render/renderParamsWgsl.ts'
import { shaderRun } from '../../../materials/texture/shaderRun.fixture.ts'
import { FLAG_MASK } from '../../../visibility/types.ts'
import { vsmBindingsWgsl } from './resources.ts'
import { VSM_RENDER_RASTER_FRAGMENT_SPECS, vsmRenderRasterWgsl } from './render/renderRasterWgsl.ts'
import { vsmLayout } from './layout.ts'
import { vsmRenderSoftwareWgsl } from './render/renderSoftwareWgsl.ts'
import { maskGraphSets } from '../../../gpu/core/engineShaders.mask.fixture.ts'

import { wgslModule } from '../../../../../math/src/wgsl/assemble.ts'
import { Mat } from '../../../materials/texture/shaderRunMatrix.fixture.ts'

const LAYOUT = vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 })
const CODE = vsmRenderRasterWgsl(LAYOUT)

test('an unmasked row reads no page in the fragment: maskKeep keeps it whole', () => {
  const vertex = functionsOf(CODE, ['vsmRenderVs']),
    fragment = functionsOf(CODE, ['vsmRenderFs'])
  assert.ok(vertex.includes(`out.masked=page.flags&${FLAG_MASK}u;`))
  assert.ok(
    fragment.includes('if(in.masked!=0u&&!maskKeep(pages[in.row],in.uv,1.0,gx,gy)){discard;}'),
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

test('a masked caster’s dither is read at the map’s virtual pixel, whatever page holds the texel', () => {
  const masks = maskGraphSets().shadow
  const hardware = vsmRenderRasterWgsl(LAYOUT, masks)
  assert.ok(
    functionsOf(hardware, ['vsmRenderFs']).includes(
      'maskKeepAt(pages[in.row],in.uv,1.0,gx,gy,vsmRenderMapPixel(in.clip,vsmRenderWindowMip(in.window)))',
    ),
  )
  // The software raster gives the page's first texel plus the pixel’s offset, at its centre.
  assert.ok(
    functionsOf(vsmRenderSoftwareWgsl(LAYOUT, masks), ['writePixel']).includes(
      'maskKeepAt(page,cut.at.xy,1.0,cut.ddx,cut.ddy,vec2f(vsmRecordFirstPage(swRecord)*128u+vec2u(pixel))+vec2f(0.5))',
    ),
  )
  const { vsmRenderMapPixel } = shaderRun<{
    vsmRenderMapPixel(clip: number[], mip: number): number[]
  }>(CODE, ['vsmRenderMapPixel'], wgslConstants(CODE))
  const at = (clip: number[], mip: number) => Array.from(vsmRenderMapPixel(clip, mip))
  assert.deepEqual(at([0, 0, 0.5, 1], 0), [(16384 - 1) / 2 + 0.5, (16384 - 1) / 2 + 0.5])
  assert.deepEqual(at([0, 0, 0.5, 1], 1), [(8192 - 1) / 2 + 0.5, (8192 - 1) / 2 + 0.5])
  assert.deepEqual(at([-1, 1, 0.5, 1], 0), [0.5, 0.5], 'the map’s top left corner')
  assert.deepEqual(at([1, -1, 0.5, 1], 0), [16384 - 0.5, 16384 - 0.5], 'its bottom right')
  assert.deepEqual(at([0, 0, 1, 4], 0), at([0, 0, 0.5, 1], 0), 'a perspective map divides by w')
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
  // The cull applies it to a sun's views alone, before the distance cull of a local light's: in the
  // candidate's walk of its light's maps, which the cull with no test and the occlusion's first share.
  const cull = functionsOf(CULL, ['vsmRenderCullCandidate'])
  const skip = cull.indexOf(
    'if(directional&&vsmFarShadowSkipped(cand.flags,cand.farDepth,pd.farShadowEdge)){return;}',
  )
  assert.ok(skip > 0 && skip < cull.indexOf('if(!directional&&dot(center,center)>'))
})

test('a candidate is tested where the world’s merged shells are, or every mesh when asked, and casts far by its placement', () => {
  const candidates = vsmRenderCandidatesWgsl()
  // Placement 7 is the world's; the others are drawn as themselves.
  const worldPlaced = (placement: number) => placement === 7
  const { vsmRenderFarFlags, vsmRenderFarDepth } = shaderRun<{
    vsmRenderFarFlags: (word: number, placement: number) => number
    vsmRenderFarDepth: (object: number[]) => number
  }>(candidates, ['vsmRenderFarFlags', 'vsmRenderFarDepth'], {
    ...wgslConstants(candidates),
    worldPlaced,
    params: {
      farMeshes: 0,
      // The view looks along +x: its z row is −x, so a depth is a distance along +x.
      viewRow2: [-1, 0, 0, 0],
    },
  })
  assert.equal(vsmRenderFarFlags(0, 3), 0, 'an object drawn as itself keeps casting far')
  assert.equal(vsmRenderFarFlags(0, 7), TESTED, 'a placement of the world DAG is tested')
  assert.equal(vsmRenderFarFlags(MOBILITY_FAR_SHADOW, 7), TESTED | CASTS_FAR)
  assert.equal(vsmRenderFarFlags(MOBILITY_FAR_SHADOW, 3), CASTS_FAR)
  // The depth of the nearest point of the object, from the eye: its centre's distance along the
  // view, its radius off.
  assert.equal(vsmRenderFarDepth([500, 0, 0, 50]), 450)
  assert.equal(vsmRenderFarDepth([-70.5, 7, 3, 10]), -80.5, 'behind the eye')
  assert.equal(vsmRenderFarDepth([600, 40, 90, 80]), 520, 'across the view, only the depth counts')
  const every = shaderRun<{ vsmRenderFarFlags: (word: number, placement: number) => number }>(
    candidates,
    ['vsmRenderFarFlags'],
    { ...wgslConstants(candidates), worldPlaced, params: { farMeshes: 1 } },
  )
  assert.equal(every.vsmRenderFarFlags(0, 3), TESTED, 'every mesh, when the settings say so')
})

// The candidate carries its sphere and the three half axes of its box (the frustum cull's volume), its
// group's and its parent's bounds and errors, each map judging its own level of detail
// (`vsmRenderLodAt`): each of the first three vec3s followed by a scalar, the far depth at byte 76,
// and last the fit of the half axes (`axisFit`), a vec3 at byte 160 that the 16-byte alignment pads
// to 176.
test('the candidate kernel gives every candidate its far-shadow flags and depth, and drops what no view takes', () => {
  {
    const code = vsmRenderCandidatesWgsl()
    assert.ok(code.includes('vsmRenderFarFlags(roots.word,w)'), 'one rule for every caster')
    assert.ok(code.includes('vsmRenderFarDepth(object)'))
    assert.equal(
      functionsOf(code, ['vsmRenderCaster']).match(/vsmRootWords\(w\)/g)?.length,
      1,
      'its placement’s words, read once',
    )
    const drop = code.indexOf('if(vsmFarShadowSkipped(flags,farDepth,params.farDrop)){return;}')
    assert.ok(drop > 0 && drop < code.indexOf('atomicAdd(&counts[0]'), 'dropped before the append')
    assert.ok(
      (code.match(/var<storage/g)?.length ?? 0) <= 8,
      'within the eight storage buffers a stage holds',
    )
  }
  const candidate = wgslStructLayout(CULL, 'VsmRenderCandidate')
  assert.deepEqual([candidate.size, candidate.offsets.farDepth], [VSM_RENDER_CANDIDATE_BYTES, 76])
  const { a0, a1, a2, corners, flags, axisFit } = candidate.offsets
  assert.deepEqual([a0, a1, a2], [32, 48, 64], 'the half axes, each with a scalar behind it')
  assert.deepEqual([corners, flags], [44, 60], 'the scalars fill the vec3s’ fourth words')
  assert.equal(axisFit, 160, 'the fit of the half axes behind the rest')
  const { at } = VSM_RENDER_PARAMS
  assert.equal(
    [at.farMeshes, at.farDrop].every((word) => word !== undefined),
    true,
    'the scope',
  )
})

test('a caster the main view’s filter leaves out casts no shadow, none where no filter is named', () => {
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
  // The skip, in the candidates, after the cut's world gate: but for an object that stands for a
  // first-person one or casts while hidden, which the filter hides from the view and which casts all the same.
  assert.ok(
    vsmRenderCandidatesWgsl().includes(
      'if(!worldDraws(i,w)||(vsmRenderFilteredOut(w)&&(roots.word&384u)==0u)){return;}',
    ),
  )
  assert.equal(VSM_RENDER_PARAMS.at.filterBase !== undefined, true, 'the parameters carry it')
})

// A displaced surface's record is marked for the tessellation where its light's maps ask it
// (`VsmRenderParams.tessellated`): candidate, then the record the cull emits (bit 23); the raster
// drops it. (The commands and their expand are gone: the cull emits the records itself.)
test('a displaced surface’s records are marked from its candidate to the raster, which draws none of their triangles', () => {
  const { vsmRecordTessellated } = shaderRun<{ vsmRecordTessellated(r: number[]): boolean }>(
    VSM_RENDER_RECORD_WGSL,
    ['vsmRecordTessellated'],
    {},
  )
  assert.deepEqual(
    [1 << 23, 0, 1 << 22].map((y) => vsmRecordTessellated([0, y, 0, 0])),
    [true, false, false],
  )
  // An opaque row is marked, a masked one too: the patches cut it out (`vsmTessellatedVertexWgsl`).
  const mark = 'params.tessellated!=0u&&tessellatedFlags(page)'
  const candidates = vsmRenderCandidatesWgsl()
  assert.ok(candidates.includes(`${mark};`) && !candidates.includes(`${FLAG_MASK}u)==0u`))
  const cull = functionsOf(CULL, ['vsmRenderCullView'])
  for (const text of [
    'select(VSM_RENDER_TESSELLATE_LOCAL,VSM_RENDER_TESSELLATE_DIRECTIONAL,directional)',
    // The kind of light's bit: `tessKind`, `kind` being the cull's own now (the occlusion's culls).
    '(cand.flags&VSM_RENDER_CAND_TESSELLATED)!=0u&&(params.tessellated&tessKind)!=0u',
    '|select(0u,1u<<23u,tessellated)',
  ])
    assert.ok(cull.includes(text), text)
  const vs = functionsOf(CODE, ['vsmRenderVs'])
  const drop = vs.indexOf(
    'if(vsmRecordTessellated(record)){out.position=vsmRenderNan();return out;}',
  )
  assert.ok(drop > 0 && drop < vs.indexOf('pages['), 'dropped before its row is read')
})

// Each map's view selects its own level of detail (`vsmRenderLodAt`), as the reference's shadow
// views each select their clusters: the cut rule on the
// cluster's error and its parent's in the view's own pixels. A sun level 200 m tall over 16 384
// texels: 81.92 texels a metre at mip 0, a threshold of one texel.
test('a map’s view draws the clusters its own texels ask: the cut rule in its pixels', () => {
  const run = shaderRun<{
    vsmRenderViewPixels(...a: unknown[]): number
    vsmRenderLodAt(...a: unknown[]): number
  }>(CULL, ['vsmRenderViewPixels', 'vsmRenderLodAt'], {
    ...wgslConstants(CULL),
    params: { threshold: 1 },
  })
  const identity = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  const ortho = new Mat([0.01, 0, 0, 0, 0, 0.01, 0, 0, 0, 0, 0.001, 0, 0, 0, 0, 1])
  const focal = 0.5 * 0.01 * 16384
  const lens = { focal, near: 0, perspective: false }
  assert.equal(run.vsmRenderViewPixels(0.01, [0, 0, 0], 1, identity, ortho, lens), 0.01 * focal)
  const CHILD = wgslConstants(CULL).VSM_RENDER_CAND_CHILD_RESIDENT
  const cand = (own: number, parent: number, child = true) => ({
    ...{ c: [0, 0, 0, 1], l: [0, 0, 0], row: 0, corners: 3, flags: child ? CHILD : 0 },
    ...{ farDepth: 0, own: [0, 0, 0, 0.5], parent: [0, 0, 0, 1] },
    errors: [own, parent],
  })
  const draws = (own: number, parent: number, child?: boolean) =>
    run.vsmRenderLodAt(cand(own, parent, child), [0, 0, 0], identity, ortho, lens) !== 0
  assert.equal(draws(0.01, 0.02), true, 'its error within a texel, its parent past it')
  assert.equal(draws(0.02, 0.04), false, 'too coarse, its finer group resident')
  assert.equal(draws(0.02, 0.04, false), true, 'too coarse, its finer group not resident')
  assert.equal(draws(0.005, 0.01), false, 'its parent fine enough')
  assert.equal(draws(0.005, -1), true, 'a root')
  assert.equal(
    run.vsmRenderLodAt(cand(0.02, 0.04, false), [0, 0, 0], identity, ortho, lens),
    wgslConstants(CULL).VSM_RENDER_LOD_BEHIND,
    'drawn behind: over a texel, its finer group not resident',
  )
})
