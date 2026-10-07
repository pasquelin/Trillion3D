// At full transmission the water's lit colour carries no share of the composite, `(1-t)·alpha·lit`
// an exact zero: the composite does not light it (the bounce walk, the environment, the emission).
// The shipped `waterColor` runs as JavaScript (`shaderRun`) on random water pixels, every read
// beside it a pure function of the pixel — random finite lighting, reflection, backdrop and fog —:
// at t = 1 the composed colour does not depend on the lit terms (bounce, environment, emission),
// which it does not evaluate; and only below it is the colour lit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { waterCompositeShader } from './compositeWgsl.ts'

type Color = (pixel: number[]) => number[]

/** One random water pixel: what each read beside `waterColor` returns for it. */
function pixelOf(r: () => number, t: number) {
  const u = (lo: number, hi: number) => lo + (hi - lo) * r(),
    v3 = (lo: number, hi: number) => [u(lo, hi), u(lo, hi), u(lo, hi)],
    // Lighting spans many magnitudes: a lit sum that a zero share must cancel, however large.
    big = () => v3(0, 1).map((x) => x * 10 ** u(-3, 6))
  return {
    textures: {
      baseMetal: [...v3(0, 1), u(0, 1)],
      normalRough: [...v3(-1, 1), u(0, 1)],
      emissiveAoTexture: [...big(), u(0, 1)],
      depth: u(0.01, 1),
    },
    volume: { transmission: t, eta: u(0.5, 1), thickness: u(0, 3), f0: u(0, 0.1) },
    attenuation: [...v3(0, 1), r() < 0.5 ? 0 : 1],
    alpha: u(0, 1),
    declared: { lit: big(), specular: big() },
    bounce: big(),
    environment: big(),
    radiance: big(),
    through: { color: v3(0, 4), coverage: r() < 0.3 ? u(0, 1) : 1 },
    fog: u(0, 1),
  }
}

type Pixel = ReturnType<typeof pixelOf>

/** `waterColor` of shader text `text`, translated once: on a pixel, its colour and how many times
 *  it lit it. WGSL lets the local `emissiveAo` shadow the texture it reads; JavaScript does not:
 *  the texture is renamed. */
function runner(text: string) {
  let pixel: Pixel, lit: number
  const textures = ['baseMetal', 'normalRough', 'emissiveAoTexture', 'depth']
  const { waterColor } = shaderRun<{ waterColor: Color }>(
    text.replace('textureLoad(emissiveAo,', 'textureLoad(emissiveAoTexture,'),
    // With the lobeless program's stand-ins (`WATER_LOBELESS_WGSL`, `lobeThrough`) and the marks.
    ['waterColor', 'waterLobes', 'waterCoatMirror', 'lobeThrough', 'volumeMarked', 'fresnelScalar'],
    {
      ...Object.fromEntries(textures.map((name) => [name, { name }])),
      textureLoad: ({ name }: { name: keyof Pixel['textures'] }) => pixel.textures[name],
      waterWordAt: () => 1,
      waterRank: () => 0,
      waterOpacity: () => pixel.alpha,
      // The pixel's volume at its rank, the only one.
      volumes: {
        get 0() {
          return { ...pixel.volume, attenuation: pixel.attenuation }
        },
      },
      worldAt: () => [0.5, 1, -2],
      waterShadowFootprint: () => 1,
      shadowFootprint: 0,
      shadowSetView: () => undefined,
      view: { camera: [0, 1, 0, 0], viewport: [8, 8, 0, 0], jitter: [0, 0, 0, 0] },
      uni: { viewFlags: 0, eye: [0, 1, 0, 0] },
      waterViewDirection: () => [0, 0.6, 0.8],
      waterFacing: (normal: number[]) => normal,
      declaredLightingPair: () => pixel.declared,
      bounceLighting: () => (lit++, pixel.bounce),
      environmentLighting: () => pixel.environment,
      resolvedRadiance: () => pixel.radiance,
      transmittedBackdrop: () => pixel.through,
      fogged: (color: number[]) => color.map((c) => c * pixel.fog + 0.25 * (1 - pixel.fog)),
    },
  )
  return (at: Pixel) => {
    pixel = at
    lit = 0
    return { color: waterColor([3.5, 4.5, 0.5, 1]), lit }
  }
}

test('a fully transmissive pixel composes the same numbers without lighting its colour', () => {
  const r = random(1468),
    // The program without lobe code: a lobed one adds terms under the same share (`waterLobesWgsl.ts`).
    run = runner(waterCompositeShader(false, { lobeless: true }))
  for (let round = 0; round < 4000; round++) {
    const t = round % 2 ? 1 : r()
    const pixel = pixelOf(r, t)
    const shipped = run(pixel)
    assert.ok(shipped.color.every(Number.isFinite), 'a finite pixel')
    assert.equal(shipped.lit, t < 1 ? 1 : 0, 'lit only where the share is not zero')
    if (t < 1) continue
    // Every lit term replaced by another: the colour is the same number, a zero's sign aside.
    const other = pixelOf(r, t)
    const swapped = run({
      ...pixel,
      bounce: other.bounce,
      environment: other.environment,
      textures: {
        ...pixel.textures,
        emissiveAoTexture: [
          ...other.textures.emissiveAoTexture.slice(0, 3),
          pixel.textures.emissiveAoTexture[3],
        ],
      },
    })
    shipped.color.forEach((c, i) => assert.ok(swapped.color[i] === c, `round ${round}, t ${t}`))
  }
})
