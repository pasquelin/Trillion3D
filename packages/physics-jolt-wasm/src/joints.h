// What the joint files share: the kinds and motor modes of the JOINT command (layout.ts JOINT),
// a joint end's frame, and the advanced kinds' settings, motors and pull (`advancedJoints.cpp`).
#pragma once

#include <Jolt/Jolt.h>

#include <Jolt/Physics/Constraints/MotorSettings.h>
#include <Jolt/Physics/Constraints/TwoBodyConstraint.h>

#include <cstdint>

namespace trillion {

enum JointKind : uint32_t {
  FIXED,
  POINT,
  HINGE,
  SLIDER,
  DISTANCE,
  CONE,
  SWING_TWIST,
  SIX_DOF,
  PATH,
  PULLEY,
  GEAR,
  RACK_AND_PINION,
};
enum MotorMode : uint32_t { OFF, VELOCITY, POSITION };

/// A joint end's `point, axis, normal`, in its body's centre-of-mass frame (the world's for none).
struct Frame {
  JPH::Vec3 point, axis, normal;
};

/// The settings of an advanced kind (SWING_TWIST and after) between Jolt's first body's frame
/// `f1` and its second's `f2`. `v` is `min, max, frequency, damping`; `extra` the kind's own
/// words (layout.ts JOINT), `count` of them; `anchor1` the second body's anchor in the first
/// body's frame, where a path starts. Null when the words do not make one (a path of one point).
JPH::Ref<JPH::TwoBodyConstraintSettings> advancedSettings(uint32_t kind, const Frame &f1, const Frame &f2,
                                                          const uint32_t *v, const uint32_t *extra, uint32_t count,
                                                          JPH::Vec3 anchor1);
/// Drives a swing-twist, six-DOF or path joint's motor (`axis`: a six-DOF's, 0 to 5); false for
/// a kind without one.
bool driveAdvanced(JPH::Constraint *constraint, uint32_t kind, JPH::EMotorState state, float target, float limit,
                   uint32_t axis);
/// The impulse an advanced joint gave its bodies in the last step: linear (N·s), angular for a
/// gear or a rack (N·m·s), the pull its break force is measured against.
float advancedPull(JPH::Constraint *constraint, uint32_t kind);

}  // namespace trillion
