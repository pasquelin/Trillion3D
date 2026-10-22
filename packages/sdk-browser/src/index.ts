// The world and its families: what a page writes. One barrel per family folder.
export * from './session/world/index.ts'
export * from '../../sdk-core/src/world/math/index.ts'
export * from '../../sdk-core/src/world/geometry/index.ts'
export * from '../../sdk-core/src/world/buffer/index.ts'
export * from '../../sdk-core/src/world/object/index.ts'
export { Group, Object3D } from '../../sdk-core/src/world/object/object3d.ts'
export { Mesh, type Primitive } from '../../sdk-core/src/world/object/mesh.ts'
export { Sprite } from '../../sdk-core/src/world/object/sprite.ts'
export type { SceneLink } from '../../sdk-core/src/world/object/sceneLink.ts'
export { TransformNode } from '../../sdk-core/src/world/object/transformNode.ts'
export * from '../../sdk-core/src/world/material/index.ts'
export { light, Light, type LightParameters } from '../../sdk-core/src/world/light/light.ts'
export * from '../../sdk-core/src/world/effect/index.ts'
export * from '../../sdk-core/src/world/camera/index.ts'
export type {
  Clip,
  Track,
  TrackBinding,
  TrackKind,
} from '../../sdk-core/src/world/animation/clip.ts'
export { Action, Mixer, advanceMixers } from '../../sdk-core/src/world/animation/mixer.ts'
export { animation } from '../../sdk-core/src/world/animation/family.ts'
export { Skeleton } from '../../sdk-core/src/world/animation/skeleton.ts'
export type { WindOptions } from '../../sdk-core/src/world/animation/wind.ts'
export * from '../../sdk-core/src/world/constants/index.ts'
export * from './materials/live/index.ts'
export * from './api/loaderFamily.ts'
export * from './api/helperFamily.ts'
export {
  GUIDE_VERTEX_CEILING,
  type Guides,
  type GuideHandle,
  type GuideLines,
  type GuidePoints,
} from './guides/guideSet.ts'
export * from './guides/transform/index.ts'
export * from './geometry/runtime/index.ts'
export * from './api/budgetFamily.ts'
export * from '../../sdk-core/src/physics/index.ts'
export type { WorldPhysics } from './physics/worldPhysics.ts'
export type { WorldPhysicsOptions, GravityInput } from './physics/worldPhysicsOptions.ts'
export type { WaterSpec } from '../../sdk-core/src/fluids/buoyancy.ts'
export type { WaveSpec, Waves } from '../../sdk-core/src/fluids/waves.ts'
export type { WaterSurface } from '../../sdk-core/src/fluids/waterSurface.ts'
export type { PhysicsStats } from './physics/protocol.ts'
export * from './api/metricFamily.ts'
export * from './diagnostic/world/index.ts'
export * from './api/capability/index.ts'
export * from './api/capture/index.ts'
export * from './api/poseFamily.ts'
export * from './api/batchFamily.ts'
export type { CreatedMaterial } from './api/createdMaterials.ts'
export type { SceneMaterial, SceneMaterialPatch } from './api/materialValues.ts'
export { EngineProfiler } from './diagnostic/telemetry.ts'
export type { TelemetryReport } from './diagnostic/telemetryTypes.ts'
export type { AssetScope, StablePreview } from '../../sdk-core/src/contracts/base.ts'
export type { FrameMetrics, ViewFrameMetrics } from '../../sdk-core/src/contracts/metrics.ts'
export type { ClusterManifest } from '../../sdk-core/src/contracts/geometry.ts'
export type { EngineDiagnostic, DiagnosticDetail } from './diagnostic/types.ts'
export type { PointOfInterest } from './session/options.ts'
/** Placement rows, a cell's decoded rows and how a frame grows them in place, from the scene. */
export type { PlacementRows } from './placement/rows/rows.ts'
/** A row of a scene's instance buffer that follows its parent, composed on the GPU. */
export type { PlacementLink } from './placement/compose/gpuCompose.ts'
/** What the engine draws, source by source (`geometry/selection/drawSource.ts`). */
export type { DrawAssociations, DrawRanks, DrawSource } from './geometry/selection/drawSource.ts'
export type { CellRows } from './geometry/partition/cellDecode.ts'
export type { CellBudget, CellFrameIo, CellPrimeIo } from './geometry/partition/cellsPrime.ts'
export type { PlacementGrowth } from './placement/engineSceneUpdates.ts'
/** Host resources the engine reads and never builds (`session/host/resources.ts`): a host declares them
 *  with whatever library it draws with, the contract names only their shape. */
export type {
  HostAttribute,
  HostAttributes,
  HostBox,
  HostColour,
  HostDisposable,
  HostMaterials,
  HostMesh,
  HostPoint,
  HostScene,
} from './session/host/resources.ts'
/** The shapes a host node's pose and rotation are read through (`scene/host/scan/graphNodes.ts`). */
export type { HostRotation, HostVector } from './scene/host/scan/graphNodes.ts'
/** The surface record a mesh of the engine's graph wears (`geometry/pages/surface.ts`), holding the core's
 *  texture records; its nodes are the core's. Its three parts are named: the shaded fields
 *  (`VisMaterial`), the raster facts (`SurfaceFacts`) and its release (`Releasable`). */
export type { PageSurface, SurfaceFacts, SurfaceFamily } from './geometry/pages/surface.ts'
export type { VisMaterial } from './visibility/materialType.ts'
export type { Releasable } from '../../sdk-core/src/runtime/releasable.ts'
export { declareSurface } from './geometry/pages/surfaceRecord.ts'
export type { SurfaceDeclaration } from './geometry/pages/surfaceDeclaration.ts'
export type { HostNodeMatrix, MatrixElements } from './session/host/matrixElements.ts'
export { gpuPassBlockOf, gpuPassStageOf } from './diagnostic/stage/mapping.ts'
export { gpuPassBlockTotals } from './gpu/core/passBlocks.ts'
export type { GpuPassBlockTotals } from './gpu/core/passBlocks.ts'
export type { GpuPassBlock } from './diagnostic/stage/passDeclaration.ts'
export { createDiagnosticChannel } from './diagnostic/channel.ts'
export type {
  DiagnosticChannel,
  DiagnosticChannelOptions,
  DiagnosticObserver,
} from './diagnostic/channel.ts'
export type { SurfaceBuffer, SurfaceCapture } from './materials/surface/surfaceBuffer.ts'
export type {
  GeometryPool,
  MemoryBudgets,
  MemoryBudgetsReport,
  PoolClamp,
  TableGrowthReport,
} from './session/memory/pools.ts'
export type { TexturePool } from './geometry/residency/memoryBudgets.ts'
export type { BudgetCanvas } from './session/memory/memoryBudget.ts'
export type {
  FrameInspection,
  InspectedCamera,
  InspectedClusters,
  InspectedLight,
  InspectedReflections,
  InspectedShadowMap,
} from './diagnostic/inspection/types.ts'
export { CLUSTER_STATE } from './diagnostic/inspection/types.ts'
export type { TransparentOcclusionAudit } from './blend/transparent/occlusionAudit.ts'
export type { CpuStepSummary } from './diagnostic/stage/profiler.ts'
export type { ArrivalPlan } from './geometry/integration/host.ts'
export type { DecodedGeometryPage } from './geometry/codec/geometryPage.ts'
export type {
  TextureLevel,
  TextureLevelAddress,
  TextureLevelReader,
  TextureLevelRequest,
  TextureLevelStore,
} from './materials/texture/levelReader.ts'
export type {
  AtlasLanes,
  LaneCounts,
  TextureCompression,
} from './materials/texture/blockFormats.ts'
export type { TextureCache } from './materials/texture/textureCaches.ts'
export type { WorldCells } from './geometry/dag/worlds/worldCells.ts'
export type { ActorWarmth } from './geometry/dag/worlds/worldWarm.ts'
export type {
  HostRetentionDelta,
  PageStreamerOptions,
  StreamPage,
} from './geometry/streaming/types.ts'
export type { BatchRead } from './geometry/streaming/types.ts'
export type { BoxTransformLot, MultiplyLot } from './geometry/decode/batchRuntime.ts'
export { framingFromBounds } from './camera/framing.ts'
export { presentationColorDiagnostic } from './diagnostic/presentationDiagnostic.ts'
export { createGpuPageCache, type GpuPageCacheOptions } from './geometry/pages/pool/pages.ts'
export type { ResidentPage } from './geometry/pages/pool/types.ts'
export type { EvictionOrder } from './geometry/pages/pool/eviction.ts'
export type { PageHome, PageHomes, PageUnit, PageUnitsOf } from './geometry/pages/pool/homes.ts'
export type { GrownPages } from './geometry/pages/pool/resize.ts'
export type { RootSlots } from './geometry/pages/pool/placement.ts'
// The animation banks a mesh's track (`Mesh.bank`) names and the clock they play by, and the setting
// rules the run-time options are resolved by: named where the public signatures carry them.
export type {
  AnimationBanks,
  BankBake,
  BankItem,
  BankTrack,
  DecodedBanks,
} from '../../sdk-core/src/scene/core/animationBanks.ts'
export type { BankClock } from '../../sdk-core/src/world/animation/bankClock.ts'
export type {
  RulesByField,
  SettingOptions,
  SettingRange,
  SettingValues,
} from '../../sdk-core/src/contracts/settingRules.ts'
// The sun's shadow settings (`world.shadows`, `WorldOptions`): their rules, the shadow distance a
// light names (`LightParameters.shadowDistance`) and its default.
export {
  SHADOW_DISTANCE_DEFAULT,
  SHADOW_RULES,
  type ShadowDistanceOption,
  type ShadowOptions,
} from '../../sdk-core/src/contracts/shadowOptions.ts'
export { createPageStreamer } from './geometry/streaming/pageStreamer.ts'
// The page cache a streamer reads through, its owner's (`PageStreamerOptions.cache`).
export {
  createPageCache,
  type CacheSession,
  type PageCache,
} from './geometry/streaming/pageCache.ts'
export type { RangeAsk, ReadRange } from './geometry/cluster/ranged.ts'
export type { ByteMeter } from './geometry/cluster/byteMeter.ts'
export { LOD_QUALITY } from '../../sdk-core/src/lod/policy.ts'
export type { LightingCapabilities } from '../../sdk-core/src/scene/light/capabilities.ts'
// A job around a load — cancellation, a status to observe — for pages built on the runtime.
export { createJob } from '../../sdk-core/src/runtime/jobs/jobs.ts'
export type { JobProgress, JobSnapshot, JobStatus } from '../../sdk-core/src/runtime/jobs/jobs.ts'
export { detectCapabilities, type GpuCapabilities } from './api/capability/capabilities.ts'
export type { PathRun } from './camera/path.ts'
// The camera controllers a session hands out: their contract is public because
// `explorer.controls()` and its four siblings return it (`docs/SDK.md`, "Camera controllers").
export type { ChangeListener, ControlVector, PivotCameraControls } from './camera/controls/types.ts'
export type { OrbitCameraControls } from './camera/controls/orbitControls.ts'
export type { FlyCameraControls } from './camera/controls/flyControls.ts'
export type { FirstPersonCameraControls } from './camera/controls/firstPersonControls.ts'
export type { HeadSettings, PersonHead } from './camera/controls/look.ts'
export type { CharacterCameraControls } from './camera/controls/characterControls.ts'
export type { TrackballCameraControls } from './camera/controls/trackballControls.ts'
export type { PanZoomCameraControls } from './camera/controls/panZoomControls.ts'
