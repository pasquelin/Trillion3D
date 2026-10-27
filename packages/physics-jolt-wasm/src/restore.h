// Cooked shapes (`cook/cook.cpp`), restored in the worker from the command buffer: RESTORE carries
// a shape's binary state under a handle, RELEASE drops it, and an ADD of kind COOKED names it.
#pragma once

#include <Jolt/Jolt.h>

#include <Jolt/Physics/Collision/Shape/Shape.h>

#include "layout.h"

#include <cstdint>

namespace trillion {

/// Restores the shape a RESTORE command carries; false (with `world().error`) when unreadable.
bool restoreShape(const uint32_t *w);
/// Drops the handle a RELEASE command names: bodies still using the shape keep it.
void releaseShape(const uint32_t *w);
/// The restored shape of `handle`, scaled by `scale` when it is not 1; null when unknown.
JPH::RefConst<JPH::Shape> cookedShape(uint32_t handle, JPH::Vec3 scale);
/// The primitive `kind` (layout.ts SHAPE) of the dimensions `a, b, c` held by the three words at
/// `extents`, built once and shared (`shapes.cpp`): an ADD's body and a sweep's shape are the same
/// shape; null when refused.
JPH::RefConst<JPH::Shape> primitiveOfKind(uint32_t kind, const uint32_t *extents);
/// The primitive a scene query's shape kind names (layout.ts CAST and OVERLAP's shapes: sphere 1,
/// box 2, capsule 3), of the dimensions at `extents`: the shape a sweep or an overlap tests with.
JPH::RefConst<JPH::Shape> queryPrimitive(uint32_t kind, const uint32_t *extents);
/// Lets go of the primitives the cache alone holds — no body, compound or sweep uses them any
/// more —, once per step: the cache holds the live shapes only.
void prunePrimitives();

}  // namespace trillion
