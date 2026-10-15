// A soft body's shared settings as Jolt simulates them, built by one function for the compiler's
// cook (`cook/cook.cpp`) and the physics worker's SOFT (`src/soft.cpp`): a cooked soft body
// restores to the settings the page would have built from the same vertices. A change here
// changes the cook's bytes: it bumps `PHYSICS_COOK_VERSION` (`packages/asset-compiler-rust`).
#pragma once

#include "words.h"

#include <Jolt/Physics/SoftBody/SoftBodySharedSettings.h>

#include <algorithm>
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
  for (const uint32_t *v = vertices, *end = v + count * SOFT_VERTEX_WORDS; v < end; v += SOFT_VERTEX_WORDS) {
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
    // A cloth that never stretches holds each free vertex within its rest distance of the nearest
    // pin (a long range attachment), a bound its edges, kept exactly, never pass on a flat cloth:
    // a large pinned cloth no longer stretches without end and diverges. One given stretch keeps
    // its give.
    using LRA = SoftBodySharedSettings::ELRAType;
    const LRA attach = stretch == 0 ? LRA::EuclideanDistance : LRA::None;
    SoftBodySharedSettings::VertexAttributes attributes(stretch, stretch, bend, attach);
    using Bend = SoftBodySharedSettings::EBendType;
    shared->CreateConstraints(&attributes, 1, bend < FLT_MAX ? Bend::Dihedral : Bend::None);
  }
  shared->Optimize();
  return shared;
}

/// Declared: no dihedral bend is stiffer than Jolt's solver resolves: its compliance is at least this
/// share of the solver's own over the four vertices it bends at rest, `h²·Σ wᵢ|∇Cᵢ|²` for a substep
/// `h`, so it corrects at most five sixths of the angle it is off within a substep. A stiffer one
/// overshoots: under a load in the cloth's own plane its triangles fold through each other and its
/// bends throw them out of it every substep — the cooked flag's 0.001 rad/(N·m) on vertices of
/// 0.7 g flapped at 10 to 25 m/s, then ran away. Floored, that flag's bends give at least 1.5 to
/// 16 rad/(N·m) (squares of 6 cm, at 60 Hz) and it comes to rest; a cloth clamped along an edge and
/// bent stiff still stands out (its tip 0.28 m down over 0.8 m, 0.22 unfloored). A softer bend is
/// kept as declared.
inline constexpr float SOFT_BEND_FLOOR = 0.2f;
/// Floors each dihedral bend of `shared` at the stiffest Jolt's solver resolves over a substep of
/// `h` seconds (`SOFT_BEND_FLOOR`): the last rule of the settings, applied when a body is made
/// (`soft.cpp`), page-built or restored from the cook, since the substep is the page's.
inline void floorBends(JPH::SoftBodySharedSettings &shared, float h) {
  using namespace JPH;
  for (SoftBodySharedSettings::DihedralBend &b : shared.mDihedralBendConstraints) {
    const auto at = [&](int k) { return Vec3(shared.mVertices[b.mVertex[k]].mPosition); };
    const Vec3 x0 = at(0), x1 = at(1), x2 = at(2), x3 = at(3), e = x1 - x0;
    const float length = e.Length();
    Vec3 n1 = (x2 - x0).Cross(x2 - x1), n2 = (x3 - x1).Cross(x3 - x0);
    if (length < 1e-6f || n1.LengthSq() * n2.LengthSq() < 1e-24f) continue;
    // Its gradient as Jolt takes it (`SoftBodyMotionProperties::ApplyDihedralBendConstraints`).
    n1 /= n1.LengthSq();
    n2 /= n2.LengthSq();
    const Vec3 d0 = ((x2 - x1).Dot(e) * n1 + (x3 - x1).Dot(e) * n2) / length, d2 = length * n1, d3 = length * n2;
    const Vec3 gradient[4] = {d0, -d0 - d2 - d3, d2, d3};
    float own = 0;
    for (int k = 0; k < 4; ++k) own += shared.mVertices[b.mVertex[k]].mInvMass * gradient[k].LengthSq();
    b.mCompliance = std::max(b.mCompliance, SOFT_BEND_FLOOR * own * h * h);
  }
}

}  // namespace trillion
