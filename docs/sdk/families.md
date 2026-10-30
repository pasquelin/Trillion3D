# Families

Thirteen families describe the scene:

| Family | What it is | Example |
| --- | --- | --- |
| `geometry` | the shape alone, with no matter | `geometry.sphere(1, 64, 32)`, `geometry.tube(math.path(points), 64, 0.2)` |
| `material` | the matter alone, with no shape | `material.meshStandard({ color: 0x8899aa, metalness: 0.9 })`, `material.meshPhysical({ transmission: 1, ior: 1.5 })` |
| `object` | shape and matter, placed in the scene | `object.mesh(geometry.sphere(1), steel)`, `object.group()` |
| `light` | lights | `light.ambient({ intensity: 0.2 })`, `light.spot({ outerConeAngle: 0.4, innerConeAngle: 0.1, distance: 30 })` |
| `camera` | cameras | `world.camera = camera.perspective({ fov: 55, near: 0.1, far: 500 })` |
| `math` | vectors, quaternions, boxes, paths | `math.vector3(0, 1, 0)`, `math.box3().setFromObject(set)` |
| `texture`, `loader` | pictures | `const albedo = await loader.texture('wood.jpg')`, `albedo.wrap = wrap.repeat` |
| `helper` | the marks you work with | `helper.grid(20, 20)`, `helper.axes(2)` |
| `controls` | handles that move an object with the mouse | `controls.transform(world).attach(ball)` |
| `animation` | clips and mixers | `animation.createMixer(set)`, `animation.clip('bob', 2, [track])`, `mixer.play(bob)` |
| `buffer` | a geometry built by hand | `geometry.createBuffer({ position: buffer.float32(vertices, 3), index: buffer.uint32(indices) })` |
| `effect` | post-processing | [Canvas, camera and teardown](canvas-camera-and-teardown.md#canvas-camera-and-teardown) |
| constants | `blending`, `side`, `wrap`, `filter`, `colorSpace`, `toneMapping`, one named value per constant | `steel.side = side.double`, `world.toneMapping = toneMapping.none` |

Eight more exist because geometry is **cut into pages** the engine moves in and out of memory
according to what the frame reads:

| Family | Members | What it does | Example |
| --- | --- | --- | --- |
| `page` | `createStreamer`, `createCache`, `httpSource`, `decode` | geometry in pages | `page.createStreamer({ source: page.httpSource('assets/forest/', { pages, cache: createPageCache() }) })`, passed as `scene.load(url, { stream })` |
| `budget` | `geometryPool`, `texturePool` | fixed envelopes, not wishes | `world.budget.geometryPool = 512 * 1024 * 1024` |
| `metric` | `frame`, `gpuPasses` | what the image cost, never estimated | `metrics.selectedTriangles`, `metrics.residentPages` in `world.onFrame`; `metric.gpuPasses(world)` |
| `diagnostic` | `createChannel`, `presentationColor`, `transparentOcclusion` | watching the engine work | `world.diagnostic.mode = 'clusters'` (or `'wireframe'`, `'triangles'`, `'beauty'`) |
| `capability` | `detect`, `lighting` | what the machine grants, before an image is promised | `(await capability.detect()).webgpu` |
| `capture` | `surface`, `buffer` | an image aside, at another resolution, without touching the view | `capture.surface(world, { width: 3840, height: 2160 })` |
| `pose` | `fromBounds`, `runPath`, `pointOfInterest` | named poses, automatic framing, replaying a path | `world.camera.set(pose.fromBounds(math.box3().setFromObject(set)))` |
| `batch` | `transformPoints`, `composeMatrix4`, `frustumKeepsBox` | a thousand matrices at once instead of a loop | `batch.composeMatrix4(outputs, positions, quaternions, scales, 1000)` |

`metric.frame(world)` is never `null`: before the first frame it holds every metric key, the totals
(`cpuFrameMs`, `pageLoads`, `pageBytesRead`) at zero and every measure `null` — not measured, never
a zero that would read as an empty frame.

The world is not a family: it carries `scene`, `camera`, `budget`, `diagnostic`, `controls`,
`onFrame`, `render`, `invalidate` and `dispose`. There is no level-of-detail object and no instanced
or batched mesh type: the DAG cut, instancing and draw grouping are native.

In a compiled scene, moving a node or its parent moves the reach of the bounce's rays and restarts
bounce probe convergence, with no invalidation call: the rays march the global distance field, which
the cut's own placements keep current.
