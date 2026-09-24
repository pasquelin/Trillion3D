// The compiler's physics cook (`packages/asset-compiler-rust`, stage `physics-cook`): native Jolt,
// from the same pinned submodule as the web module, turns triangles into shapes and writes them
// with Jolt's own binary state (`src/blob.h`), so the physics worker restores them without
// building a tree, a hull or a mass. Every entry point returns 0 on success; its bytes stay valid
// until the calling thread's next call.
#include "../src/blob.h"

#include <Jolt/Core/Factory.h>
#include <Jolt/Physics/Collision/PhysicsMaterialSimple.h>
#include <Jolt/Physics/Collision/Shape/ConvexHullShape.h>
#include <Jolt/Physics/Collision/Shape/HeightFieldShape.h>
#include <Jolt/Physics/Collision/Shape/MeshShape.h>
#include <Jolt/Physics/Collision/Shape/StaticCompoundShape.h>
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

/// One convex hull per part (`counts[i]` points each, 3 floats per point, parts one after the
/// other), in one compound when there are several; `mass` gets the mass at `density` kg/m³, the
/// centre of mass (3 floats) and the inertia about it (9 floats, column-major).
uint32_t cook_hulls(const float *points, const uint32_t *counts, uint32_t parts, float density, float *mass,
                    const uint8_t **out, uint32_t *bytes) {
  start();
  StaticCompoundShapeSettings compound;
  Ref<ShapeSettings> single;
  for (uint32_t part = 0; part < parts; ++part) {
    Array<Vec3> hull;
    for (uint32_t i = 0; i < counts[part]; ++i, points += 3) hull.push_back(Vec3(points[0], points[1], points[2]));
    Ref<ConvexHullShapeSettings> settings = new ConvexHullShapeSettings(hull);
    settings->SetDensity(density);
    single = settings;
    compound.AddShape(Vec3::sZero(), Quat::sIdentity(), settings);
  }
  ShapeSettings::ShapeResult result = parts == 1 ? single->Create() : compound.Create();
  if (result.HasError()) return 1;
  MassProperties properties = result.Get()->GetMassProperties();
  Vec3 centre = result.Get()->GetCenterOfMass();
  mass[0] = properties.mMass;
  for (int a = 0; a < 3; ++a) mass[1 + a] = centre[a];
  for (int c = 0; c < 3; ++c)
    for (int r = 0; r < 3; ++r) mass[4 + c * 3 + r] = properties.mInertia(r, c);
  return save(result, out, bytes);
}

/// The planes of the convex hull of `count` points (4 floats each: normal, then constant; a point
/// inside has a negative signed distance to every one), at most `room`; returns their count, 0 on
/// failure. The decomposition measures a part's concavity with them.
uint32_t cook_hull_planes(const float *points, uint32_t count, float *planes, uint32_t room) {
  start();
  Array<Vec3> hull;
  for (uint32_t i = 0; i < count; ++i) hull.push_back(Vec3(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]));
  ConvexHullShapeSettings settings(hull, 0.0f);
  ShapeSettings::ShapeResult result = settings.Create();
  if (result.HasError()) return 0;
  const auto &shape = static_cast<const ConvexHullShape &>(*result.Get());
  const Array<Plane> &found = shape.GetPlanes();
  uint32_t n = std::min<uint32_t>(uint32_t(found.size()), room);
  Vec3 centre = shape.GetCenterOfMass();
  for (uint32_t i = 0; i < n; ++i) {
    // The shape's planes are about its centre of mass: moved back to the points' frame.
    Plane plane = found[i].Offset(found[i].GetNormal().Dot(centre));
    for (int a = 0; a < 3; ++a) planes[i * 4 + a] = plane.GetNormal()[a];
    planes[i * 4 + 3] = plane.GetConstant();
  }
  return n;
}

}  // extern "C"
