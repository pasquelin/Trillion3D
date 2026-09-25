// Cooked shapes restored from Jolt's binary state (`src/blob.h`), and the scene queries — rays and
// shape sweeps — that the page asks between steps, answered in one batched call (`jolt_cast`).
#include "binding.h"
#include "blob.h"
#include "restore.h"
#include "words.h"

#include <Jolt/Physics/Collision/CastResult.h>
#include <Jolt/Physics/Collision/CollisionCollectorImpl.h>
#include <Jolt/Physics/Collision/RayCast.h>
#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/ScaledShape.h>
#include <Jolt/Physics/Collision/Shape/SphereShape.h>
#include <Jolt/Physics/Collision/ShapeCast.h>

using namespace JPH;

namespace trillion {

namespace {

std::unordered_map<uint32_t, RefConst<Shape>> restored;
std::vector<uint32_t> queries, hits;

/// Words of one query (`kind, origin x, y, z, travel x, y, z, a, b, c, ignored`) and one hit
/// (`engine id, fraction, point x, y, z, normal x, y, z`); layout.ts CAST_WORDS / HIT_WORDS.
constexpr uint32_t CAST_WORDS = 11, HIT_WORDS = 8, MISS = 0xFFFFFFFFu;

/// Every body but the one whose engine id a query names: the body it passes through.
class IgnoredBody : public BodyFilter {
public:
  explicit IgnoredBody(uint32_t engine) : engine(engine) {}
  bool ShouldCollideLocked(const Body &body) const override { return uint32_t(body.GetUserData()) != engine; }

private:
  uint32_t engine;
};

void writeHit(uint32_t *out, const BodyID &id, float fraction, RVec3 point, Vec3 normal) {
  BodyLockRead lock(world().system->GetBodyLockInterfaceNoLock(), id);
  if (!lock.Succeeded()) return;
  const Body &body = lock.GetBody();
  out[0] = uint32_t(body.GetUserData());
  float values[7] = {fraction, float(point.GetX()), float(point.GetY()), float(point.GetZ()), normal.GetX(), normal.GetY(), normal.GetZ()};
  std::memcpy(out + 1, values, sizeof values);
}

void cast(const uint32_t *q, uint32_t *out) {
  const NarrowPhaseQuery &query = world().system->GetNarrowPhaseQuery();
  RVec3 origin(vec3(q + 1));
  Vec3 travel = vec3(q + 4);
  IgnoredBody ignored(q[10]);
  if (q[0] == 0) {
    RRayCast ray(origin, travel);
    RayCastResult hit;
    if (!query.CastRay(ray, hit, {}, {}, ignored)) return;
    BodyLockRead lock(world().system->GetBodyLockInterfaceNoLock(), hit.mBodyID);
    if (!lock.Succeeded()) return;
    RVec3 point = ray.GetPointOnRay(hit.mFraction);
    Vec3 normal = lock.GetBody().GetWorldSpaceSurfaceNormal(hit.mSubShapeID2, point);
    lock.ReleaseLock();
    return writeHit(out, hit.mBodyID, hit.mFraction, point, normal);
  }
  RefConst<Shape> shape = q[0] == 1 ? RefConst<Shape>(new SphereShape(f32(q + 7)))
                         : q[0] == 2 ? RefConst<Shape>(new BoxShape(vec3(q + 7)))
                                     : RefConst<Shape>(new CapsuleShape(f32(q + 7), f32(q + 8)));
  RShapeCast sweep(shape, Vec3::sOne(), RMat44::sTranslation(origin), travel);
  ShapeCastSettings settings;
  ClosestHitCollisionCollector<CastShapeCollector> closest;
  query.CastShape(sweep, settings, origin, closest, {}, {}, ignored);
  if (!closest.HadHit()) return;
  const ShapeCastResult &hit = closest.mHit;
  writeHit(out, hit.mBodyID2, hit.mFraction, origin + hit.mContactPointOn2, -hit.mPenetrationAxis.NormalizedOr(Vec3::sZero()));
}

}  // namespace

bool restoreShape(const uint32_t *w) {
  BlobIn blob(reinterpret_cast<const uint8_t *>(w + RESTORE_WORDS), w[2]);
  Shape::IDToShapeMap shapes;
  Shape::IDToMaterialMap materials;
  Shape::ShapeResult result = Shape::sRestoreWithChildren(blob, shapes, materials);
  if (result.HasError() || blob.IsFailed()) return (world().error = BAD_SHAPE, false);
  restored[w[1]] = result.Get();
  return true;
}

void releaseShape(const uint32_t *w) { restored.erase(w[1]); }

RefConst<Shape> cookedShape(uint32_t handle, Vec3 scale) {
  auto found = restored.find(handle);
  if (found == restored.end()) return nullptr;
  if (scale.IsClose(Vec3::sOne())) return found->second;
  return new ScaledShape(found->second, scale);
}

}  // namespace trillion

extern "C" {

/// Returns the query buffer grown to `count` queries; the hits are written after them.
uint32_t *jolt_cast_buffer(uint32_t count) {
  trillion::queries.resize(size_t(count) * trillion::CAST_WORDS);
  trillion::hits.resize(size_t(count) * trillion::HIT_WORDS);
  return trillion::queries.data();
}

/// Answers the `count` queries of the query buffer against the last step's bodies; returns the
/// hit records (`jolt_cast_buffer`'s layout), a missed query's engine id `0xFFFFFFFF`.
uint32_t *jolt_cast(uint32_t count) {
  for (uint32_t i = 0; i < count; ++i) {
    uint32_t *out = trillion::hits.data() + i * trillion::HIT_WORDS;
    out[0] = trillion::MISS;
    trillion::cast(trillion::queries.data() + i * trillion::CAST_WORDS, out);
  }
  return trillion::hits.data();
}

}  // extern "C"
