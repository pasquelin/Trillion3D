// The shapes an ADD command builds: primitives (a cylinder may taper), shared by their
// dimensions, the hulls and triangle meshes its data carries, the cooked shapes it names
// (`restore.cpp`) and compounds of primitives (a hull-and-deck boat). Word layouts: `packages/sdk-core/src/physics/layout.ts`.
#include "binding.h"
#include "mesh.h"
#include "restore.h"
#include "words.h"

#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/ConvexHullShape.h>
#include <Jolt/Physics/Collision/Shape/CylinderShape.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>
#include <Jolt/Physics/Collision/Shape/StaticCompoundShape.h>
#include <Jolt/Physics/Collision/Shape/TaperedCylinderShape.h>

using namespace JPH;

namespace trillion {

namespace {

enum ShapeKind : uint32_t { BOX = 0, SPHERE, CAPSULE, CYLINDER, TRIANGLES, HULL, COOKED, COMPOUND };
/// Words of one compound part: `kind, a, b, c, px, py, pz, qx, qy, qz, qw` (layout.ts PART_WORDS).
constexpr uint32_t PART_WORDS = 11;

RefConst<Shape> primitive(uint32_t kind, float a, float b, float c) {
  uint64_t key = 0;
  uint32_t bits[3];
  std::memcpy(bits, (float[3]){a, b, c}, 12);
  for (uint32_t v : {kind, bits[0], bits[1], bits[2]}) key = key * 0x100000001B3ull ^ v;
  auto &cache = world().primitives;
  if (auto found = cache.find(key); found != cache.end()) return found->second;
  RefConst<Shape> shape;
  if (kind == BOX) {
    float smallest = std::min(a, std::min(b, c));
    shape = new BoxShape(Vec3(a, b, c), std::min(cDefaultConvexRadius, smallest * 0.5f));
  } else if (kind == SPHERE) shape = new SphereShape(a);
  else if (kind == CAPSULE) shape = new CapsuleShape(a, b);
  // A cylinder whose bottom radius `c` is given and differs from its top's `b` tapers.
  else if (c > 0 && c != b) {
    float convex = std::min(cDefaultConvexRadius, std::min(a, std::min(b, c)) * 0.5f);
    ShapeSettings::ShapeResult result = TaperedCylinderShapeSettings(a, b, c, convex).Create();
    if (result.HasError()) return nullptr;
    shape = result.Get();
  }
  else shape = new CylinderShape(a, b, std::min(cDefaultConvexRadius, std::min(a, b) * 0.5f));
  cache.emplace(key, shape);
  return shape;
}

RefConst<Shape> meshShape(uint32_t kind, const uint32_t *data, uint32_t vertices, uint32_t indices) {
  if (kind == HULL) {
    Array<Vec3> points;
    points.reserve(vertices);
    for (uint32_t i = 0; i < vertices; ++i) points.push_back(vec3(data + i * 3));
    ShapeSettings::ShapeResult result = ConvexHullShapeSettings(points).Create();
    return result.HasError() ? nullptr : result.Get();
  }
  VertexList list;
  list.reserve(vertices);
  for (uint32_t i = 0; i < vertices; ++i) list.push_back(Float3(f32(data + i * 3), f32(data + i * 3 + 1), f32(data + i * 3 + 2)));
  const uint32_t *index = data + vertices * 3;
  IndexedTriangleList triangles;
  triangles.reserve(indices / 3);
  for (uint32_t i = 0; i + 2 < indices; i += 3) triangles.push_back(IndexedTriangle(index[i], index[i + 1], index[i + 2]));
  ShapeSettings::ShapeResult result = trillion::wholeMesh(list, triangles);
  return result.HasError() ? nullptr : result.Get();
}

/** A compound of primitive parts, `words` words of them; null when a part is not a primitive. */
RefConst<Shape> compoundShape(const uint32_t *data, uint32_t words) {
  StaticCompoundShapeSettings settings;
  for (const uint32_t *part = data; part + PART_WORDS <= data + words; part += PART_WORDS) {
    RefConst<Shape> shape = part[0] > CYLINDER ? nullptr : primitive(part[0], f32(part + 1), f32(part + 2), f32(part + 3));
    if (!shape) return nullptr;
    settings.AddShape(vec3(part + 4), quat(part + 7), shape);
  }
  ShapeSettings::ShapeResult result = settings.Create();
  return result.HasError() ? nullptr : result.Get();
}

}  // namespace

RefConst<Shape> shapeOf(const uint32_t *w) {
  uint32_t motion = w[2], kind = w[4];
  // A mesh has no volume: only a body that never moves by force may be one (the page refuses it).
  if (kind <= CYLINDER) return primitive(kind, f32(w + 13), f32(w + 14), f32(w + 15));
  // A cooked shape: its handle is the one data word, `a, b, c` its scale.
  if (kind == COOKED) return w[24] == 1 ? cookedShape(w[ADD_WORDS], vec3(w + 13)) : nullptr;
  if (kind == TRIANGLES && motion == 2) return nullptr;
  // A compound's parts are its data words (indexCount counts them, vertexCount is 0).
  if (kind == COMPOUND) return compoundShape(w + ADD_WORDS, w[24]);
  return meshShape(kind, w + ADD_WORDS, w[23], w[24]);
}

}  // namespace trillion
