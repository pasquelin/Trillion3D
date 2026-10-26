import test from 'node:test'
import { runOnDawn } from '../../kit/device/onDawn.ts'
import { animationFrame } from '../../kit/device/frame.ts'
import { openScene } from './animatedCasterPage.ts'
import { lastFrameOf } from '../../../packages/sdk-browser/src/session/world/session.ts'
test('desk perf', async () => {
  const out = await runOnDawn(
    async () => {
      const canvas = document.createElement('canvas')
      canvas.style.cssText = 'width:2056px;height:1144px;display:block'
      document.body.append(canvas)
      const { world } = (await openScene(canvas)) as any
      world.renderScale = 1
      world.shading = {
        gpuTimingDetail: true,
        gpuShadeStage: Number((globalThis as any).process?.env?.ZZ_STAGE ?? 0),
      }
      const acc = new Map<string, number>()
      let n = 0,
        size: any
      for (let i = 0; i < 160; i++) {
        await animationFrame()
        world.render()
        const m: any = lastFrameOf(world)
        if (i >= 60) {
          const p = m?.gpuPassMs?.passes
          size = [m?.renderWidth, m?.renderHeight]
          if (p) {
            n++
            for (const x of p) acc.set(x.name, (acc.get(x.name) ?? 0) + (x.ownMs ?? 0))
          }
        }
      }
      world.dispose()
      return {
        n,
        size,
        passes: [...acc]
          .map(([k, v]) => [k, +(v / Math.max(n, 1)).toFixed(2)])
          .filter((x) => String(x[0]).includes('material'))
          .sort((a, b) => (b[1] as number) - (a[1] as number)),
      }
    },
    null,
    [],
  )
  console.log('ZZDESK', JSON.stringify(out))
})
