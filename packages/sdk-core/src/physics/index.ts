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
  SOFT_AREAL_DENSITY,
  SOFT_LINEAR_DENSITY,
  SOFT_FOOTPRINT,
  type SoftBodyCommon,
  type SoftBodyOptions,
  type SoftBodyType,
  type SoftSettings,
  type SoftVolumeOptions,
} from './soft.ts'
export { Joint, joint } from './joint.ts'
export type {
  JointKind,
  JointLimits,
  JointMotor,
  JointOptions,
  SixDofAxis,
} from './jointOptions.ts'
export * from './vehicle.ts'
export { VEHICLE_SPECS, type VehicleSpec, type VehicleSpecs } from './vehicleSpec.ts'
