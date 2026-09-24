// A static triangle mesh as Jolt keeps it whole, shared by the compiler's cook (`cook/cook.cpp`)
// and the physics worker's TRIANGLES shapes (`src/shapes.cpp`).
#pragma once

#include <Jolt/Jolt.h>

#include <Jolt/Geometry/AABox.h>
#include <Jolt/Physics/Collision/Shape/MeshShape.h>
#include <Jolt/Physics/Collision/Shape/ScaleHelpers.h>
#include <Jolt/Physics/Collision/Shape/ScaledShape.h>

#include <algorithm>
#include <cmath>

namespace trillion {

// Jolt drops a triangle whose doubled area is under 1e-6 (`IndexedTriangle::IsDegenerate`,
// |cross|² <= 1e-12): an absolute area, so a small object in metres — a chess piece of
// sub-millimetre triangles — loses most of its surface, a whole tile of it all of it. The surface
// Jolt keeps is otherwise bounded by its quantization, relative: a mesh's box in 2^21 steps
// (`TriangleCodecIndexed8BitPackSOA4Flags::COMPONENT_BITS`). The absolute test is never the
// stricter one once a step is 1e-3 or more, the box 2^21 × 1e-3 ≈ 2^11: the scale returned is the
// power of two bringing the box there, at most the one whose inverse Jolt still accepts as a
// scale (`ScaleHelpers::cMinScale`, 2^19), and 1 when the box is already that large or no
// triangle would be kept for it. A power of two scales a float exactly, both ways.
inline float unitScale(const JPH::VertexList &list, const JPH::IndexedTriangleList &triangles, JPH::VertexList &scaled) {
  JPH::AABox box;
  for (const JPH::Float3 &v : list) box.Encapsulate(JPH::Vec3(v));
  float extent = list.empty() ? 0.0f : box.GetSize().ReduceMax();
  if (!(extent > 0.0f) || !std::isfinite(extent)) return 1.0f;
  const float largest = std::floor(-std::log2(JPH::ScaleHelpers::cMinScale));
  int power = int(std::clamp(std::ceil(std::log2(2048.0f / extent)), 0.0f, largest));
  if (power == 0) return 1.0f;
  float k = std::ldexp(1.0f, power);
  scaled.reserve(list.size());
  for (const JPH::Float3 &v : list) scaled.push_back(JPH::Float3(v.x * k, v.y * k, v.z * k));
  for (const JPH::IndexedTriangle &t : triangles)
    if (t.IsDegenerate(list) && !t.IsDegenerate(scaled)) return k;
  return 1.0f;
}

/// The `MeshShape` of `list` and `triangles`; a mesh Jolt would thin (`unitScale`) is built scaled
/// up and wrapped in a `ScaledShape` of the inverse, exactly the drawn surface.
inline JPH::ShapeSettings::ShapeResult wholeMesh(const JPH::VertexList &list, const JPH::IndexedTriangleList &triangles) {
  JPH::VertexList scaled;
  float k = unitScale(list, triangles, scaled);
  JPH::ShapeSettings::ShapeResult mesh = JPH::MeshShapeSettings(k == 1.0f ? list : scaled, triangles).Create();
  if (k == 1.0f || mesh.HasError()) return mesh;
  return JPH::ScaledShapeSettings(mesh.Get(), JPH::Vec3::sReplicate(1.0f / k)).Create();
}

}  // namespace trillion
