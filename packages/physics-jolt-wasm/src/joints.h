// What the joint files share: a joint end's frame (the kinds and motor modes of the JOINT command
// are layout.h's), every kind's settings (`jointSettings.cpp`), motors and pull (`jointMotors.cpp`).
#pragma once

#include <Jolt/Jolt.h>

#include <Jolt/Physics/Body/BodyID.h>
#include <Jolt/Physics/Constraints/MotorSettings.h>
#include <Jolt/Physics/Constraints/TwoBodyConstraint.h>

#include "layout.h"

#include <cstdint>

namespace trillion {

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
/// A joint end's frame from the JOINT words at `w` for the body `engine` names (`jointSettings.cpp`).
Frame frameOf(const uint32_t *w, uint32_t engine);
/// The body a joint end names, or the world when it names none (`BodyID()`); false when the slot
/// holds no body (refused, or removed since): the joint is not made.
bool bodyOf(uint32_t engine, JPH::BodyID &id);

/// The settings of joint kind `kind` (`jointSettings.cpp`) between the page's `b` frame `f1` and
/// its `a` frame `f2` (a gear or a rack swaps them when `order.aFirst`). `v` is `min, max,
/// frequency, damping`; `extra` the kind's own words (layout.ts JOINT), `count` of them; `anchor1`
/// the second body's anchor in the first body's frame, where a path starts. Null when the words do
/// not make one (a path of one point).
JPH::Ref<JPH::TwoBodyConstraintSettings> jointSettings(uint32_t kind, const Frame &f1, const Frame &f2,
                                                       const uint32_t *v, const uint32_t *extra, uint32_t count,
                                                       JPH::Vec3 anchor1, GearOrder order);
/// Drives a hinge (radians), a slider (metres), a swing-twist, a six-DOF's `axis` (0 to 5) or a
/// path by its motor in `mode` (layout.h MotorMode), with at most `maxForce` (N·m or N; 0 is no
/// bound), and wakes it (`jointMotors.cpp`); a kind without one is left as it is.
void driveJoint(JPH::Constraint *constraint, uint32_t kind, uint32_t mode, float target, float maxForce,
                uint32_t axis);
/// Gives a gear its wheels' hinges and a rack and pinion its pinion's hinge and rack's slider, in
/// Jolt's body order (null when one is missing): Jolt's position correction reads their angle and
/// slide to hold the teeth in phase.
void linkGear(JPH::Constraint *constraint, uint32_t kind, const JPH::Constraint *first, const JPH::Constraint *second);
/// The impulse a joint gave its bodies in the last step: linear (N·s), angular for a gear or a
/// rack (N·m·s), the pull its break force is measured against.
float jointPull(JPH::Constraint *constraint, uint32_t kind);
/// Where a path joint's body stands along its path now: Jolt's fraction of the closest point.
float pathFraction(const JPH::Constraint *constraint);
/// After a step, turns the velocity of a path joint's body from the path's tangent at `before`
/// (its fraction when the step began) to the tangent where it now stands, its speed kept
/// (`pathCarry.cpp`): a frictionless path does no work.
void carryAlongPath(JPH::Constraint *constraint, float before);

}  // namespace trillion
