// Cooked shapes restored from Jolt's binary state (`src/blob.h`), and the scene queries — rays and
// shape sweeps — that the page asks between steps, answered in one batched call (`jolt_cast`).
#include "binding.h"
#include "blob.h"
#include "restore.h"
#include "words.h"

#include <Jolt/Physics/Collision/CastResult.h>
#include <Jolt/Physics/Collision/CollisionCollectorImpl.h>
#include <Jolt/Physics/Collision/RayCast.h>
#include <Jolt/Physics/Collision/Shape/ScaledShape.h>
#include <Jolt/Physics/Collision/ShapeCast.h>

using namespace JPH;

namespace trillion {

namespace {

std::unordered_map<uint32_t, RefConst<Shape>> restored;
std::vector<uint32_t> queries, hits;

/// Writes the hit on body `id`, its one lock reading the engine id and the normal (`normal(body)`).
template <class Normal> void writeHit(uint32_t *out, const BodyID &id, float fraction, RVec3 point, Normal normal) {
  BodyLockRead lock(world().system->GetBodyLockInterfaceNoLock(), id);
  if (!lock.Succeeded()) return;
  const Body &body = lock.GetBody();
  out[HIT_AT_BODY] = uint32_t(body.GetUserData());
  Vec3 n = normal(body);
  float values[7] = {fraction, float(point.GetX()), float(point.GetY()), float(point.GetZ()), n.GetX(), n.GetY(), n.GetZ()};
  std::memcpy(out + HIT_AT_FRACTION, values, sizeof values);
}

void cast(const uint32_t *q, uint32_t *out) {
  const NarrowPhaseQuery &query = world().system->GetNarrowPhaseQuery();
  RVec3 origin(vec3(q + CAST_AT_ORIGIN));
  Vec3 travel = vec3(q + CAST_AT_TRAVEL);
  IgnoredBody ignored(q[CAST_AT_IGNORED]);
  // A trace stops at what blocks its channel; what it overlaps is no wall to it. By object types
  // it stops at the bodies of those types instead, whatever they answer.
  const Query trace = q[CAST_AT_STOP] == CAST_STOP_OBJECT_TYPES ? objectQuery(q + CAST_AT_OBJECT_TYPES)
                                                              : traceQuery(q + CAST_AT_CHANNEL);
  const LayerMeets blocks(trace, Meeting::Block);
  const uint32_t kind = q[CAST_AT_KIND];
  if (kind == 0) {
    RRayCast ray(origin, travel);
    RayCastResult hit;
    if (!query.CastRay(ray, hit, {}, blocks, ignored)) return;
    RVec3 point = ray.GetPointOnRay(hit.mFraction);
    return writeHit(out, hit.mBodyID, hit.mFraction, point,
                    [&](const Body &body) { return body.GetWorldSpaceSurfaceNormal(hit.mSubShapeID2, point); });
  }
  // The swept shape is the body primitive of the same dimensions.
  RefConst<Shape> shape = queryPrimitive(kind, q + CAST_AT_EXTENTS);
  RShapeCast sweep(shape, Vec3::sOne(), RMat44::sTranslation(origin), travel);
  ShapeCastSettings settings;
  ClosestHitCollisionCollector<CastShapeCollector> closest;
  query.CastShape(sweep, settings, origin, closest, {}, blocks, ignored);
  if (!closest.HadHit()) return;
  const ShapeCastResult &hit = closest.mHit;
  writeHit(out, hit.mBodyID2, hit.mFraction, origin + hit.mContactPointOn2,
           [&](const Body &) { return -hit.mPenetrationAxis.NormalizedOr(Vec3::sZero()); });
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
    out[trillion::HIT_AT_BODY] = trillion::MISS;
    trillion::cast(trillion::queries.data() + i * trillion::CAST_WORDS, out);
  }
  return trillion::hits.data();
}

}  // extern "C"
