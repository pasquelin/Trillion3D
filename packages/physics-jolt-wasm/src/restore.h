// Cooked shapes (`cook/cook.cpp`), restored in the worker from the command buffer: RESTORE carries
// a shape's binary state under a handle, RELEASE drops it, and an ADD of kind COOKED names it.
#pragma once

#include <Jolt/Jolt.h>

#include <Jolt/Physics/Collision/Shape/Shape.h>

#include <cstdint>

namespace trillion {

/// Words of RESTORE before its bytes (`op, handle, byteCount`), and of RELEASE (`op, handle`).
constexpr uint32_t RESTORE_WORDS = 3, RELEASE_WORDS = 2;

/// Restores the shape a RESTORE command carries; false (with `world().error`) when unreadable.
bool restoreShape(const uint32_t *w);
/// Drops the handle a RELEASE command names: bodies still using the shape keep it.
void releaseShape(const uint32_t *w);
/// The restored shape of `handle`, scaled by `scale` when it is not 1; null when unknown.
JPH::RefConst<JPH::Shape> cookedShape(uint32_t handle, JPH::Vec3 scale);

}  // namespace trillion
