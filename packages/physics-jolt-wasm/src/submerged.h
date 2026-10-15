// THE ONE SUBMERGED-VOLUME INTEGRATOR: the part of a shape under the water plane, measured exactly
// for every shape a body is made of — a box, a hull, a sphere, a capsule, a cylinder, a tapered
// cylinder, through Scaled, RotatedTranslated and OffsetCenterOfMass shapes and compounds of them —
// in place of Jolt's `GetSubmergedVolume`, which measures a capsule or a cylinder by the box of its
// bounds. A leaf is measured in its own frame, the planes taken there (`submerged.cpp`): a round
// one by its sections (`roundVolume.cpp`), a polyhedral one clipped by the planes.
#pragma once

#include <Jolt/Jolt.h>

#include <Jolt/Geometry/Plane.h>
#include <Jolt/Physics/Collision/Shape/Shape.h>

#include <cstdint>

namespace trillion {

/// A half-space `normal · x + constant <= 0`: the water's (under it), or a slab's side.
struct Cut {
  JPH::Vec3 normal;
  float constant;
};

/// What the integrator sums: the volume within the slab, the volume of it under the water, and that
/// volume times its centre.
struct Submerged {
  float total = 0, volume = 0;
  JPH::Vec3 moment = JPH::Vec3::sZero();
};

/// Adds to `out` the part of `shape`, placed by `transform` (its centre-of-mass frame in the water's
/// space) at `scale`, that lies within the `slabCount` cuts of `slab` (in that same space): its
/// volume, and its volume under `water`, exactly.
void submerged(const JPH::Shape &shape, JPH::Mat44Arg transform, JPH::Vec3Arg scale, const Cut &water,
               const Cut *slab, uint32_t slabCount, Submerged &out);

/// The compound `shape` is a piece list of, under its single-child decorators, with the transform
/// and scale they place it by from `transform` and `scale`; null for a shape that is no compound.
const JPH::Shape *compoundOf(const JPH::Shape &shape, JPH::Mat44 &transform, JPH::Vec3 &scale);

/// Whether `shape` can be cut in slices across `axis` of its own frame: a polyhedral leaf at any
/// axis, a round one along its own (its sections are discs).
bool sliceable(const JPH::Shape &shape, JPH::Vec3Arg axis);

}  // namespace trillion
