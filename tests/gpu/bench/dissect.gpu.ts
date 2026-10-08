// The bench takes a shader apart by itself: a kernel whose three stages cost what the proof makes
// them cost (a cheap one, a slow loop, a slower one) is cut at each named point in memory, and the
// steps the bench reads are in the order the proof built them, the biggest where the biggest loop is.
import assert from 'node:assert/strict'
import test from 'node:test'
import { setDissect } from '../../../bench/dawn/dissectHooks.ts'
import { installGpu } from '../../../bench/dawn/device.ts'
import { stepsOf, type Variant } from '../../../bench/dawn/dissectReport.ts'
import { cutsOf, hashOf } from '../../../bench/dawn/shaderCuts.ts'
import { runOnDawn } from '../kit/onDawn.ts'

const loop = (n: number, from: string) =>
  `for (var i = 0u; i < ${n}u; i++) { ${from} = fract(${from} * 1.7 + 0.31) + sin(${from}); }`
const KERNEL = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> out: array<f32>;
@compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) {
  var x = f32(id.x) * 0.001;
  // @cut launch
  ${loop(2000, 'x')}
  // @cut cheap keep: if (x < -1.0e30) { out[0] = x; }
  ${loop(20000, 'x')}
  // @cut slow keep: if (x < -1.0e30) { out[0] = x; }
  ${loop(60000, 'x')}
  out[id.x] = x;
}`

test(
  'the steps the bench reads follow the cost the proof put in each stage',
  { timeout: 240_000 },
  async () => {
    const { steps } = await runOnDawn(async () => {
      const gpu = installGpu({ limits: null, featuresOff: [] })
      const adapter = (await navigator.gpu.requestAdapter())!
      const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] })
      const out = device.createBuffer({ size: 1 << 20, usage: GPUBufferUsage.STORAGE })
      const hash = hashOf(KERNEL)
      const cuts = cutsOf(KERNEL).map((c) => c.name)
      const time = async (cut: string | null): Promise<Variant> => {
        setDissect({ pass: 'kernel', hash, cut })
        const pipeline = device.createComputePipeline({
          layout: 'auto',
          compute: { module: device.createShaderModule({ code: KERNEL }), entryPoint: 'main' },
        })
        const bind = device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [{ binding: 0, resource: { buffer: out } }],
        })
        const runs: number[] = []
        for (let k = 0; k < 9; k++) {
          await device.queue.onSubmittedWorkDone()
          gpu.timer.open(device)
          const encoder = device.createCommandEncoder()
          const pass = encoder.beginComputePass({ label: 'kernel' })
          pass.setPipeline(pipeline)
          pass.setBindGroup(0, bind)
          pass.dispatchWorkgroups(1024)
          pass.end()
          device.queue.submit([encoder.finish()])
          runs.push((await gpu.timer.close())!.passes[0].ms)
        }
        runs.sort((a, b) => a - b)
        return { cut, frameMs: runs[4], passMs: runs[4], iqrMs: runs[6] - runs[2] }
      }
      const variants = [await time(null)]
      for (const cut of cuts) variants.push(await time(cut))
      variants.push(await time(null))
      return stepsOf(cuts, variants)
    }, null)
    const cost = Object.fromEntries(steps.map((s) => [s.to, s.passMs]))
    assert.ok(
      cost.slow > 2 * cost.cheap,
      `the 20000-turn loop (${cost.slow} ms) costs more than the 2000-turn one (${cost.cheap} ms)`,
    )
    assert.ok(
      cost.end > cost.slow,
      `the 60000-turn tail (${cost.end} ms) costs more than the 20000-turn loop (${cost.slow} ms)`,
    )
    assert.ok(cost.launch < cost.slow, 'the launch costs less than a loop')
  },
)
