// The physics a page writes: bodies, their options and matter, soft bodies, joints and vehicles.
export {
  ObjectPhysics,
  type ContactEvent,
  type ContactEventName,
  type PhysicsHost,
} from './objectPhysics.ts'
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
} from './options.ts'
export {
  channelIndex,
  channelsMeet,
  COLLISION_CHANNELS,
  COLLISION_PROFILES,
  defaultProfile,
  resolveCollision,
  RESPONSE,
  type CollisionChannel,
  type CollisionProfileName,
  type CollisionResponse,
  type ResolvedCollision,
} from './collisionChannels.ts'
export {
  SOFT_AREAL_DENSITY,
  SOFT_LINEAR_DENSITY,
  SOFT_FOOTPRINT,
  type SoftBodyCommon,
  type SoftBodyOptions,
  type SoftBodyType,
  type SoftSettings,
  type SoftVolumeOptions,
} from './soft/soft.ts'
export { Joint, joint } from './joint/joint.ts'
export type {
  JointKind,
  JointLimits,
  JointMotor,
  JointOptions,
  SixDofAxis,
} from './joint/jointOptions.ts'
export * from './vehicle/vehicle.ts'
export { VEHICLE_SPECS, type VehicleSpec, type VehicleSpecs } from './vehicle/vehicleSpec.ts'
