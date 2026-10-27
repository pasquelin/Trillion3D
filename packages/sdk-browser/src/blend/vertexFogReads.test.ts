// What a scene's surfaces make the programs hold: the fog laid per vertex only where some surface takes it so
// (`fogVertexOf`), and the translucency lighting volume only where it lights a layer (`translucencyVolumeOf`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { fogVertexOf, type BlendedSurface } from './pipelines.ts'
import {
  blendLightSource,
  blendLightingOf,
  translucencyVolumeOf,
} from '../materials/surface/blendLightSource.ts'
import { BLEND_MODES } from '../materials/surface/materialBlending.ts'
import {
  PIXEL_MODEL,
  PIXEL_MODEL_MASK,
  PIXEL_MODEL_SHIFT,
  shadingReflects,
} from '../materials/surface/pixelModel.ts'
import { SURFACE_MODEL, SURFACE_MODEL_MASK } from '../materials/surface/surfaceModelWord.ts'
import {
  LIGHTLESS_MODEL,
  TRANSLUCENCY_LIGHTING_CODE,
} from '../materials/surface/translucencyLighting.ts'
import { shadingModelCode } from '../materials/surface/shadingModelCode.ts'
import { writeMaterialRecord, type MaterialSurface } from '../materials/table/materialRecord.ts'
import { MATERIAL_RECORD, MATERIAL_RECORD_WORDS } from '../materials/table/materialLayout.ts'
import { GRAPH_SHADING_MODELS } from '../../../sdk-core/src/world/material/graph/outputs.ts'
import { cloudVertexText } from './cloudVertexText.ts'
import { locationsOf } from './vertexLocations.fixture.ts'
import { blendShader } from './shader.ts'
import { shaderRun } from '../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { blendVertexWgsl } from './vertexWgsl.ts'
import { DIAGNOSTIC_VIEWS } from '../visibility/shader/shadeMode.ts'
import {
  DIAGNOSTIC_CODE_MASK,
  DIAGNOSTIC_CODE_SHIFT,
  FLAG_DIAGNOSTIC_VIEW,
} from '../visibility/types.ts'
import { SHADING_MODEL_MODEL_SHIFT } from '../materials/surface/surfaceModelWord.ts'
import { blendReflects, blendFrontShader } from './frontStageWgsl.ts'

const item = (surface: Record<string, unknown>, transmissive = false) =>
  ({
    surface: { lit: true, translucencyLighting: 'volume', blending: 'normal', ...surface },
    transmissive,
  }) as unknown as BlendedSurface

test('the fog is laid per vertex only where a surface takes it so', () => {
  assert.equal(fogVertexOf([item({})]), true)
  assert.equal(
    fogVertexOf([item({ fog: false }), item({ computeFogPerPixel: true }), item({ water: true })]),
    false,
  )
  assert.equal(fogVertexOf([]), false)
})

test('the volume is read only by a lit translucent or additive layer its mode and shading model light', () => {
  assert.equal(translucencyVolumeOf([item({})]), true)
  assert.equal(translucencyVolumeOf([item({ blending: 'additive' })]), true)
  for (const other of [
    { blending: 'alphaComposite' },
    { blending: 'alphaHoldout' },
    { blending: 'multiply' },
    { blending: 'subtractive' },
    { water: true },
    { model: 6 },
    { lit: false },
    { translucencyLighting: 'forward' },
    { shadingModel: 4 },
  ])
    assert.equal(translucencyVolumeOf([item(other)]), false, JSON.stringify(other))
  assert.equal(
    translucencyVolumeOf([item({}, true)]),
    false,
    'a transmissive layer keeps its lighting',
  )
})

test('a program without the vertex fog holds none of its lanes, with it one extra', () => {
  assert.equal(cloudVertexText({ clouds: false, fog: false }).extras.length, 0)
  assert.equal(cloudVertexText({ clouds: false, fog: true }).extras.length, 1)
  assert.equal(cloudVertexText({ clouds: true, fog: true }).extras.length, 2)
  assert.match(blendShader({}), /fn fogVertexed\(in:VSOut\)->bool\{return false;\}/)
  assert.equal(locationsOf(blendShader({}, { reads: { clouds: false, fog: true } }))!.length, 14)
})

test('a layer is lit by its material’s mode alone, whatever its blending mode: forward by the declared lights, a volume mode by none, and by the volume only in a normal or additive layer of a model it lights', () => {
  const lightsOf = (code: string) => /fn blendLightsOf[\s\S]*?\n}\n/.exec(code)![0]
  const plain = lightsOf(blendShader({}))
  const volume = lightsOf(blendShader({}, { translucencyVolume: true }))
  for (const text of [plain, volume]) {
    assert.match(
      text,
      /if\(BLEND_LIGHTING==L_FORWARD&&\(translucencyLightingOf\(flags\)==TL_FORWARD\|\|modelFlag\(flags\)==6u\)\)\{return blendLights\(/,
    )
    assert.match(text, /blendLightsSet\(in,front,g,s,V\);/)
    assert.match(text, /return vec3f\(0\.0\);\n\}/)
  }
  assert.ok(
    !plain.includes('translucencyVolumeLight'),
    'no volume code: no volume light, not forward',
  )
  assert.match(
    volume,
    /if\(BLEND_LIGHTING==L_VOLUME&&\(BLEND_MODE==\d+u\|\|BLEND_MODE==\d+u\)&&!lightlessLane\(flags\)\)\{\n\s+return translucencyVolumeLight\(/,
  )
  // One module, the lighting program a pipeline constant: the declared lights only where it is forward, the lit path closed where unlit.
  const module = blendShader({}, { translucencyVolume: true })
  assert.match(module, /override BLEND_LIGHTING:u32=0u;/)
  assert.match(
    module,
    /const L_FORWARD:u32=0u;\nconst L_VOLUME:u32=1u;\nconst L_LIGHTLESS:u32=2u;\nconst L_UNLIT:u32=3u;/,
  )
  assert.match(module, /if\(BLEND_LIGHTING!=L_UNLIT&&blendLit\(flags\)\)\{/)
  assert.ok(
    !blendShader({}).includes('fn blendLightingMode'),
    'no blending-mode override of the mode',
  )
})

// The oracle of where a blended layer is lit from, one rule a line: a stage of its own for the water and a transmissive layer; nothing for
// an unlit surface (no light, no bounce, no reflection); the declared lights for the forward mode (`usf:1391`,
// `TRANSLUCENCY_LIGHTING_SURFACE_FORWARDSHADING`) and for the shadow catcher; the volume for a default-lit or thin-subsurface layer of
// a translucent or additive blend in a volume mode (`usf:1611`, `usf:1401`); nothing for the others.
const expectedSource = (
  mode: string,
  blending: string,
  shading: number | undefined,
  model: number,
  f: { lit: boolean; water: boolean; transmissive: boolean },
) => {
  if (f.water || f.transmissive) return 'own'
  if (!f.lit || shading === GRAPH_SHADING_MODELS.unlit) return 'none'
  if (model === SURFACE_MODEL.shadow || mode === 'forward') return 'forward'
  const lit = shading === undefined || shading === PIXEL_MODEL.subsurface
  return lit && (blending === 'normal' || blending === 'additive') ? 'volume' : 'none'
}

test('the light source of a blended layer, every combination of mode, blending, shading model, surface model and kind', () => {
  assert.deepEqual(Object.keys(TRANSLUCENCY_LIGHTING_CODE).sort(), [
    'forward',
    'volume',
    'volumetric',
    'volumetricNonDirectional',
  ])
  const shadings = [
    undefined,
    PIXEL_MODEL.subsurface,
    PIXEL_MODEL.skin,
    PIXEL_MODEL.profile,
    PIXEL_MODEL.eye,
    PIXEL_MODEL.hair,
    GRAPH_SHADING_MODELS.unlit,
  ]
  const record = new Uint32Array(MATERIAL_RECORD_WORDS),
    noLayers = { mapLayer: new Map(), dataLayer: new Map() }
  const text = /fn blendLightsOf[\s\S]*?\n}\n/.exec(
    blendShader({}, { translucencyVolume: true }),
  )![0]
  // The code the model word names the unlit shading model by, as the fragment's test reads it.
  const unlitCode = Number(/fn shadingUnlitOfModel[^\n]*==(\d+)u/.exec(blendShader({}))![1])
  assert.equal(unlitCode, shadingModelCode(GRAPH_SHADING_MODELS.unlit))
  const volumeRanks = new Set(
    [...text.matchAll(/BLEND_MODE==(\d+)u/g)].map(([, rank]) => Number(rank)),
  )
  assert.deepEqual([...volumeRanks].sort(), [
    BLEND_MODES.indexOf('normal'),
    BLEND_MODES.indexOf('additive'),
  ])
  for (const mode of Object.keys(TRANSLUCENCY_LIGHTING_CODE))
    for (const blending of BLEND_MODES)
      for (const shading of shadings)
        for (const model of [SURFACE_MODEL.standard, SURFACE_MODEL.shadow])
          for (const lit of [true, false])
            for (const [water, transmissive] of [
              [false, false],
              [true, false],
              [false, true],
            ]) {
              const flags = { lit, water, transmissive }
              const got = blendLightSource(
                mode,
                blending,
                shading,
                model,
                lit,
                water || transmissive,
              )
              // The lighting program that draws it follows the table: forward and the own stages the forward one, the volume's its own,
              // and a layer nothing lights is unlit where its lit path is closed (`wgslLit`), else lightless.
              const program = blendLightingOf({
                surface: {
                  translucencyLighting: mode,
                  blending,
                  shadingModel: shading,
                  model,
                  lit,
                  water,
                },
                transmissive,
              } as never)
              const closed =
                !lit || shadingModelCode(shading) === shadingModelCode(GRAPH_SHADING_MODELS.unlit)
              assert.equal(
                program,
                got === 'volume'
                  ? 'volume'
                  : got !== 'none'
                    ? 'forward'
                    : closed
                      ? 'unlit'
                      : 'lightless',
                `program ${JSON.stringify({ mode, blending, shading, model, ...flags })}`,
              )
              const label = JSON.stringify({ mode, blending, shading, model, ...flags })
              assert.equal(got, expectedSource(mode, blending, shading, model, flags), label)
              // The record's model lane against the oracle, not against the table under test: the lightless rank (7) exactly where a standard
              // surface of the mode is lit by nothing.
              // The lane is the model word's low bits (`SURFACE_MODEL_MASK`) as the record writer sets them; the surface declares no fog rule.
              writeMaterialRecord(
                record,
                0,
                {
                  baseColor: [1, 1, 1],
                  emissive: [0, 0, 0],
                  attenuationColor: [1, 1, 1],
                  transparent: false,
                  alphaTest: 0,
                  translucencyLighting: mode,
                  shadingModel: shading,
                  model,
                } as unknown as MaterialSurface,
                noLayers,
                0,
              )
              const lane = record[MATERIAL_RECORD.at.model] & SURFACE_MODEL_MASK
              const lightless =
                model === SURFACE_MODEL.standard &&
                expectedSource(mode, 'normal', shading, model, {
                  lit: true,
                  water: false,
                  transmissive: false,
                }) === 'none'
              assert.equal(lane, lightless ? LIGHTLESS_MODEL : model, `lane ${label}`)
              assert.equal(LIGHTLESS_MODEL, 7)
              // The WGSL condition of `blendLightsOf`, per blend mode: the volume where the mode is not forward, the surface not a catcher,
              // the blend one of the two the text names and the lane not lightless.
              const wgslVolume =
                mode !== 'forward' &&
                model !== SURFACE_MODEL.shadow &&
                volumeRanks.has(BLEND_MODES.indexOf(blending)) &&
                lane !== LIGHTLESS_MODEL
              // The lit flag of the fragment: the item's, cleared by the unlit shading model (`blendShadingFlags`), tested by `blendLit`.
              const wgslLit = lit && shadingModelCode(shading) !== unlitCode
              if (got !== 'own' && wgslLit)
                assert.equal(wgslVolume, got === 'volume', `wgsl ${label}`)
              // An unlit or unlit-view-less surface takes no light whatever its mode: the lit path is closed before the volume is asked.
              if (got !== 'own' && !wgslLit) assert.equal(got, 'none', `closed ${label}`)
            }
})

test('the vertex stage carries the shading model to the fragments: the unlit one clears the lit flag, a hair reflects nothing', () => {
  for (const code of [blendShader({}), blendShader({}, { translucencyVolume: true })]) {
    assert.match(
      code,
      /fn blendShadingFlags\(flags:u32,model:u32\)->u32\{return shadingFlagsOfNumber\(flags,shadingNumberOfModel\(model\)\);\}/,
    )
    assert.match(
      code,
      /fn shadingFlagsOfNumber\(flags:u32,number:u32\)->u32\{\n if\(number==0u\)\{return flags&~\d+u;\}\n if\(isPixelModel\(number\)\)\{return flags\|pixelModelFlag\(number\);\}/,
    )
    assert.match(code, /fn blendMedium\(flags:u32\)->bool\{return translucencyMedium\(flags\);\}/)
    assert.match(
      code,
      /fn blendUnreflecting\(flags:u32\)->bool\{return pixelModelOf\(flags\)==7u\|\|blendMedium\(flags\);\}/,
    )
    // The volume's single band is the non-directional mode's alone; every other mode, a medium included, reads the two bands with the normal.
    assert.match(code, /translucentGiSingle=translucencyLightingOf\(flags\)==TL_NON_DIRECTIONAL;/)
    assert.doesNotMatch(code, /translucentGiSingle=blendMedium/)
    assert.match(code, /forwardIndirect\([^\n]*,s\.ao,!blendUnreflecting\(flags\)\)/)
  }
})

test('the front pass writes a reflecting surface exactly where the blend fragment reads the front’s radiance: lit, physical, not a hair, not unlit', () => {
  const shadings = [undefined, ...Object.values(PIXEL_MODEL), GRAPH_SHADING_MODELS.unlit]
  for (const lit of [true, false])
    for (const model of [SURFACE_MODEL.standard, SURFACE_MODEL.diffuse, SURFACE_MODEL.shadow])
      for (const shadingModel of shadings) {
        const oracle =
          lit &&
          model === SURFACE_MODEL.standard &&
          shadingModel !== PIXEL_MODEL.hair &&
          shadingModel !== GRAPH_SHADING_MODELS.unlit
        assert.equal(
          blendReflects({ lit, model, shadingModel, translucencyLighting: 'forward' }),
          oracle,
          JSON.stringify({ lit, model, shadingModel }),
        )
      }
  assert.equal(shadingReflects(PIXEL_MODEL.hair), false)
  // A medium reflects nothing, whatever the volume the blend programs read and whatever the blend mode.
  const medium = {
    lit: true,
    model: SURFACE_MODEL.standard,
    translucencyLighting: 'volumetric' as const,
  }
  assert.equal(blendReflects(medium), false)
  assert.equal(
    blendReflects({ ...medium, translucencyLighting: 'volumetricNonDirectional' }),
    false,
  )
  assert.equal(blendReflects({ ...medium, translucencyLighting: 'volume' }), true)
  assert.match(blendFrontShader(1), /&&!translucencyMedium\(flags\)/)
  // The WGSL twin reads the same three facts: the lit flag (unlit clears it), the model lane and the hair's pixel model.
  const front = blendFrontShader(1)
  assert.match(
    front,
    /fn frontReflects\(flags:u32\)->bool\{return blendLit\(flags\)&&surfaceReflects\(modelFlag\(flags\)\|pixelModelFlag\(pixelModelOf\(flags\)\)\)&&!translucencyMedium\(flags\);\}/,
  )
  assert.match(
    front,
    new RegExp(
      `fn surfaceReflects\\(flags:u32\\)->bool\\{return \\(flags&7u\\)==2u&&pixelModelOf\\(flags\\)!=${PIXEL_MODEL.hair}u;\\}`,
    ),
  )
})

test('the pixel model number rides the bits of the diagnostic view code, and the vertex stage keeps the view code out of the item flags', () => {
  assert.equal(PIXEL_MODEL_SHIFT, DIAGNOSTIC_CODE_SHIFT)
  assert.equal(PIXEL_MODEL_MASK, DIAGNOSTIC_CODE_MASK)
  const mask = Number(
    /let flags=\(it\.flags&\d+u\)\|\(uni\.viewFlags&(\d+)u\);/.exec(
      wgslModule(blendVertexWgsl(false)),
    )![1],
  )
  // The view's flags the item takes: every bit but exactly the pixel model's.
  assert.equal(mask, ~(PIXEL_MODEL_MASK << PIXEL_MODEL_SHIFT) >>> 0)
})

test('a hair material under a diagnostic view keeps its pixel model and the view its own code: they no longer share the item’s flags', () => {
  const code = blendShader({})
  const run = shaderRun<{
    blendShadingFlags: (flags: number, model: number) => number
    blendDiagnosticCode: (flags: number) => number
    pixelModelOf: (flags: number) => number
  }>(code, ['blendShadingFlags', 'blendDiagnosticCode', 'pixelModelOf'], {})
  // The vertex stage hands the fragment its item's flags beside the pass's, minus the pass's view code.
  const mask = Number(
    /let flags=\(it\.flags&\d+u\)\|\(uni\.viewFlags&(\d+)u\);/.exec(
      wgslModule(blendVertexWgsl(false)),
    )![1],
  )
  const hairModel = (shadingModelCode(PIXEL_MODEL.hair) << SHADING_MODEL_MODEL_SHIFT) >>> 0
  for (const [name, { code: view }] of Object.entries(DIAGNOSTIC_VIEWS)) {
    const viewFlags = (FLAG_DIAGNOSTIC_VIEW | (view << DIAGNOSTIC_CODE_SHIFT)) >>> 0
    const item = run.blendShadingFlags(0, hairModel)
    const flags = (item | (viewFlags & mask)) >>> 0
    assert.equal(run.pixelModelOf(flags), PIXEL_MODEL.hair, `${name}: the hair stays a hair`)
    assert.equal(run.blendDiagnosticCode(viewFlags), view, `${name}: the view keeps its code`)
    assert.notEqual(flags & FLAG_DIAGNOSTIC_VIEW, 0, `${name}: the item knows a view is shown`)
  }
  assert.match(code, /let mode=blendDiagnosticCode\(uni\.viewFlags\);/)
})

test('a graph that wires a negative shading model number is lit as the default model, not left lightless', async () => {
  const { blendGraphFlagsWgsl } = await import('./graphFlagsWgsl.ts')
  const text = blendGraphFlagsWgsl(64)
  assert.match(
    text,
    new RegExp(
      `let number=select\\(${GRAPH_SHADING_MODELS.defaultLit}u,u32\\(g\\.model\\),g\\.model>=0\\);`,
    ),
  )
})
