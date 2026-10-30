import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslModule } from '../../../../../../math/src/wgsl/assemble.ts'
import { FULL_CONTRACT } from '../../../deferred/contractCuts.ts'
import { TILE_CLASS } from '../../../deferred/tileClass.ts'
import { samplingWgsl } from '../../samplingWgsl.ts'
import { COMPLEXITY_ENTRY_WORDS, COMPLEXITY_MAX_LIGHTS } from './entries.ts'
import { COST_ENTRY, HEATMAP_ENTRY, HEATMAP_WGSL, costWgsl } from './costWgsl.ts'
import { REPLAY_ENTRY, replayWgsl } from './replayWgsl.ts'

const replay = (front = false, textured = true) =>
  wgslModule(replayWgsl(FULL_CONTRACT, front, textured))
const sampling = () => wgslModule(samplingWgsl(FULL_CONTRACT, TILE_CLASS.complex, true))

const count = (text: string, part: string) => text.split(part).length - 1

test('the replay assembles for the surfaces and for the nearest translucent layer, a compute entry that discards nothing', () => {
  for (const code of [replay(), replay(true), replay(false, false)]) {
    assert.ok(code.includes(`fn ${REPLAY_ENTRY}(`))
    assert.ok(code.includes(`@workgroup_size(${COMPLEXITY_MAX_LIGHTS / 2},1,1)`))
    assert.ok(!code.includes('discard'))
  }
  // The layer keeps no diffuse colour where it keeps the specular light alone, as its sampling does.
  assert.ok(replay(true).includes('shading.diffuse=vec3f(0.0)'))
  assert.ok(!replay().includes('shading.diffuse=vec3f(0.0)'))
})

test('the replay weighs a light with the sampling’s own functions, written once in each program', () => {
  const kernel = replay()
  const draw = sampling()
  for (const code of [kernel, draw]) {
    assert.equal(count(code, 'fn weighLight('), 1)
    assert.equal(count(code, 'fn lightSeenBefore('), 1)
  }
  // The sampling offers what `weighLight` says, so the weight the replay lists is the one the draw uses.
  assert.match(
    draw,
    /fn offerLight\([^)]*\)\{\n let weighed=weighLight\(rank,albedo,metal,rough,N,V,P,shading,radial\);/,
  )
  assert.ok(draw.includes('lightSeenBefore(rank,weighed.luminance,visibleSet)'))
  assert.ok(kernel.includes('weighLight(rank,albedo,base.a,normal.a,N,V,P,shading,true)'))
  assert.ok(kernel.includes('weighLight(rank,albedo,base.a,normal.a,N,V,P,shading,false)'))
  assert.ok(kernel.includes('lightSeenBefore(rank,weighed.luminance,visibleSet)'))
})

test('the replay walks the lights the draw walks: the cell’s drawn local lights, then the suns where they join', () => {
  const kernel = replay()
  const draw = sampling()
  for (const rule of [
    'for(var index=0u;index<cell.y;index++){',
    'let rank=listedLight(cell,index);',
    'if(!listedDrawn(cell,rank)||!sampledTakes(rank)){continue;}',
    'if(isSun(directLights.items[rank])){continue;}',
    'if(params.directional!=0u){',
    'for(var index=1u;index<=sunRanks[0];index++){',
  ])
    assert.ok(kernel.includes(rule) && draw.includes(rule), rule)
  // The pixel’s place in the image before, its guide set and its cell are the sampling’s statements.
  const place = 'let cell=cellSlice(pixelCell(pixel.xy,z));'
  assert.ok(kernel.includes(place) && draw.includes(place))
  assert.ok(kernel.includes('let visibleSet=guideVisibleSet(tileIndex,onScreen);'))
})

/** The sort the kernel writes, run on the CPU: the same levels, steps and swap rule over keys and ranks. */
function bitonic(keys: number[], ranks: number[]) {
  const levels = Math.log2(keys.length)
  for (let level = 0; level < levels; level++)
    for (let step = 0; step <= level; step++) {
      const distance = 1 << (level - step)
      for (let lane = 0; lane < keys.length / 2; lane++) {
        const mine = Math.floor(lane / distance) * (distance * 2) + (lane % distance)
        const other = mine + distance
        const ascending = (mine & (1 << (level + 1))) !== 0
        const swap = ascending
          ? keys[mine]! > keys[other]! ||
            (keys[mine] === keys[other] && ranks[mine]! < ranks[other]!)
          : keys[mine]! < keys[other]! ||
            (keys[mine] === keys[other] && ranks[mine]! > ranks[other]!)
        if (swap) {
          ;[keys[mine], keys[other]] = [keys[other]!, keys[mine]!]
          ;[ranks[mine], ranks[other]] = [ranks[other]!, ranks[mine]!]
        }
      }
    }
}

test('the kernel’s sort rule orders any weights heaviest first, equal weights by rank, the empty entries last', () => {
  const kernel = replay()
  // The text holds the rule the CPU run above writes.
  for (const rule of [
    'let mine=lane/distance*(distance*2u)+lane%distance;',
    'let ascending=(mine&(1u<<(level+1u)))!=0u;',
    'if(ascending){swap=myKey>otherKey||(myKey==otherKey&&myRank<otherRank);}',
    'else{swap=myKey<otherKey||(myKey==otherKey&&myRank>otherRank);}',
    `for(var level=0u;level<${Math.log2(COMPLEXITY_MAX_LIGHTS)}u;level++){`,
  ])
    assert.ok(kernel.includes(rule), rule)
  let seed = 12345
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32
  for (const listed of [0, 1, 7, 40, COMPLEXITY_MAX_LIGHTS]) {
    const weights = Array.from({ length: listed }, () => Math.floor(random() * 6))
    const keys = Array.from({ length: COMPLEXITY_MAX_LIGHTS }, (_, i) =>
      i < listed ? weights[i]! : 0,
    )
    const ranks = Array.from({ length: COMPLEXITY_MAX_LIGHTS }, (_, i) =>
      i < listed ? i : 0xffffffff,
    )
    bitonic(keys, ranks)
    const expected = weights
      .map((weight, rank) => [weight, rank] as const)
      .sort((a, b) => b[0] - a[0] || a[1] - b[1])
    expected.forEach(([weight, rank], at) => {
      assert.equal(keys[at], weight)
      assert.equal(ranks[at], rank)
    })
    // The entries past the listed ones carry no rank.
    for (let at = listed; at < COMPLEXITY_MAX_LIGHTS; at++) assert.equal(ranks[at], 0xffffffff)
  }
})

test('an entry is eight words and the sort copies whole entries into the result after the header', () => {
  const kernel = replay()
  assert.equal(COMPLEXITY_ENTRY_WORDS, 8)
  assert.ok(
    kernel.includes('for(var word=0u;word<8u;word++){result[outAt+word]=entries[source+word];}'),
  )
})

test('the cost kernel adds the costs of the reference per light and the heat map paints blue to red', () => {
  const cost = costWgsl()
  assert.ok(cost.includes(`fn ${COST_ENTRY}(`))
  for (const part of [
    'return 0.1;',
    'var total=1+add;',
    'total+=0.25+select(0.0,0.5,rectSlotOf(light).z>0.0);',
    'if(isAreaLight(light)){total+=0.25;}',
    'if(hasLightFunction(light)){total+=0.5;}',
    'if(lightProfileLane(light)!=0u){total+=0.5;}',
  ])
    assert.ok(cost.includes(part), part)
  // A pixel of another shading model adds a quarter, one with a lobe of its own a half.
  assert.ok(cost.includes('select(select(0.0,0.25,found==2u),0.5,found==3u)'))
  const heat = wgslModule(HEATMAP_WGSL)
  assert.ok(heat.includes(`fn ${HEATMAP_ENTRY}(`))
  assert.ok(heat.includes('let hue=(1.0-saturate(x))*0.6;'))
  assert.ok(heat.includes('select(vec3f(1.0),hsvDebugColor(cost/heat.maxCost),cost>0.0)'))
})
