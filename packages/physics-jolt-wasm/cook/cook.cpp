// The compiler's physics cook (`packages/asset-compiler-rust`, stage `physics-cook`): native Jolt,
// from the same pinned submodule as the web module, turns triangles into shapes and writes them
// with Jolt's own binary state (`src/blob.h`), so the physics worker restores them without
// building a tree; a soft body's settings are built as the worker builds them (`src/softSettings.h`)
// and written the same way. Every entry point returns 0 on success, else 1 and Jolt's error text in place of
// the bytes; either stays valid until the calling thread's next call.
#include "../src/blob.h"
#include "../src/mesh.h"
#include "../src/softSettings.h"

#include <Jolt/Core/Factory.h>
#include <Jolt/Physics/Collision/Shape/HeightFieldShape.h>
#include <Jolt/RegisterTypes.h>

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

/// Hands the calling thread's bytes over; `status` as the entry point returns it.
uint32_t taken(uint32_t status, const uint8_t **out, uint32_t *bytes) {
  *out = written.data();
  *bytes = uint32_t(written.size());
  return status;
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
  return taken(status, out, bytes);
}

}  // namespace

extern "C" {

/// A static triangle mesh: `vertexCount` points (3 floats each) and `triangleCount` triangles (3
/// indices each). It carries no material: a tile is of its collider's, named in `physics.json`. A tile
/// Jolt would thin is cooked scaled up and wrapped in a `ScaledShape` of the inverse (`src/mesh.h`).
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
  return save(trillion::wholeMesh(list, triangles), out, bytes);
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

/// A soft body's `SoftBodySharedSettings`: `vertexCount` vertices (`x, y, z, mass` each, scaled by
/// `scale`'s 3 floats; a mass of 0 a pin) joined by `cornerCount` triangle corners, or each to the
/// next without any (a rope), of compliances `stretch` and `bend` (`Infinity` for none).
uint32_t cook_soft_body(const float *vertices, uint32_t vertexCount, const float *scale, const uint32_t *corners,
                        uint32_t cornerCount, float stretch, float bend, const uint8_t **out, uint32_t *bytes) {
  start();
  Ref<SoftBodySharedSettings> shared =
      trillion::softSettings(reinterpret_cast<const uint32_t *>(vertices), vertexCount, Vec3(scale[0], scale[1], scale[2]),
                             corners, cornerCount, stretch, bend);
  if (!shared) {
    static const char refused[] = "a soft body needs two vertices, and triangles whose corners name three distinct vertices of its own";
    written.assign(refused, refused + sizeof(refused) - 1);
    return taken(1, out, bytes);
  }
  trillion::BlobOut blob;
  SoftBodySharedSettings::SharedSettingsToIDMap settings;
  SoftBodySharedSettings::MaterialToIDMap materials;
  shared->SaveWithMaterials(blob, settings, materials);
  written.swap(blob.bytes);
  return taken(0, out, bytes);
}

}  // extern "C"
