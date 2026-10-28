import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import * as common from '../../packages/sdk/index.ts'
import * as core from '../../packages/sdk-core/src/index.ts'
import * as browser from '../../packages/sdk/browser.ts'
import * as browserLegacy from '../../packages/sdk-browser/src/index.ts'
import { apiInventory } from '../../scripts/sdkApi/sdk-api-inventory.ts'

test('the facade keeps canonical binding identity across environments', () => {
  assert.equal(common.LOD_QUALITY, core.LOD_QUALITY)
  assert.equal(browser.LOD_QUALITY, core.LOD_QUALITY)
  assert.equal(browser.createWorld, browserLegacy.createWorld)
})

test('importing each facade starts no browser resource or native process', () => {
  for (const entry of ['index.ts', 'browser.ts', 'node.mts']) {
    const url = new URL(`../../packages/sdk/${entry}`, import.meta.url).href
    const probe = `
      import childProcess from 'node:child_process';
      import { syncBuiltinESMExports } from 'node:module';
      const forbidden = (name) => () => { throw new Error('Import initialized ' + name); };
      for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'])
        childProcess[name] = forbidden(name);
      syncBuiltinESMExports();
      for (const name of ['Worker', 'SharedWorker', 'OffscreenCanvas', 'AudioContext'])
        globalThis[name] = function () { throw new Error('Import constructed ' + name); };
      globalThis.window = undefined;
      for (const name of ['document', 'navigator'])
        Object.defineProperty(globalThis, name, { configurable: true, get: forbidden(name) });
      globalThis.requestAnimationFrame = forbidden('requestAnimationFrame');
      globalThis.fetch = forbidden('fetch');
      await import(${JSON.stringify(url)});
    `
    execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--input-type=module', '-e', probe],
      {
        timeout: 30_000,
        stdio: 'pipe',
      },
    )
  }
})

interface InventoryEntry {
  name: string
  kind: string
  disposition?: string
  bindingIdentity: string
  currentEntryPoints: string[]
}
interface Inventory {
  exports: InventoryEntry[]
  collisions: unknown[]
  shadowed: { name: string }[]
}

test('generated inventory and explicit facade files are current', async () => {
  const inventory: Inventory = apiInventory()
  // 892 exports: the public API holds neither WGSL text (the shaders' maths library declares
  // it), a shadow atlas, a CPU transport, Hi-Z oracles, a CPU Hi-Z pyramid, a hierarchy batch, example-only helpers, the world
  // roots' object record no reader takes, nor the removed graphics path's renderer, CPU page
  // decoding and comparison layout; it holds the names the public signatures carry: EvictionOrder,
  // PageHome, PageHomes, QualityResolution, TextureLevelAddress, TextureLevelStore,
  // WorldQualityOptions, ModelScene, HairGroupOption (a group of `hairGroups`) and the documented settings of `world.controls`
  // (ControlSettings, CharacterSettings); the sources a session draws and their association
  // (DrawSource, DrawRanks, DrawAssociations) and the row a parent composes (PlacementLink); and the
  // page cache a streamer reads through,
  // `createPageCache` with its contract (PageCache, CacheSession, ReadRange, RangeAsk, ByteMeter);
  // it holds no CPU character capsule (Capsule, CapsuleContact, CapsulePush, TriangleTree,
  // CharacterCollision, TriangleCollision): Jolt is the one character body; and the frustum's
  // `FAR_PLANE_SLOT`, the slot a culling reader tests the far plane at. It holds no compute-path
  // governor either: the batches run their WebAssembly kernels alone, and no JavaScript twin of the
  // two (boxTransformBatch, multiplyMatrix4Batch, boxTransformUnionBatch) stands beside them; nor a
  // second page source beside the streaming (httpPageSource): `page.httpSource` reads through a
  // streamer. The bounce publishes its
  // frame metrics (BounceFrameMetrics), its most probes queued an image (BOUNCE_PROBE_QUEUE) and the queue a budget
  // asks with the update speed's range it is scaled within (probeQueueFor, BOUNCE_BUDGET_SPEED_RANGE); the reflections publish theirs (ReflectionFrameMetrics, ReflectionSceneEnded); no time servo (createProxyBudget) nor world-sized cascades
  // (createBounceCascades) stand beside it. A mesh wears the one surface record its material declared
  // (PageSurface, its SurfaceFamily, its three parts VisMaterial, SurfaceFacts and Releasable, and declareSurface with its SurfaceDeclaration to make one), which holds the core's texture record: the host surface and
  // texture copies (GraphSurface, GraphTexture, HostMaterial, HostTexture), the host's side word
  // (materialSide) and the texture's own colour-space word (TextureColorSpace, now the world's
  // ColorSpace, public in the common entry too) are gone; the compiler's filter words (TableFilter)
  // the table texture carries are named, beside the one table of their engine filters
  // (TABLE_FILTERS). The material kinds' default
  // exponent and index of refraction are engine values, never public. No standalone CPU `raycast`
  // stands beside `world.raycast`, which the GPU ray query answers; its `Intersection` stays public.
  // No CPU batch loop the engine never runs (invertMatrix4Batch, normalMatrix3Batch,
  // decomposeMatrix4Batch, srgbToLinearBatch, linearToSrgbBatch), no normal-cone test where the
  // cut tests none (boxConeRejects, coneRejects, CONE_LENGTH_RATIO, CONE_ORTHO_EPS), no full
  // impostor walk beside the watch (planImpostors, ImpostorCard,
  // ImpostorPlan); the compile job's scopes are one public table (ASSET_SCOPES). The baked mesh a
  // section's lookup returns (BakedEntry) and the frame, prime and budget a partition's cells take
  // (CellFrameIo, CellPrimeIo, CellBudget) are named where the public signatures carry them. The
  // stream's addresses are public (geometryPageAddress, streamBundleAddress) with the geometry file
  // the manifest names (GeometryFile); the world roots' page record (WorldRootsPage) is gone. A
  // world's views are public (ViewOptions, ViewRect, ViewFrameInfo, WorldView, ViewFrameMetrics).
  // A frame's inspection is public (FrameInspection, InspectedCamera, InspectedClusters,
  // InspectedShadowMap, InspectedReflections, InspectedLight, CLUSTER_STATE). The ray through a
  // canvas point, as `world.raycast` and the move handles aim it, is public (canvasRay).
  // The temporal anti-aliasing option `world.temporalAntialiasing` and `WorldOptions` take
  // (TemporalAntialiasingOption), and the texture cache and world cells the engine's signatures
  // carry (TextureCache, WorldCells), are named. The compile job's settings each have their
  // resolver and the types it takes and gives: the mesh build (resolveMeshBuild, MeshBuildOption,
  // MeshBuildRule, MeshBuildSettings), the object settings (resolveObjectSettings, ObjectRule,
  // DrawDistanceSettings, ObjectSettings, ObjectSettingsOption, SkinnedInstanceOption,
  // SkinnedInstanceSettings) and the partition's grid, grids and scheme (resolvePartitionGrid,
  // resolvePartitionGrids, resolvePartitionScheme, PartitionGridEntry, PartitionGridOption,
  // PartitionGridSettings, PartitionGridsOption, PartitionSchemeOption); the scene's animation banks name their
  // descriptor (AnimationBanksDescriptor) and a cell's actor its warm-up (ActorWarmth). The types
  // the signatures of those carry are named too: a mesh's bank track and what it holds
  // (AnimationBanks, BankBake, BankClock, BankItem, BankTrack, DecodedBanks), the setting rules the
  // run-time options are resolved by (RulesByField, SettingOptions, SettingRange, SettingValues), the
  // pool's page units, roots and growth (PageUnit, PageUnitsOf, RootSlots, GrownPages) in the
  // browser condition, and the wire forms the compile job's options are written in (HlodWire,
  // HlodExpertOf, HlodMatchOf, HlodWireMatch, HlodWirePattern, HlodApproximation,
  // HlodSimplifySettings, HlodMeshBuildWire, MaterialSettingsWire, MeshBuildSettingsWire,
  // MeshBuildWire, MeshInputSettingsWire, MeshVoxelSettingsWire, ObjectSettingsJobWire,
  // ObjectSettingsWire, DrawDistanceWire, SkinnedInstanceWire, PartitionGridSettingsWire,
  // PartitionGridsWire, PartitionGridWire, PartitionHlodGrid, NameMatch, NamePattern) in the node
  // condition. Seven names
  // left the code with their mechanisms, and so the API: the HLOD's simple form has no quality any
  // more (HLOD_QUALITIES, HlodQuality), and the partition audit, the occlusion and world frame
  // metrics, the primitives' quantization and the adaptive pixel error are gone (PartitionAudit,
  // OcclusionFrameMetrics, WorldFrameMetrics, PrimitiveQuantization, adaptivePixelError). The
  // scene's sky, height fog and exposure carry their own names (SceneAtmosphere, ResolvedAtmosphere,
  // SceneOzoneLayer, SceneHeightFog, SceneFogDirectional, SceneExposure), and the bloom its
  // levels (BloomLevelOptions, BloomTint, ResolvedBloomLevel). The module manager and descriptor
  // are public (createModuleManager, ModuleHooks, ModuleManager, defineModule, mergeModuleParts,
  // resolveModuleOption, ModuleDecision, ModuleDescriptor, ModuleOption, ModulePartFields,
  // ModuleParts, ModuleReason, ModuleState). The atmosphere's second light is
  // named by its two indices (ATMOSPHERE_SUN_INDICES, AtmosphereSunIndex), the sun's shadows by
  // their rules, their options and the distance a light names (SHADOW_RULES, ShadowOptions,
  // ShadowDistanceOption, SHADOW_DISTANCE_DEFAULT). The motion blur
  // (MotionBlur, MotionBlurOptions, ResolvedMotionBlur) and the screen probes' frame metrics
  // (ScreenProbeFrameMetrics) leave with the barrels of their families. The pool of probes is on
  // the GPU, and the four names of its CPU twin with it (createProbePool, ProbePool, ProbeEmit, TableEmit).
  // The cutout review and its sheet (CutoutModel, CutoutReviewOptions, CutoutReviewSummary,
  // reviewCutouts, CUTOUT_SHEET_FILE, CUTOUT_SHEET_VERSION), the HLOD groups (HlodGroup, HlodMatch) and
  // the report of the tables' growth (TableGrowthReport) left with their mechanisms; the translucent
  // lighting names (translucencyLighting, TranslucencyLighting), the lights' shadow options
  // (LIGHT_SHADOW_RULES, LightShadowOptions) and the lights' contact shadow rules, options and parameters
  // (LIGHT_CONTACT_SHADOW_RULES, LightContactShadowOptions, LightContactShadowParameters; ContactShadowView, the view's settings the store folds them with), the metrics of the ambient occlusion, the tone table and
  // the surface cache (AmbientOcclusionFrameMetrics, ToneTableFrameMetrics, SurfaceCacheFrameMetrics)
  // are public. The names a public signature hands a caller are public too: the fog's cube map,
  // second layer, sky light scattering and volume (SceneFogCubemap, SceneSecondLayer,
  // SceneSkyLightScattering, SceneVolumetricFog), a displacement (DisplacementWire,
  // SurfaceDisplacement), the clip planes, the collision options, the exposure curve's parts, the
  // material graph's nodes, pins and options, the view set, the light's cloud shadow and shaft
  // parameters, the world's image and scene settings, and the compiler job's mesh, lightmap and
  // displacement wire forms. The particle emitters (ParticleHandle, ParticleEmitterSpec,
  // ParticleSpawn, ParticleRange, ParticleBlend) and the character modes (CharacterMode) are public too.
  // So are the names the material and texture signatures hand a caller: the shading model
  // (MaterialShadingModel), the subsurface profile and its implementation (SubsurfaceProfile,
  // SubsurfaceImplementation) and a texel's kind (TexelKind). The second description of the
  // engine's own objects as a host library's shapes left with that layer (HostAttribute,
  // HostAttributes, HostBox, HostColour, HostDisposable, HostMaterials, HostMesh, HostNodeMatrix,
  // HostRotation, HostScene, HostVector, ControlVector); the camera a view is drawn from is the core's
  // (ViewCamera, for HostCamera), and the meshes a page draws and the colour a surface declares are
  // named in the engine's words (PageMesh, PageMaterials, SurfaceColour). The shadows' viewpoint
  // (ShadowViewpoint) left with the CPU streaming invalidations. The names the object and light signatures hand a caller are public
  // too: an object's capsule shadow body (ShadowCapsuleBody), the cubemap a sky light is lit by (SkyLightCubemap) and the options of a
  // sparse volume sample (SparseVolumeSampleOptions), with the pin and the wire that signature names (Pin, Wire).
  assert.equal(inventory.exports.length, 892)
  assert.deepEqual(inventory.collisions, [])
  // The page words of the world families shadow the engine contracts of the same name in the
  // browser condition; the inventory names every such pair (the lighting scene's `Scene` left with
  // the CPU transport experiment).
  assert.deepEqual(
    inventory.shadowed.map((entry) => entry.name),
    ['CameraPose', 'Material', 'Primitive', 'Side', 'Texture'],
  )
  assert.ok(inventory.exports.every((entry) => !entry.bindingIdentity.includes(process.cwd())))
  assert.ok(inventory.exports.every((entry) => !entry.bindingIdentity.includes('file://')))
  assert.ok(
    inventory.exports.some(
      (entry) => entry.name === 'sideOf' && entry.disposition === 'newly exposed',
    ),
  )
  for (const name of ['openMeasuredWorld', 'MeasuredWorld', 'MeasuredWorldOptions'])
    assert.ok(
      !inventory.exports.some((row) => row.name === name),
      `${name} belongs to the measurement entry, not the package`,
    )
  // The world's side of a joint, typed on its member: no page names it.
  assert.ok(!inventory.exports.some((row) => row.name === 'JointHost'), 'JointHost is internal')
  for (const [name, entryPoint] of [
    ['CameraPose', 'trillion3d (common)'],
    ['CameraPose', 'trillion3d (browser condition)'],
    ['JobSnapshot', 'trillion3d (common)'],
    ['World', 'trillion3d (browser condition)'],
    ['WorldOptions', 'trillion3d (browser condition)'],
    ['CompilationJob', 'trillion3d (node condition)'],
    ['CompilationResult', 'trillion3d (node condition)'],
    ['PrepareOptions', 'trillion3d (node condition)'],
  ]) {
    const entry = inventory.exports.find(
      (row) => row.name === name && row.currentEntryPoints.includes(entryPoint),
    )
    assert.ok(entry, `${name} is missing from the inventory`)
    assert.equal(entry.kind, 'type', `${name} must remain a named public type`)
    assert.ok(
      entry.currentEntryPoints.includes(entryPoint),
      `${name} must remain reachable from ${entryPoint}`,
    )
  }
})

test('one dot product is public, on three components: no N-dimensional one beside it', () => {
  for (const entry of [common, core, browser] as Record<string, unknown>[])
    assert.equal(entry.dot, undefined)
})
