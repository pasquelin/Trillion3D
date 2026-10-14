// The world and its families: what a page writes. One barrel per family folder.
export * from './world/core/index.ts'
export * from '../../sdk-core/src/world/math/index.ts'
export * from '../../sdk-core/src/world/geometry/index.ts'
export * from '../../sdk-core/src/world/buffer/index.ts'
export * from '../../sdk-core/src/world/object/index.ts'
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
export * from './world/texture/index.ts'
export * from './world/api/loaderFamily.ts'
export * from './world/api/helperFamily.ts'
export {
  GUIDE_VERTEX_CEILING,
  type Guides,
  type GuideHandle,
  type GuideLines,
  type GuidePoints,
} from './guides/guideSet.ts'
export * from './world/controls/index.ts'
export * from './world/page/index.ts'
export * from './world/api/budgetFamily.ts'
export {
  ObjectPhysics,
  type ContactEvent,
  type ContactEventName,
  type PhysicsHost,
} from '../../sdk-core/src/physics/objectPhysics.ts'
export {
  GRAVITY_PRESETS,
  PHYSICS_MATERIALS,
  DEFAULT_PHYSICS_BUDGET,
  type PhysicsType,
  type PhysicsShape,
  type PhysicsPrimitive,
  type PhysicsPart,
  type PhysicsBodyOptions,
  type PhysicsOption,
  type GravityPreset,
  type PhysicsMaterialPreset,
  type PhysicsMatter,
  type PhysicsBudget,
} from '../../sdk-core/src/physics/options.ts'
export {
  SOFT_AREAL_DENSITY,
  SOFT_LINEAR_DENSITY,
  SOFT_FOOTPRINT,
  type SoftBodyCommon,
  type SoftBodyOptions,
  type SoftBodyType,
  type SoftSettings,
  type SoftVolumeOptions,
} from '../../sdk-core/src/physics/soft.ts'
export { Joint, joint } from '../../sdk-core/src/physics/joint.ts'
export type {
  JointKind,
  JointLimits,
  JointMotor,
  JointOptions,
  SixDofAxis,
} from '../../sdk-core/src/physics/jointOptions.ts'
export type { WorldPhysics } from './physics/worldPhysics.ts'
export type { WorldPhysicsOptions, GravityInput } from './physics/worldPhysicsOptions.ts'
export type { WaterSpec } from '../../sdk-core/src/fluids/buoyancy.ts'
export type { WaveSpec, Waves } from '../../sdk-core/src/fluids/waves.ts'
export type { WaterSurface } from '../../sdk-core/src/fluids/waterSurface.ts'
export type { PhysicsStats } from './physics/protocol.ts'
export * from './world/api/metricFamily.ts'
export * from './world/diagnostic/index.ts'
export * from './world/capability/index.ts'
export * from './world/capture/index.ts'
export * from './world/api/poseFamily.ts'
export * from './world/api/batchFamily.ts'
export type { CreatedMaterial } from './world/api/createdMaterials.ts'
export type { SceneMaterial, SceneMaterialPatch } from './world/api/materialValues.ts'
export { EngineProfiler } from './diagnostic/telemetry.ts'
export type { TelemetryReport } from './diagnostic/telemetryTypes.ts'
export type { AssetScope, StablePreview } from '../../sdk-core/src/contracts/base.ts'
export type { FrameMetrics } from '../../sdk-core/src/contracts/metrics.ts'
export type { ClusterManifest } from '../../sdk-core/src/contracts/geometry.ts'
export type { EngineDiagnostic, DiagnosticDetail } from './diagnostic/types.ts'
export type { PointOfInterest } from './world/session/options.ts'
/** Placement rows, a cell's decoded rows and how a frame grows them in place, from the scene. */
export type { PlacementRows } from './placement/rows.ts'
/** A row of a scene's instance buffer that follows its parent, composed on the GPU. */
export type { PlacementLink } from './placement/gpuCompose.ts'
/** What the engine draws, source by source (`page/selection/drawSource.ts`). */
export type { DrawAssociations, DrawRanks, DrawSource } from './page/selection/drawSource.ts'
export type { CellRows } from './partition/cellDecode.ts'
export type { PlacementGrowth } from './placement/engineSceneUpdates.ts'
/** Host resources the engine reads and never builds (`host/resources.ts`): a host declares them
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
} from './host/resources.ts'
/** The shapes a host node's pose and rotation are read through (`host/scene/graphNodes.ts`). */
export type { HostRotation, HostVector } from './host/scene/graphNodes.ts'
/** The surface record a mesh of the engine's graph wears (`page/surface.ts`), holding the core's
 *  texture records; its nodes are the core's. Its three parts are named: the shaded fields
 *  (`VisMaterial`), the raster facts (`SurfaceFacts`) and its release (`Releasable`). */
export type { PageSurface, SurfaceFacts, SurfaceFamily } from './page/surface.ts'
export type { VisMaterial } from './visibility/materialType.ts'
export type { Releasable } from '../../sdk-core/src/runtime/releasable.ts'
export { declareSurface } from './page/surfaceRecord.ts'
export type { SurfaceDeclaration } from './page/surfaceDeclaration.ts'
export type { HostNodeMatrix, MatrixElements } from './host/matrixElements.ts'
export { gpuPassBlockOf, gpuPassBlockTotals, gpuPassStageOf } from './diagnostic/gpuPasses.ts'
export type { GpuPassBlockTotals } from './gpu/core/passBlocks.ts'
export type { GpuPassBlock } from './stage/passDeclaration.ts'
export { createDiagnosticChannel } from './diagnostic/channel.ts'
export type {
  DiagnosticChannel,
  DiagnosticChannelOptions,
  DiagnosticObserver,
} from './diagnostic/channel.ts'
export type { SurfaceBuffer, SurfaceCapture } from './scene/surfaceBuffer.ts'
export type {
  GeometryPool,
  MemoryBudgets,
  MemoryBudgetsReport,
  PoolClamp,
  TableGrowthReport,
} from './residency/pools.ts'
export type { TexturePool } from './webgpu/residency/memoryBudgets.ts'
export type { BudgetCanvas } from './residency/memoryBudget.ts'
export type { PartitionAudit } from './webgpu/core/partitionAudit.ts'
export type { TransparentOcclusionAudit } from './webgpu/transparent/occlusionAudit.ts'
export type { CpuStepSummary } from './stage/profiler.ts'
export type { ArrivalPlan } from './page/integration/host.ts'
export type { DecodedGeometryPage } from './page/codec/geometryPage.ts'
export type {
  TextureLevel,
  TextureLevelAddress,
  TextureLevelReader,
  TextureLevelRequest,
  TextureLevelStore,
} from './texture/levelReader.ts'
export type { AtlasLanes, LaneCounts, TextureCompression } from './texture/blockFormats.ts'
export type { HostRetentionDelta, PageStreamerOptions, StreamPage } from './streaming/types.ts'
export type { BatchRead } from './streaming/types.ts'
export type { BoxTransformLot, MultiplyLot } from './page/decode/batch/batchRuntime.ts'
export { framingFromBounds } from './camera/framing.ts'
export { presentationColorDiagnostic } from './diagnostic/presentationDiagnostic.ts'
export { createGpuPageCache, type GpuPageCacheOptions } from './gpu/page/pages.ts'
export type { ResidentPage } from './gpu/page/types.ts'
export type { EvictionOrder } from './gpu/page/eviction.ts'
export type { PageHome, PageHomes } from './gpu/page/homes.ts'
export { createPageStreamer } from './streaming/pageStreamer.ts'
// The page cache a streamer reads through, its owner's (`PageStreamerOptions.cache`).
export { createPageCache, type CacheSession, type PageCache } from './streaming/pageCache.ts'
export type { RangeAsk, ReadRange } from './cluster/ranged.ts'
export type { ByteMeter } from './cluster/byteMeter.ts'
export { LOD_QUALITY } from '../../sdk-core/src/lod/policy.ts'
export type { LightingCapabilities } from '../../sdk-core/src/scene/light/capabilities.ts'
// A job around a load — cancellation, a status to observe — for pages built on the runtime.
export { createJob } from '../../sdk-core/src/runtime/jobs/jobs.ts'
export type { JobProgress, JobSnapshot, JobStatus } from '../../sdk-core/src/runtime/jobs/jobs.ts'
export { detectCapabilities, type GpuCapabilities } from './world/capability/capabilities.ts'
export type { PathRun } from './camera/path.ts'
// The camera controllers a session hands out: their contract is public because
// `explorer.controls()` and its four siblings return it (`docs/SDK.md`, "Camera controllers").
export type { ChangeListener, ControlVector, PivotCameraControls } from './camera/controls/types.ts'
export type { OrbitCameraControls } from './camera/controls/orbitControls.ts'
export type { FlyCameraControls } from './camera/controls/flyControls.ts'
export type { FirstPersonCameraControls } from './camera/controls/firstPersonControls.ts'
export type { HeadSettings, PersonHead } from './camera/controls/look.ts'
export type { CharacterCameraControls } from './camera/controls/characterControls.ts'
export * from '../../sdk-core/src/physics/vehicle.ts'
export {
  VEHICLE_SPECS,
  type VehicleSpec,
  type VehicleSpecs,
} from '../../sdk-core/src/physics/vehicleSpec.ts'
export type { TrackballCameraControls } from './camera/controls/trackballControls.ts'
export type { PanZoomCameraControls } from './camera/controls/panZoomControls.ts'
