// The radiance cache's hit lighting (`cache/cacheHitLit*.ts`): the trace that marks the hits, the compaction, the two lit passes and the stage that keeps them.
import test from 'node:test'
import assert from 'node:assert/strict'
import { hitLightingOf } from '../../../../sdk-core/src/contracts/hitLightingOptions.ts'
import { reservedNames } from '../../gpu/core/wgslNames.fixture.ts'
import { WORD_LIGHT_FORMAT } from '../../gpu/core/lightAtlasFormat.ts'
import {
  cacheLitCompactProgram,
  cacheLitDirectProgram,
  cacheLitFinishProgram,
} from './cache/cacheHitLitWgsl.ts'
import {
  CACHE_LIT_CALM_IMAGES,
  cacheHitLightWord,
  cacheLitAdmitted,
  cacheLitAsked,
  cacheLitKernelsOf,
  cacheLitMostTiles,
  cacheLitRefusalWaits,
  cacheLitTiles,
  cacheTracedKernelOf,
  cacheLitRefused,
  cacheLitWanted,
} from './cache/cacheHitLit.ts'
import { CACHE_LIT_FRONT, CACHE_LIT_MARK, CACHE_LIT_TWO_SIDED } from './cache/cacheLitMark.ts'
import { RADIANCE_CACHE_PARAMS } from './cache/cacheLayout.ts'
import { cacheTracedProgramOf } from './cache/cacheTraceWgsl.ts'
import {
  encodeLitList,
  singleBounceLightWord,
  type LitListRun,
} from '../reflections/hitLighting/listPasses.ts'
import { RETRY_MS } from '../../gpu/core/backoff.ts'
import { retryAt } from '../../gpu/core/refusal.ts'
import { HIT_LIGHT_MODE } from '../reflections/hitLighting/constants.ts'

const hit = (over = {}) =>
  hitLightingOf({
    reflectionHardwareRayTracingHitLighting: false,
    reflectionHardwareRayTracingBucketMaterials: true,
    hardwareRayTracingLightingMode: 'hitLighting',
    hardwareRayTracingHitLightingAllowed: true,
    hardwareRayTracingHitLightingDirectLighting: true,
    hardwareRayTracingHitLightingShadowMode: 'soft',
    hardwareRayTracingHitLightingSkylight: 'standalone',
    hardwareRayTracingHitLightingReflectionCaptures: true,
    hardwareRayTracingHitLightingForceOpaque: false,
    hardwareRayTracingHitLightingShadowTranslucencyMode: 'masked',
    reflectionMaxBounces: 5,
    reflectionRayTracedTranslucentRefractions: true,
    reflectionMaxRefractionBounces: 3,
    rayTracingLightGridResolution: 256,
    rayTracingLightGridMaxCount: 128,
    rayTracingLightGridAxis: -1,
    ...over,
  })

const MARKING = cacheTracedProgramOf(WORD_LIGHT_FORMAT, undefined, true)
const PLAIN = cacheTracedProgramOf(WORD_LIGHT_FORMAT)

test('the trace marks a hit on a triangle with its material key and sides, writes it beside the atlas, and lights nothing from the cards nor leaks the sky onto it', () => {
  assert.match(
    MARKING,
    /probeMark=vec2u\(cacheLitMark\(hit\.placement,hit\.record,hit\.frontFace,hit\.twoSided\),bitcast<u32>\(hit\.distance\)\);/,
  )
  assert.ok(!MARKING.includes('out.lighting=tracedHitLight'))
  assert.match(
    MARKING,
    /textureStore\(marksOut,traceAtlasAt\(rank,local\),vec4u\(probeMark,tile\.x,tile\.y\)\);/,
  )
  assert.match(MARKING, /let leaks=cacheLeaks\(\)&&probeMark\.x==0u;/)
  assert.ok(PLAIN.includes('out.lighting=tracedHitLight') && !PLAIN.includes('probeMark'))
  assert.match(PLAIN, /let leaks=cacheLeaks\(\);/)
})

test('the mark bit and the sides stay clear of the key of the material, which the sort reads in the low fifteen bits', () => {
  assert.equal(CACHE_LIT_MARK, 0x80000000)
  assert.equal(0x7fff & (CACHE_LIT_FRONT | CACHE_LIT_TWO_SIDED | CACHE_LIT_MARK), 0)
  assert.equal(CACHE_LIT_FRONT & CACHE_LIT_TWO_SIDED, 0)
})

test('the compaction lists the marked rays of the slice’s tiles with the distance of their hit, and the list is emptied by a pass before each slice', () => {
  const text = cacheLitCompactProgram()
  assert.match(text, /fn cacheLitReset\(\)\{atomicStore\(&litList\.count,0u\);\}/)
  assert.match(text, /fn cacheLitCompact\(/)
  assert.match(text, /if\(\(mark\.x&2147483648u\)==0u\)\{return;\}/)
  assert.match(text, /litList\.entries\[slot\]=vec2u\(place\.x\|\(place\.y<<16u\),mark\.y\);/)
})

test('the first pass casts the ray again from its probe’s centre with no face culled, a sun shadow ray runs the probes’ reach and a back face ends the path', () => {
  const text = cacheLitDirectProgram()
  assert.match(text, /LitRay\(queuedPosition\(ray\.queued\),found\+0\.01,ST_SKIP_TRANSLUCENT\)/)
  assert.ok(!text.includes('ST_CULL_BACK|') && !/flags\|=ST_CULL_BACK/.test(text))
  assert.match(text, /fn litSunReach\(\)->f32\{return bounce\.reach\.x;\}/)
  assert.match(
    text,
    /fn litBackFaceEnds\(hit:StHit\)->bool\{return !hit\.frontFace&&!hit\.twoSided;\}/,
  )
  // The path is taken from the cache’s eye and its pre-exposure; the lights’ exposure is the cache’s own word (the queued image’s view), never the GPU’s uniform every view shares.
  assert.match(text, /stTrace\(StRay\(origin-cache\.eye\.xyz,/)
  assert.ok(!text.includes('view.display'))
  assert.match(text, /let exposure=cache\.litExposure;/)
  assert.ok(!text.includes('view.preExposure') && !text.includes('var<uniform> view'))
})

test('the second pass reads the cards over the cone of the ray, adds the leaking sky light where the cache makes irradiance maps and writes the atlas texel with the hit’s word under the cache’s pre-exposure', () => {
  const text = cacheLitFinishProgram(WORD_LIGHT_FORMAT)
  assert.match(text, /LitLook\(f32\(ray\.trace\),ray\.coord\)/)
  assert.match(
    text,
    /radiance\+=select\(vec3f\(0\.0\),cacheSkyLeak\(ray\.direction,found\),cacheLeaks\(\)\);/,
  )
  assert.match(
    text,
    /traceRayLight\(makeFinite3\(radiance\)\*bounce\.reach\.z,ray\.rank,ray\.local\)/,
  )
  assert.match(
    text,
    /cacheDepthWord\(found,true,0\.0,cacheLitFront\(mark\),cacheLitTwoSided\(mark\)\)/,
  )
})

test('the passes name no reserved word', () => {
  for (const text of [
    MARKING,
    cacheLitCompactProgram(),
    cacheLitDirectProgram(),
    cacheLitFinishProgram(WORD_LIGHT_FORMAT),
  ])
    assert.deepEqual(reservedNames(text), [])
})

test('the cache’s parameters carry the word the hits are lit with, the screen probes’ word: one bounce, no refraction, no reflection capture', () => {
  assert.ok('lit' in RADIANCE_CACHE_PARAMS.at && 'litExposure' in RADIANCE_CACHE_PARAMS.at)
  const word = cacheHitLightWord({
    settings: hit(),
    lightFunction: {} as GPUBindingResource,
    lightProfile: {} as never,
    lightGrid: {} as never,
    lightGridView: {} as GPUTextureView,
    exposure: 1,
  })
  assert.equal(word, singleBounceLightWord(hit()))
  assert.equal((word >> HIT_LIGHT_MODE.bouncesShift) & 127, 1)
  assert.equal((word >> HIT_LIGHT_MODE.refractionsShift) & 127, 0)
  assert.equal(word & HIT_LIGHT_MODE.captures, 0)
})

test('the kernels are asked only where the settings light the probes’ hits, the image has the scene trace and the cache’s rays go through the triangles', () => {
  const given = (settings: ReturnType<typeof hit>) => ({
    hit: { settings, lightFunction: {}, lightProfile: {}, exposure: 1 },
    rays: {},
  })
  const asked = (queued: object, traced = true) =>
    cacheLitKernelsOf({} as GPUDevice, queued as never, WORD_LIGHT_FORMAT, traced)
  const reflectionsOnly = hit({ hardwareRayTracingLightingMode: 'hitLightingForReflections' })
  assert.equal(asked({ rays: {} }), undefined, 'no hit lighting inputs')
  assert.equal(asked({ hit: given(hit()).hit }), undefined, 'no scene trace in the image')
  assert.equal(asked(given(reflectionsOnly)), undefined, 'a mode for the reflections alone')
  assert.equal(asked(given(hit()), false), undefined, 'the rays are marched through the field')
})

test('a slice holds as many tiles as the device’s storage binding holds the rays’ radiance of', () => {
  const limits = { maxStorageBufferBindingSize: 64 * 64 * 10, maxBufferSize: 1e12 }
  assert.equal(cacheLitMostTiles({ limits } as GPUDevice), 10)
  assert.equal(
    cacheLitMostTiles({ limits: { ...limits, maxBufferSize: 64 * 64 * 3 } } as GPUDevice),
    3,
  )
})

test('the passes over a list run in order, the list emptied first where the kernels empty it, the scene trace’s group set where the host says', () => {
  const calls: string[] = []
  const pipe = (name: string) => name as unknown as GPUComputePipeline
  const group = (name: string) => name as unknown as GPUBindGroup
  const pass = {
    setPipeline: (p: unknown) => calls.push(`pipeline ${p}`),
    setBindGroup: (at: number, g: unknown) => calls.push(`group ${at} ${g}`),
    dispatchWorkgroups: (n: number) => calls.push(`dispatch ${n}`),
    dispatchWorkgroupsIndirect: (b: unknown, offset: number) =>
      calls.push(`indirect ${b} ${offset}`),
  } as unknown as GPUComputePassEncoder
  const run = (bucket: boolean, reset?: string) =>
    ({
      kernels: {
        reset: reset ? pipe(reset) : undefined,
        compact: pipe('compact'),
        list: {
          dispatch: pipe('count'),
          copy: pipe('copy'),
          sortArgs: pipe('sortArgs'),
          sort: pipe('sort'),
        },
        direct: pipe('direct'),
        finish: pipe('finish'),
      },
      resources: { args: 'args' },
      groups: Object.fromEntries(
        ['compact', 'dispatch', 'copy', 'sortArgs', 'sort', 'direct', 'scene', 'finish'].map(
          (n) => [n, group(n)],
        ),
      ),
      sceneGroup: 1,
      bucket,
    }) as unknown as LitListRun
  encodeLitList(pass, run(true, 'reset'), 'tiles' as unknown as GPUBuffer)
  assert.deepEqual(
    calls.filter((c) => c.startsWith('pipeline')),
    ['reset', 'compact', 'count', 'sortArgs', 'sort', 'direct', 'finish'].map(
      (n) => `pipeline ${n}`,
    ),
  )
  assert.ok(calls.includes('group 1 scene') && calls.includes('indirect tiles 0'))
  calls.length = 0
  encodeLitList(pass, run(false), 'tiles' as unknown as GPUBuffer)
  assert.deepEqual(
    calls.filter((c) => c.startsWith('pipeline')),
    ['compact', 'count', 'copy', 'direct', 'finish'].map((n) => `pipeline ${n}`),
  )
})

test('a host with a view group sets it for each pass, and the second pass binds its own scene group', () => {
  const calls: string[] = []
  const pipe = (name: string) => name as unknown as GPUComputePipeline
  const group = (name: string) => name as unknown as GPUBindGroup
  const pass = {
    setPipeline: (p: unknown) => calls.push(`pipeline ${p}`),
    setBindGroup: (at: number, g: unknown) => calls.push(`group ${at} ${g}`),
    dispatchWorkgroups: () => {},
    dispatchWorkgroupsIndirect: () => {},
  } as unknown as GPUComputePassEncoder
  const run = {
    kernels: {
      compact: pipe('compact'),
      list: { dispatch: pipe('count'), copy: pipe('copy'), sortArgs: pipe('s'), sort: pipe('o') },
      direct: pipe('direct'),
      finish: pipe('finish'),
    },
    resources: { args: 'args' },
    groups: {
      ...Object.fromEntries(
        ['compact', 'dispatch', 'copy', 'sortArgs', 'sort', 'direct', 'scene', 'finish'].map(
          (n) => [n, group(n)],
        ),
      ),
      finishScene: group('finishScene'),
    },
    sceneGroup: 2,
    bucket: false,
    view: { index: 1, direct: group('viewDirect'), finish: group('viewFinish') },
  } as unknown as LitListRun
  encodeLitList(pass, run, 'tiles' as unknown as GPUBuffer)
  const sets = calls.slice(calls.indexOf('pipeline direct'))
  assert.deepEqual(sets, [
    'pipeline direct',
    'group 0 direct',
    'group 1 viewDirect',
    'group 2 scene',
    'pipeline finish',
    'group 0 finish',
    'group 1 viewFinish',
    'group 2 finishScene',
  ])
})

test('the user’s mode is the word the maps are made under, an image without the scene trace only falling back to the cards', () => {
  const settings = hit()
  const hitLighting = { settings, lightFunction: {}, lightProfile: {}, exposure: 1 }
  assert.equal(cacheLitWanted({ hit: hitLighting as never }, true), true)
  assert.equal(cacheLitWanted({ hit: hitLighting as never }, false), false)
  assert.equal(cacheLitWanted({}, true), false)
  assert.equal(cacheLitAsked({ hit: hitLighting, rays: undefined } as never, true), false)
  assert.equal(cacheLitAsked({ hit: hitLighting, rays: {} } as never, true), true)
})

test('the lights of the cache’s hits are strengthened under the exposure of the image the update was queued in, the light held under the cache’s pre-exposure, and a sum that is not finite is taken to zero', () => {
  const direct = cacheLitDirectProgram()
  const finish = cacheLitFinishProgram(WORD_LIGHT_FORMAT)
  assert.match(direct, /let exposure=cache\.litExposure;/)
  for (const text of [direct, finish])
    assert.match(text, /fn litScale\(\)->f32\{return max\(bounce\.reach\.z,1\.0e-6\);\}/)
  assert.match(
    direct,
    /litPack\(min\(weight\*\(material\.emissive\+direct\)\*litScale\(\),vec3f\(65504\.0\)\),1\.0\)/,
  )
  assert.match(finish, /radiance\+=base\.xyz\/litScale\(\);/)
  assert.match(finish, /makeFinite3\(radiance\)\*bounce\.reach\.z/)
})

test('a refused hit lighting is asked again after the shared backoff, doubling at each refusal in a row, whatever the slice asked meanwhile', () => {
  assert.equal(cacheLitRefusalWaits(undefined, 0), false, 'nothing refused')
  const first = cacheLitRefused(undefined, 8, 1000, 0.5)
  assert.equal(first.refusal.wait, RETRY_MS, 'the spread at its middle leaves the first wait whole')
  assert.equal(cacheLitRefusalWaits(first, 1000), true, 'waits for the backoff')
  assert.equal(cacheLitRefusalWaits(first, retryAt(first.refusal)), false, 'the wait ended')
  const second = cacheLitRefused(first, 8, retryAt(first.refusal), 0.5)
  assert.equal(second.refusal.refusals, first.refusal.refusals + 1)
  assert.equal(second.refusal.wait, first.refusal.wait * 2, 'the wait doubles at each refusal')
})

test('the lists are sized for the tiles the update traces, at most the device holds, never rounded up to whole rows', () => {
  const device = {
    limits: { maxStorageBufferBindingSize: 1 << 30, maxBufferSize: 1 << 30 },
  } as GPUDevice
  assert.equal(cacheLitTiles(device, 700), 700)
  const most = cacheLitMostTiles(device)
  assert.equal(cacheLitTiles(device, most + 5), most)
})

test('the plain traced kernels are asked of the mask hold at every call, beside the hit lighting’s', () => {
  const calls: string[] = []
  const rays = {
    sceneTrace: {
      maskHold: { use: (name: string) => (calls.push(name), { kernel: { ready: true } }) },
    },
  }
  const kernel = cacheTracedKernelOf({} as GPUDevice, rays as never, WORD_LIGHT_FORMAT)
  assert.deepEqual(calls, ['radiance cache'])
  assert.deepEqual(kernel, { ready: true })
})

test('a refusal outlives the images admitted at a smaller slice, so that the refusal that comes back doubles the wait; the slice refused, admitted, or a long calm forgets it', () => {
  const first = cacheLitRefused(undefined, 8, 0, 0.5)
  const kept = cacheLitAdmitted(first, 4)
  assert.equal(kept, first, 'a smaller slice admitted keeps the refusal')
  const again = cacheLitRefused(kept, 8, retryAt(first.refusal), 0.5)
  assert.equal(again.refusal.wait, first.refusal.wait * 2, 'big refused again: the wait doubled')
  assert.equal(cacheLitAdmitted(first, 8), undefined, 'the refused slice itself admitted')
  assert.equal(cacheLitAdmitted(undefined, 8), undefined)
  const calm = cacheLitRefused(undefined, 8, 0, 0.5)
  for (let image = 1; image < CACHE_LIT_CALM_IMAGES; image++)
    assert.equal(cacheLitAdmitted(calm, 4), calm, `image ${image} keeps it`)
  assert.equal(cacheLitAdmitted(calm, 4), undefined, 'a long calm forgets it')
})
