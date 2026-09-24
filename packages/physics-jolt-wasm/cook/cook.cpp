// The compiler's physics cook (`packages/asset-compiler-rust`, stage `physics-cook`): native Jolt,
// from the same pinned submodule as the web module, turns triangles into shapes and writes them
// with Jolt's own binary state (`src/blob.h`), so the physics worker restores them without
// building a tree. Every entry point returns 0 on success; its bytes stay valid
// until the calling thread's next call.
#include "../src/blob.h"

#include <Jolt/Core/Factory.h>
#include <Jolt/Physics/Collision/PhysicsMaterialSimple.h>
#include <Jolt/Physics/Collision/Shape/HeightFieldShape.h>
#include <Jolt/Physics/Collision/Shape/MeshShape.h>
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

uint32_t save(const ShapeSettings::ShapeResult &result, const uint8_t **out, uint32_t *bytes) {
  if (result.HasError()) return 1;
  trillion::BlobOut blob;
  Shape::ShapeToIDMap shapes;
  Shape::MaterialToIDMap materials;
  result.Get()->SaveWithChildren(blob, shapes, materials);
  written.swap(blob.bytes);
  *out = written.data();
  *bytes = uint32_t(written.size());
  return 0;
}

PhysicsMaterialList materialList(uint32_t count) {
  PhysicsMaterialList list;
  for (uint32_t i = 0; i < count; ++i) list.push_back(new PhysicsMaterialSimple(std::to_string(i), Color::sGrey));
  return list;
}

}  // namespace

extern "C" {

/// A static triangle mesh: `vertexCount` points (3 floats each), `triangleCount` triangles (3
/// indices each) and each triangle's material index below `materialCount`.
uint32_t cook_mesh(const float *vertices, uint32_t vertexCount, const uint32_t *indices, uint32_t triangleCount,
                   const uint32_t *materials, uint32_t materialCount, const uint8_t **out, uint32_t *bytes) {
  start();
  VertexList list;
  list.reserve(vertexCount);
  for (uint32_t i = 0; i < vertexCount; ++i) list.push_back(Float3(vertices[i * 3], vertices[i * 3 + 1], vertices[i * 3 + 2]));
  IndexedTriangleList triangles;
  triangles.reserve(triangleCount);
  for (uint32_t i = 0; i < triangleCount; ++i)
    triangles.push_back(IndexedTriangle(indices[i * 3], indices[i * 3 + 1], indices[i * 3 + 2], materials[i]));
  return save(MeshShapeSettings(list, triangles, materialList(materialCount)).Create(), out, bytes);
}

/// A height field of `sampleCount`² heights (row by row along z, `FLT_MAX` for a hole), placed by
/// `offset` and `scale` (3 floats each), every triangle of material 0.
uint32_t cook_height_field(const float *samples, uint32_t sampleCount, const float *offset, const float *scale,
                           const uint8_t **out, uint32_t *bytes) {
  start();
  HeightFieldShapeSettings settings(samples, Vec3(offset[0], offset[1], offset[2]), Vec3(scale[0], scale[1], scale[2]),
                                    sampleCount, nullptr, materialList(1));
  return save(settings.Create(), out, bytes);
}

}  // extern "C"
