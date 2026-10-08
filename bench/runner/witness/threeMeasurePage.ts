// What the Three witnesses — bare (`witness/threeBarePage.ts`) and with levels of detail (`witness/threeLodPage.ts`)
// — measure the same: the same glTF scene loaded by Three, contract lights placed in Three
// (sun as `DirectionalLight` with ONE shadow map covering the model, point lights as
// `PointLight` with their shadow cube), ACES and sRGB like the engine, and the same
// measurement loop, on Three's WebGPU renderer (`witness/threeRenderer.ts`). Served to the page
// (mount `/runner/`), it imports only `three` from `/vendor/three/` — never from the engine.
//
// What it measures: the CPU time of `render`, the GPU time of each frame from Three's timestamp
// queries (the sum of its passes, resolved without the frame loop waiting; Three gives no split
// per pass, so `gpuPassSamples` stays empty), the rAF interval in a profile loop, the draws and
// triangles of `renderer.info`, the geometry and texture bytes it holds, preparation and the
// network, and its capture for the pixel delta.
import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { lamp, octets } from './threeBareScene.ts'
import { createWitnessRenderer, gpuFrameTimes, readWitnessImage } from './threeRenderer.ts'
import { movableLampPosition, posterCapture, networkFrom } from '../harness/measurePage.ts'
import type { CameraPose } from '../../../packages/sdk-core/src/index.ts'
import type { MeasureViewOptions, MeasureViewResult } from '../harness/measureOptions.ts'

function placer(camera: THREE.PerspectiveCamera, pose: CameraPose, aspect: number) {
  camera.fov = pose.fov
  camera.aspect = aspect
  camera.near = pose.near
  camera.far = pose.far
  camera.position.fromArray(pose.position)
  camera.lookAt(pose.target[0], pose.target[1], pose.target[2])
  camera.updateProjectionMatrix()
}

/** Triangles of indexed geometries under `root`, each geometry counted once. */
function trianglesUniques(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (mesh.isMesh && mesh.geometry?.index) geometries.add(mesh.geometry)
  })
  let total = 0
  for (const g of geometries) total += (g.index?.count ?? 0) / 3
  return total
}

/**
 * One view, one threshold (ignored: Three has no threshold), the capture. Same contract as `measureView`.
 * `preparer(root, options)` retouches the loaded graph before shadows and compilation — that
 * is where the level-of-detail witness replaces its meshes — and returns extra metrics to
 * publish; without it, the scene stays as Three read it.
 */
export async function mesurerThree(
  options: MeasureViewOptions,
  preparer?: (
    root: THREE.Object3D,
    options: MeasureViewOptions,
  ) => Promise<Record<string, unknown>>,
): Promise<MeasureViewResult> {
  if ((options.instances ?? 1) !== 1) return { error: 'the Three witness does not place instances' }
  if (!options.gltfUrl) return { error: 'the Three witness requires a source glTF' }
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const lost: string[] = (globalThis.gpuIncidents = [])
  performance.setResourceTimingBufferSize(1_000_000)
  const resourcesBefore = performance.getEntriesByType('resource').length
  const preparationStart = performance.now()
  const { width, height } = options
  const renderer = await createWitnessRenderer(canvas, { width, height, timestamps: true, lost })
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.setClearColor(0x2a303c, 1)
  const shadows = options.lights?.some((l) => l.castsShadow !== false) === true
  renderer.shadowMap.enabled = shadows
  renderer.shadowMap.type = THREE.PCFShadowMap
  const scene = new THREE.Scene()
  const gltf = await new GLTFLoader().loadAsync(options.gltfUrl)
  scene.add(gltf.scene)
  const uniqueTriangles = trianglesUniques(gltf.scene)
  const witness = await preparer?.(gltf.scene, options)
  gltf.scene.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    mesh.castShadow = mesh.receiveShadow = shadows
    // glTF materials are two-sided: projecting both makes every thin wall shadow
    // itself and darkens the scene. Back face alone is Three's usual setting.
    if (mesh.material) (mesh.material as THREE.Material).shadowSide = THREE.BackSide
  })
  const box = new THREE.Box3().setFromObject(gltf.scene)
  const lamps = new Map<string, THREE.DirectionalLight | THREE.SpotLight | THREE.PointLight>()
  for (const light of options.lights ?? []) {
    const objects = lamp(light, box, shadows)
    lamps.set(light.id, objects[0])
    scene.add(...objects)
  }
  const camera = new THREE.PerspectiveCamera()
  const poser = (pose: CameraPose) => placer(camera, pose, options.width / options.height)
  poser(options.pose)
  await renderer.compileAsync(scene, camera)
  renderer.render(scene, camera)
  const preparationMs = performance.now() - preparationStart
  const moving = options.moving
  const moveLight = (frame: number) => {
    if (moving) lamps.get(moving.id)?.position.fromArray(movableLampPosition(moving, frame))
  }
  let current = options.pose
  const poseAt = (frame: number) =>
    (current = options.poses ? options.poses[frame % options.poses.length] : options.pose)
  const gpu = gpuFrameTimes(renderer)
  for (let i = 0; i < options.warmup; i++) renderer.render(scene, camera)
  await renderer.waitForGPU()
  await gpu.drain()
  const cpuFrameMs: number[] = []
  const rafIntervalMs: number[] = []
  let previousRaf: number | null = null
  for (let i = 0; i < options.frames; i++) {
    const now = await new Promise<number>((done) => requestAnimationFrame(done))
    if (previousRaf !== null && i > 2) rafIntervalMs.push(now - previousRaf)
    previousRaf = now
    moveLight(i)
    poser(poseAt(i))
    const t = performance.now()
    renderer.render(scene, camera)
    cpuFrameMs.push(performance.now() - t)
    gpu.sample()
  }
  await gpu.drain()
  poser(current)
  // The capture, bottom-to-top rows as `explorer.capture()` returns them: the bench server flips
  // them when encoding the PNG, and compares the buffers as-is. Its frame is the one the counters
  // describe: the library resets them only in its own animation loop.
  renderer.info.reset()
  const rgba = await readWitnessImage(renderer, scene, camera)
  const info = renderer.info
  const memoire = octets(scene)
  const { width: w, height: h } = canvas
  const response = await posterCapture(options.captureFile, rgba, w, h)
  const network = networkFrom(resourcesBefore)
  const metrics = {
    drawCalls: info.render.drawCalls,
    drawnTriangles: info.render.triangles,
    selectedTriangles: null,
    uncoveredTriangles: null,
    geometryAllocationBytes: memoire.geometry,
    textureResidentBytes: memoire.textures,
    texturePoolBytes: null,
    geometries: memoire.geometries,
    programs: null,
    lightsActive: lamps.size,
    frameHeld: false,
    // Triangles of the scene as Three read it, each geometry counted once: the
    // witness's bytes per triangle are measured on that.
    uniqueTriangles,
    // What the witness preparation publishes (its levels of detail), flattened.
    ...witness,
  }
  renderer.dispose()
  canvas.remove()
  return {
    cpuFrameMs,
    gpuFrameMs: gpu.gpuFrameMs,
    syncFrameMs: [],
    rafIntervalMs,
    importedLights: null,
    witnessLights: { count: lamps.size, shadows, ids: [...lamps.keys()], bare: true },
    movingNode: null,
    stageProfile: null,
    gpuPassSamples: [],
    selection: { source: null, ids: [] },
    metrics,
    preparationMs,
    network,
    mathBatch: null,
    size: { width: w, height: h },
    lost,
    captureStatus: response.status,
  }
}
