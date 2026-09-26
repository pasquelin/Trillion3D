// The compiler's physics cook (`packages/asset-compiler-rust`, stage `physics-cook`): native Jolt,
// from the same pinned submodule as the web module, turns triangles into shapes and writes them
// with Jolt's own binary state (`src/blob.h`), so the physics worker restores them without
// building a tree, a hull or a mass; a soft body's settings are built as the worker builds them
// (`src/softSettings.h`) and written the same way. Every entry point but `cook_hull_planes`, which
// returns a count, returns 0 on success, else 1 and Jolt's error text in place of the bytes; either
// stays valid until the calling thread's next call.
#include "../src/blob.h"
#include "../src/mesh.h"
#include "../src/softSettings.h"

#include <Jolt/Core/Factory.h>
#include <Jolt/Physics/Collision/Shape/ConvexHullShape.h>
#include <Jolt/Physics/Collision/Shape/HeightFieldShape.h>
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
  if (!result.HasError()) {
    MassProperties properties = result.Get()->GetMassProperties();
    Vec3 centre = result.Get()->GetCenterOfMass();
    mass[0] = properties.mMass;
    for (int a = 0; a < 3; ++a) mass[1 + a] = centre[a];
    for (int c = 0; c < 3; ++c)
      for (int r = 0; r < 3; ++r) mass[4 + c * 3 + r] = properties.mInertia(r, c);
  }
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
