// Overlap queries: the bodies in a shape at a place, asked between steps (`jolt_overlap`) the way a
// trace is (`restore.cpp`). A shape meets a body as a body meets a body (`filters.h`): by channel,
// by what each answers to the other's channel, or by object type, the bodies of the types sought.
// Word layouts: `packages/sdk-core/src/physics/layout.ts` (OVERLAP, OVERLAP_HIT).
#include "binding.h"
#include "restore.h"
#include "words.h"

#include <Jolt/Physics/Collision/CollideShape.h>
#include <Jolt/Physics/Collision/CollisionCollectorImpl.h>

#include <algorithm>

using namespace JPH;

namespace trillion {

namespace {

uint32_t queryWords[OVERLAP_WORDS];
std::vector<uint32_t> found;

// Where the words of a query lie (layout.ts OVERLAP): the mode, the shape and its three sizes, the
// place and turn, the channel with its answers (the five words `traceQuery` reads), the object
// types sought and the body ignored.
constexpr uint32_t AT_MODE = 0, AT_SHAPE = 1, AT_SIZE = 2, AT_POSITION = 5, AT_ROTATION = 8, AT_CHANNEL = 12,
                   AT_OBJECTS = 17, AT_IGNORED = 19;

/// A body the shape met, its engine id and the sub-shape it met it by.
struct Met {
  uint32_t engine, flags, item;
  bool operator<(const Met &o) const { return engine != o.engine ? engine < o.engine : item < o.item; }
};

std::vector<Met> met;

}  // namespace

/// Answers the query in the buffer; returns the bodies met (`found`: engine id, flags, sub-shape
/// each). A shape refused, or a mode unknown, meets nothing.
uint32_t overlapQuery() {
  const uint32_t *q = queryWords;
  found.clear();
  const uint32_t mode = q[AT_MODE];
  if (mode > OVERLAP_ANY_BY_OBJECT) return 0;
  const uint32_t kind = q[AT_SHAPE];
  if (kind < 1 || kind > 3) return 0;
  RefConst<Shape> shape = primitive(kind == 1 ? SPHERE : kind == 2 ? BOX : CAPSULE, f32(q + AT_SIZE),
                                    f32(q + AT_SIZE + 1), f32(q + AT_SIZE + 2));
  if (!shape) return 0;
  Query query;
  if (mode >= OVERLAP_MULTI_BY_OBJECT) {
    query.byObject = true;
    query.objects = u64(q + AT_OBJECTS);
  } else {
    query = traceQuery(q + AT_CHANNEL);
  }
  const bool any = mode == OVERLAP_ANY || mode == OVERLAP_BLOCKING || mode == OVERLAP_ANY_BY_OBJECT;
  const LayerMeets layers(query, mode == OVERLAP_BLOCKING || query.byObject ? Meeting::Block : Meeting::Overlap);
  const RVec3 at(vec3(q + AT_POSITION));
  const RMat44 place = RMat44::sRotationTranslation(quat(q + AT_ROTATION), at);
  CollideShapeSettings settings;
  // A shape deep inside a mesh meets its back faces alone.
  settings.mBackFaceMode = EBackFaceMode::CollideWithBackFaces;
  const IgnoredBody ignored(q[AT_IGNORED]);
  const NarrowPhaseQuery &narrow = world().system->GetNarrowPhaseQuery();
  met.clear();
  const BodyLockInterfaceNoLock &locks = world().system->GetBodyLockInterfaceNoLock();
  auto note = [&](const CollideShapeResult &hit) {
    BodyLockRead lock(locks, hit.mBodyID2);
    if (!lock.Succeeded()) return;
    const Body &body = lock.GetBody();
    const Meeting meeting = queried(query, filterOf(body.GetObjectLayer()));
    met.push_back({uint32_t(body.GetUserData()), meeting == Meeting::Block ? uint32_t(OVERLAP_HIT_BLOCKING) : 0u,
                   hit.mSubShapeID2.GetValue()});
  };
  auto collide = [&](auto &collector) {
    narrow.CollideShape(shape, Vec3::sOne(), place, settings, at, collector, {}, layers, ignored);
  };
  if (any) {
    AnyHitCollisionCollector<CollideShapeCollector> collector;
    collide(collector);
    if (collector.HadHit()) note(collector.mHit);
  } else {
    AllHitCollisionCollector<CollideShapeCollector> collector;
    collide(collector);
    for (const CollideShapeResult &hit : collector.mHits) note(hit);
  }
  // One record a body, in one order whatever Jolt's: its first sub-shape, blocking if any blocks.
  std::sort(met.begin(), met.end());
  for (size_t i = 0; i < met.size();) {
    Met body = met[i];
    for (++i; i < met.size() && met[i].engine == body.engine; ++i) body.flags |= met[i].flags;
    found.insert(found.end(), {body.engine, body.flags, body.item});
  }
  return uint32_t(found.size() / OVERLAP_HIT_WORDS);
}

}  // namespace trillion

extern "C" {

/// The buffer a query is written in (layout.ts OVERLAP_WORDS).
uint32_t *jolt_overlap_buffer() { return trillion::queryWords; }
/// Answers the query in the buffer against the last step's bodies; returns the bodies met.
uint32_t jolt_overlap() { return trillion::overlapQuery(); }
/// The bodies the last query met: `engine id, flags, sub-shape` each (layout.ts OVERLAP_HIT_WORDS).
uint32_t *jolt_overlap_hits() { return trillion::found.data(); }

}  // extern "C"
