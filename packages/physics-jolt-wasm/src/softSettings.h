// A soft body's shared settings as Jolt simulates them, built by one function for the compiler's
// cook (`cook/cook.cpp`) and the physics worker's SOFT (`src/soft.cpp`): a cooked soft body
// restores to the settings the page would have built from the same vertices.
#pragma once

#include "words.h"

#include <Jolt/Physics/SoftBody/SoftBodySharedSettings.h>

#include <cfloat>
#include <cmath>

namespace trillion {

/// A compliance as the words carry it: `Infinity` is Jolt's "no constraint".
inline float compliance(float value) { return std::isfinite(value) ? value : FLT_MAX; }

/// The settings of `count` vertices, `x, y, z, mass` words each in the geometry's frame, scaled
/// by `scale` (a mass of 0 is a pin: held where it is), joined by their `cornerCount` triangle
/// corners, or each to the next without any (a rope); `stretch` and `bend` are compliances,
/// `Infinity` for none, a rope's `bend` holding each vertex at its distance from the one after
/// next. Null when there are fewer than two vertices, or a corner names no vertex or a triangle
/// is degenerate.
inline JPH::Ref<JPH::SoftBodySharedSettings> softSettings(const uint32_t *vertices, uint32_t count, JPH::Vec3 scale,
                                                          const uint32_t *corners, uint32_t cornerCount,
                                                          float stretch, float bend) {
  using namespace JPH;
  if (count < 2) return nullptr;
  Ref<SoftBodySharedSettings> shared = new SoftBodySharedSettings;
  for (const uint32_t *v = vertices, *end = v + count * 4; v < end; v += 4) {
    Float3 at;
    (vec3(v) * scale).StoreFloat3(&at);
    shared->mVertices.emplace_back(at, Float3(0, 0, 0), f32(v + 3) > 0 ? 1.0f / f32(v + 3) : 0.0f);
  }
  stretch = compliance(stretch);
  bend = compliance(bend);
  if (cornerCount == 0) {
    for (uint32_t i = 0; i + 1 < count; ++i) shared->mEdgeConstraints.emplace_back(i, i + 1, stretch);
    for (uint32_t i = 0; bend < FLT_MAX && i + 2 < count; ++i) shared->mEdgeConstraints.emplace_back(i, i + 2, bend);
    shared->CalculateEdgeLengths();
  } else {
    for (uint32_t i = 0; i + 2 < cornerCount; i += 3) {
      const uint32_t *c = corners + i;
      if (c[0] >= count || c[1] >= count || c[2] >= count) return nullptr;
      SoftBodySharedSettings::Face face(c[0], c[1], c[2]);
      if (face.IsDegenerate()) return nullptr;
      shared->AddFace(face);
    }
    SoftBodySharedSettings::VertexAttributes attributes(stretch, stretch, bend);
    using Bend = SoftBodySharedSettings::EBendType;
    shared->CreateConstraints(&attributes, 1, bend < FLT_MAX ? Bend::Dihedral : Bend::None);
  }
  shared->Optimize();
  return shared;
}

}  // namespace trillion
