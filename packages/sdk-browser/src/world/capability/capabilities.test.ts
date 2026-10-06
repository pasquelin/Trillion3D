import test from 'node:test'
import assert from 'node:assert/strict'
import { detectCapabilities } from './capabilities.ts'

test('WebGL probing matches production attributes, loses the probe context, and does not touch WebGPU', async () => {
  let gpuCalls = 0,
    hostCalls = 0,
    probeCalls = 0,
    lost = 0
  const host = {
    getContext: () => {
      hostCalls++
      throw new Error('host canvas was bound')
    },
  }
  const probe = {
    getContext: (kind: string, attributes?: WebGLContextAttributes) => {
      probeCalls++
      assert.equal(kind, 'webgl2')
      assert.equal(attributes?.alpha, false)
      assert.equal(attributes?.antialias, false)
      return {
        getSupportedExtensions: () => ['EXT_test'],
        getExtension: (name: string) => {
          assert.equal(name, 'WEBGL_lose_context')
          return {
            loseContext() {
              lost++
            },
          }
        },
      }
    },
  }
  const environment = {
    get gpu(): GPU {
      gpuCalls++
      throw new Error('WebGPU touched')
    },
    createWebglCanvas: () => probe as unknown as HTMLCanvasElement,
  }
  const result = await detectCapabilities(
    'webgl',
    host as unknown as HTMLCanvasElement,
    environment,
  )
  assert.equal(result.renderer, 'webgl2')
  assert.equal(hostCalls, 0)
  assert.equal(probeCalls, 1)
  assert.equal(lost, 1)
  assert.equal(gpuCalls, 0)
  await detectCapabilities('webgl', host as unknown as HTMLCanvasElement, environment)
  assert.equal(probeCalls, 2)
})
