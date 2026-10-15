// The part under a plane of a body of revolution — a sphere, a capsule, a cylinder, a tapered
// cylinder —, the round leaves of the one submerged-volume integrator (`submerged.cpp`).
#pragma once

#include <Jolt/Jolt.h>

#include <Jolt/Physics/Collision/Shape/Shape.h>

namespace trillion {

/// A body of revolution about its own y axis, in its centre of mass frame: a side from `bottom` to
/// `top` whose radius runs from `bottomRadius` to `topRadius`, closed by a hemisphere of radius
/// `cap` at each end (0: flat ends).
struct Round {
  float bottom, top, bottomRadius, topRadius, cap;

  /// Where it starts along its axis, and its length there.
  float start() const { return bottom - cap; }
  float length() const { return top - bottom + 2 * cap; }
};

/// The body of revolution the leaf `shape` is: a sphere, a capsule, a cylinder or a tapered
/// cylinder; false for any other shape.
bool roundOf(const JPH::Shape &shape, Round &round);

/// The part of `round` from `from` to `to` along its axis, in its own frame: its volume, the volume
/// under the plane `normal · x + constant = 0` (`normal` a unit vector, under where it is negative)
/// and that volume's centre.
void roundSubmerged(const Round &round, float from, float to, JPH::Vec3 normal, float constant, float &total,
                    float &submerged, JPH::Vec3 &centre);

}  // namespace trillion
