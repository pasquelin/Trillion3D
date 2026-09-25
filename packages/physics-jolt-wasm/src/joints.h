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

/// How Jolt makes a gear or a rack and pinion. `aFirst`: the page's `a` is Jolt's first body — a
/// rack and pinion's pinion always, a gear's `a` when only 1 / ratio is a whole number. `inPhase`:
/// Jolt's position correction holds the teeth in phase, reading the wheels' hinges — it wraps each
/// hinge's angle to one turn, so it needs the second body's turns per turn of the first to be a
/// whole number (a rack's slide never wraps).
struct GearOrder {
  bool aFirst = false, inPhase = false;
};
GearOrder gearOrder(uint32_t kind, const uint32_t *extra, uint32_t count);

/// The settings of an advanced kind (SWING_TWIST and after) between the page's `b` frame `f1` and
/// its `a` frame `f2` (a gear or a rack swaps them when `gearOrder` says `aFirst`). `v` is `min, max, frequency, damping`; `extra` the kind's own
/// words (layout.ts JOINT), `count` of them; `anchor1` the second body's anchor in the first
/// body's frame, where a path starts. Null when the words do not make one (a path of one point).
JPH::Ref<JPH::TwoBodyConstraintSettings> advancedSettings(uint32_t kind, const Frame &f1, const Frame &f2,
                                                          const uint32_t *v, const uint32_t *extra, uint32_t count,
                                                          JPH::Vec3 anchor1);
/// Drives a swing-twist, six-DOF or path joint's motor (`axis`: a six-DOF's, 0 to 5); false for
/// a kind without one.
bool driveAdvanced(JPH::Constraint *constraint, uint32_t kind, JPH::EMotorState state, float target, float limit,
                   uint32_t axis);
/// Gives a gear its wheels' hinges and a rack and pinion its pinion's hinge and rack's slider, in
/// Jolt's body order (null when one is missing): Jolt's position correction reads their angle and
/// slide to hold the teeth in phase.
void linkGear(JPH::Constraint *constraint, uint32_t kind, const JPH::Constraint *first, const JPH::Constraint *second);
/// The impulse an advanced joint gave its bodies in the last step: linear (N·s), angular for a
/// gear or a rack (N·m·s), the pull its break force is measured against.
float advancedPull(JPH::Constraint *constraint, uint32_t kind);
/// Where a path joint's body stands along its path now: Jolt's fraction of the closest point.
float pathFraction(const JPH::Constraint *constraint);
/// After a step, turns the velocity of a path joint's body from the path's tangent at `before`
/// (its fraction when the step began) to the tangent where it now stands, its speed kept
/// (`pathCarry.cpp`): a frictionless path does no work.
void carryAlongPath(JPH::Constraint *constraint, float before);

}  // namespace trillion
