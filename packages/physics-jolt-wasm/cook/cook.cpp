// The compiler's physics cook (`packages/asset-compiler-rust`, stage `physics-cook`): native Jolt,
// from the same pinned submodule as the web module, turns triangles into shapes and writes them
// with Jolt's own binary state (`src/blob.h`), so the physics worker restores them without
// building a tree. Every entry point returns 0 on success, else 1 and Jolt's error text in place of
// the bytes; either stays valid until the calling thread's next call.
#include "../src/blob.h"

#include <Jolt/Core/Factory.h>
#include <Jolt/Physics/Collision/Shape/HeightFieldShape.h>
#include <Jolt/Physics/Collision/Shape/MeshShape.h>
#include <Jolt/Physics/Collision/Shape/ScaledShape.h>
#include <Jolt/RegisterTypes.h>

#include <algorithm>
#include <cmath>
#include <mutex>
#include <string>

using namespace JPH;

namespace {

thread_local std::vector<uint8_t> written;

void start() {
  static std::once_flag once;
  std::call_once(once, [] {
    RegisterDefaultAllocator();
    Factory::sInstance = new Factory();
    RegisterTypes();
  });
}

uint32_t save(const ShapeSettings::ShapeResult &result, const uint8_t **out, uint32_t *bytes) {
  uint32_t status = result.HasError() ? 1 : 0;
  if (status) {
    const String &error = result.GetError();
    written.assign(error.begin(), error.end());
  } else {
    trillion::BlobOut blob;
    Shape::ShapeToIDMap shapes;
    Shape::MaterialToIDMap materials;
    result.Get()->SaveWithChildren(blob, shapes, materials);
    written.swap(blob.bytes);
  }
  *out = written.data();
  *bytes = uint32_t(written.size());
  return status;
}

// Jolt drops a triangle whose doubled area is under 1e-6 (`IndexedTriangle::IsDegenerate`,
// |cross|² <= 1e-12): an absolute area, so a small object in metres — a chess piece of
// sub-millimetre triangles — loses most of its surface, a whole tile of it all of it. The surface
// Jolt keeps is otherwise bounded by its quantization, relative: a tile's box in 2^21 steps
// (`TriangleCodecIndexed8BitPackSOA4Flags::COMPONENT_BITS`). The absolute test is never the
// stricter one once a step is 1e-3 or more, the box 2^21 × 1e-3 ≈ 2^11: the scale returned is the
// power of two bringing the box there, 1 when the box is already that large or no triangle would
// be kept for it. A power of two scales a float exactly, both ways.
float unitScale(const VertexList &list, const IndexedTriangleList &triangles, VertexList &scaled) {
  AABox box;
  for (const Float3 &v : list) box.Encapsulate(Vec3(v));
  float extent = list.empty() ? 0.0f : box.GetSize().ReduceMax();
  if (!(extent > 0.0f) || !std::isfinite(extent)) return 1.0f;
  int power = int(std::clamp(std::ceil(std::log2(2048.0f / extent)), 0.0f, 64.0f));
  if (power == 0) return 1.0f;
  float k = std::ldexp(1.0f, power);
  scaled.reserve(list.size());
  for (const Float3 &v : list) scaled.push_back(Float3(v.x * k, v.y * k, v.z * k));
  for (const IndexedTriangle &t : triangles)
    if (t.IsDegenerate(list) && !t.IsDegenerate(scaled)) return k;
  return 1.0f;
}

}  // namespace

extern "C" {

/// A static triangle mesh: `vertexCount` points (3 floats each) and `triangleCount` triangles (3
/// indices each). It carries no material: a tile is of its collider's, named in `physics.json`. A tile
/// Jolt would thin (`unitScale`) is cooked scaled up and wrapped in a `ScaledShape` of the inverse.
uint32_t cook_mesh(const float *vertices, uint32_t vertexCount, const uint32_t *indices, uint32_t triangleCount,
                   const uint8_t **out, uint32_t *bytes) {
  start();
  VertexList list;
  list.reserve(vertexCount);
  for (uint32_t i = 0; i < vertexCount; ++i) list.push_back(Float3(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]));
  IndexedTriangleList triangles;
  triangles.reserve(triangleCount);
  for (uint32_t i = 0; i < triangleCount; ++i)
    triangles.push_back(IndexedTriangle(indices[i * 3], indices[i * 3 + 1], indices[i * 3 + 2]));
  VertexList scaled;
  float k = unitScale(list, triangles, scaled);
  ShapeSettings::ShapeResult mesh = MeshShapeSettings(k == 1.0f ? list : scaled, triangles).Create();
  if (k == 1.0f || mesh.HasError()) return save(mesh, out, bytes);
  return save(ScaledShapeSettings(mesh.Get(), Vec3::sReplicate(1.0f / k)).Create(), out, bytes);
}

/// A height field of `sampleCount`² heights (row by row along z, `FLT_MAX` for a hole), placed by
/// `offset` and `scale` (3 floats each), without material.
uint32_t cook_height_field(const float *samples, uint32_t sampleCount, const float *offset, const float *scale,
                           const uint8_t **out, uint32_t *bytes) {
  start();
  HeightFieldShapeSettings settings(samples, Vec3(offset[0], offset[1], offset[2]), Vec3(scale[0], scale[1], scale[2]),
                                    sampleCount);
  return save(settings.Create(), out, bytes);
}

}  // extern "C"
