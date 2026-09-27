// Reading the command words: floats, vectors and turns (layout.ts), shared by the commands and
// the shapes they build.
#pragma once

#include <Jolt/Jolt.h>

#include <cstdint>
#include <cstring>

namespace trillion {

/// Words of an ADD command before its mesh data (layout.ts).
constexpr uint32_t ADD_WORDS = 25;
/// Words of each soft body vertex (softLayout.ts): `x, y, z, mass`.
constexpr uint32_t SOFT_VERTEX_WORDS = 4;
/// Words of one water piece (layout.ts WATER_PIECE_WORDS) and of one BUOYANCY plane (PLANE_WORDS).
constexpr uint32_t PIECE_WORDS = 6, PLANE_WORDS = 8;

inline float f32(const uint32_t *w) {
  float value;
  std::memcpy(&value, w, 4);
  return value;
}
/// Writes `value` as the float word `f32` reads.
inline void putF32(uint32_t *w, float value) { std::memcpy(w, &value, 4); }
inline JPH::Vec3 vec3(const uint32_t *w) { return JPH::Vec3(f32(w), f32(w + 1), f32(w + 2)); }
inline JPH::Quat quat(const uint32_t *w) {
  return JPH::Quat(f32(w), f32(w + 1), f32(w + 2), f32(w + 3)).Normalized();
}

}  // namespace trillion
