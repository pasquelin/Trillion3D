// Every pass of the hit lighting (the reflections', the screen probes' and the radiance cache's) binds what its text declares: each @group/@binding the text reaches is in the pass's layout, of the kind, type, format and visibility it reads.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { layoutProblems } from '../../gpu/core/wgslLayoutMatch.fixture.ts'
import type { LightAtlasFormat } from '../../gpu/core/lightAtlasFormat.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { graphRastersOf } from '../../materials/graph/graphRasters.ts'
import { NO_SCENE_MASKS, sceneMaskProgramsOf } from '../rays/sceneTrace/sceneMaskPrograms.ts'
import {
  reflectionHitLayout,
  reflectionLayout,
  reflectionSceneLayout,
} from '../reflections/reflectionPipelines.ts'
import { reflectionTraceShader } from '../reflections/trace/trace.ts'
import {
  hardwareFinishLayout,
  hardwareFinishSceneLayout,
  hardwareLitLayout,
  hardwareMaskedTraceLayout,
} from '../reflections/trace/traceBindings.ts'
import {
  litCompactLayout,
  litCopyLayout,
  litDispatchLayout,
  litSortArgsLayout,
  litSortLayout,
} from '../reflections/hitLighting/kernels.ts'
import { litCompactProgram } from '../reflections/hitLighting/litWgsl.ts'
import { SORT_TRACES_WGSL } from '../reflections/translucency/sortWgsl.ts'
import { cacheTracedProgramOf } from './cache/cacheTraceWgsl.ts'
import { cacheTracedLayouts } from './cache/cacheBindings.ts'
import {
  cacheLitCompactProgram,
  cacheLitDirectProgram,
  cacheLitFinishProgram,
} from './cache/cacheHitLitWgsl.ts'
import {
  cacheLitCompactLayout,
  cacheLitDirectLayout,
  cacheLitFinishLayout,
  cacheLitSceneLayout,
} from './cache/cacheHitLitKernels.ts'
import {
  traceTracedEntries,
  traceTracedSceneEntries,
  traceTracedShader,
} from './screen/traceTracedWgsl.ts'
import {
  probeLitCompactProgram,
  probeLitDirectProgram,
  probeLitFinishProgram,
} from './screen/hitLitWgsl.ts'
import {
  probeLitCompactLayout,
  probeLitDirectLayout,
  probeLitFinishKey,
  probeLitFinishLayout,
  probeLitSceneLayout,
} from './screen/hitLitKernels.ts'

const LIGHTS: LightAtlasFormat[] = ['r32uint', 'rg11b10ufloat', 'rgba16float', 'rgba32float']
/** A set of graph masks the any-hit test evaluates: its text reaches the material table and the graph frame beside the trace's bindings. */
const MASKED = (() => {
  const graph = material.graph('surface')
  graph.output('baseColor', graph.constant(1, 0, 0))
  graph.output('opacityMask', graph.sine(graph.time(), 2))
  return sceneMaskProgramsOf(graphRastersOf([{ graph }]))
})()
const SETS = [NO_SCENE_MASKS, MASKED]
const { device } = fakeDevice()
/** The entries a layout the device made holds. */
const entriesOf = (layout: GPUBindGroupLayout) =>
  (layout as unknown as { entries: GPUBindGroupLayoutEntry[] }).entries
const problemsOf = (what: string, text: string, layouts: GPUBindGroupLayout[], only?: string) =>
  layoutProblems(text, layouts.map(entriesOf), only).map((line) => `${what}: ${line}`)

test('the reflections’ passes over the list of the hits to light bind what their text declares', () => {
  const problems = [
    ...problemsOf('litCompact', litCompactProgram(), [litCompactLayout(device)], 'litCompact'),
    ...problemsOf('litDispatch', litCompactProgram(), [litDispatchLayout(device)], 'litDispatch'),
    ...problemsOf('litCopy', litCompactProgram(), [litCopyLayout(device)], 'litCopy'),
    ...problemsOf('sortArgs', SORT_TRACES_WGSL, [litSortArgsLayout(device)], 'sortTracesArgs'),
    ...problemsOf('sort', SORT_TRACES_WGSL, [litSortLayout(device)], 'sortTracesByMaterial'),
  ]
  for (const light of LIGHTS) {
    const direct = reflectionTraceShader(
      false,
      true,
      'none',
      light,
      undefined,
      NO_SCENE_MASKS,
      'direct',
    )
    const finish = reflectionTraceShader(
      false,
      true,
      'none',
      light,
      undefined,
      NO_SCENE_MASKS,
      'finish',
    )
    problems.push(
      ...problemsOf(
        `litDirect ${light}`,
        direct,
        [hardwareLitLayout(device), reflectionHitLayout(device), hardwareMaskedTraceLayout(device)],
        'litDirect',
      ),
      ...problemsOf(
        `litFinish ${light}`,
        finish,
        [
          hardwareFinishLayout(device, light),
          reflectionLayout(device),
          hardwareFinishSceneLayout(device),
        ],
        'litFinish',
      ),
    )
  }
  assert.deepEqual(problems, [])
})

test('the screen probes’ passes bind what their text declares, with and without the fog laid over the rays', () => {
  const problems = [
    ...problemsOf('spLitCompact', probeLitCompactProgram(8, [4, 4]), [
      probeLitCompactLayout(device),
    ]),
    ...problemsOf('spLitDirect', probeLitDirectProgram(8, [4, 4]), [
      probeLitDirectLayout(device),
      reflectionSceneLayout(device),
      probeLitSceneLayout(device),
    ]),
  ]
  for (const light of LIGHTS)
    for (const fog of [false, true])
      problems.push(
        ...problemsOf(
          `spLitFinish ${light} fog ${fog}`,
          probeLitFinishProgram(8, [4, 4], fog, light),
          [
            probeLitFinishLayout(device, probeLitFinishKey({ heightFog: fog, light })),
            reflectionSceneLayout(device),
          ],
        ),
      )
  assert.deepEqual(problems, [])
})

test('the radiance cache’s passes bind what their text declares, for every format of the cache’s light', () => {
  const problems = [
    ...problemsOf('cacheLitCompact', cacheLitCompactProgram(), [cacheLitCompactLayout(device)]),
    ...problemsOf('cacheLitDirect', cacheLitDirectProgram(), [
      cacheLitDirectLayout(device),
      cacheLitSceneLayout(device),
    ]),
  ]
  for (const light of LIGHTS)
    problems.push(
      ...problemsOf(`cacheLitFinish ${light}`, cacheLitFinishProgram(light), [
        cacheLitFinishLayout(device, light),
      ]),
    )
  assert.deepEqual(problems, [])
})

test('the passes that mark the hits bind what their text declares, for every format of the light and with or without graph masks', () => {
  const layout = (entries: unknown) =>
    device.createBindGroupLayout({ entries: entries as GPUBindGroupLayoutEntry[] })
  const problems: string[] = []
  for (const programs of SETS)
    for (const light of LIGHTS) {
      const [own, scene] = cacheTracedLayouts(light, true)
      problems.push(
        ...problemsOf(
          `cache marking ${light} masks ${programs.length}`,
          cacheTracedProgramOf(light, programs, true),
          [layout(own), layout(scene)],
          'traceTiles',
        ),
      )
      for (const fog of [false, true])
        problems.push(
          ...problemsOf(
            `screen marking ${light} fog ${fog} masks ${programs.length}`,
            traceTracedShader(8, [4, 4], fog, light, programs, true),
            [
              layout(traceTracedEntries(fog, light)),
              reflectionSceneLayout(device),
              layout(traceTracedSceneEntries()),
            ],
            'traceTriangles',
          ),
        )
    }
  assert.deepEqual(problems, [])
})

test('the first passes bind what their text declares over a set of graph masks', () => {
  const problems = [
    ...problemsOf(
      'litDirect masked',
      reflectionTraceShader(false, true, 'none', 'rgba16float', undefined, MASKED, 'direct'),
      [hardwareLitLayout(device), reflectionHitLayout(device), hardwareMaskedTraceLayout(device)],
      'litDirect',
    ),
    ...problemsOf('spLitDirect masked', probeLitDirectProgram(8, [4, 4], MASKED), [
      probeLitDirectLayout(device),
      reflectionSceneLayout(device),
      probeLitSceneLayout(device),
    ]),
    ...problemsOf('cacheLitDirect masked', cacheLitDirectProgram(MASKED), [
      cacheLitDirectLayout(device),
      cacheLitSceneLayout(device),
    ]),
  ]
  assert.deepEqual(problems, [])
})
