// The part under a plane of a body of revolution Jolt measures by its box: its capsule, cylinder
// and tapered cylinder (`roundVolume.cpp`).
#pragma once

#include <Jolt/Jolt.h>

#include <Jolt/Geometry/AABox.h>
#include <Jolt/Geometry/Plane.h>
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

/// The body of revolution `shape` is: a capsule, a cylinder or a tapered cylinder, or one of them
/// under an `OffsetCenterOfMassShape`, whose frame is then `offset` from the shape's. False for
/// any other shape.
bool roundOf(const JPH::Shape &shape, Round &round, JPH::Vec3 &offset);

/// The bounds, in its own frame, of the part of `round` from `from` to `to` along its axis.
JPH::AABox roundBounds(const Round &round, float from, float to);

/// The same volume as `Shape::GetSubmergedVolume` gives, exactly, for the part of `round` from `from` to `to`
/// along its axis placed by `transform` (a rotation and a translation): its volume, the volume
/// under `surface` (below its plane) and that volume's centre, in `surface`'s space.
void roundSubmerged(const Round &round, float from, float to, JPH::Mat44Arg transform,
                    const JPH::Plane &surface, float &total, float &submerged, JPH::Vec3 &centre);

}  // namespace trillion
