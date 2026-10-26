// Soft-body contacts: Jolt collides a soft body's vertices with rigid bodies and reports them through
// its SoftBodyContactListener, once per soft body and step, never through the rigid pairs' listener
// (`contacts.cpp`). The pairs share `World::pairs` and the event buffer with the rigid ones.
#include "contacts.h"

#include <Jolt/Physics/Body/BodyLock.h>
#include <Jolt/Physics/SoftBody/SoftBodyManifold.h>
#include <Jolt/Physics/SoftBody/SoftBodyMotionProperties.h>

#include <cmath>

using namespace JPH;

namespace trillion {

namespace {

/// One body the soft body's vertices touched this step, and the engine id it has: the sums of
/// their contact points and normals, their count and their mass (infinite when one is pinned).
struct Touch {
  BodyID id;
  uint32_t engine;
  Vec3 point, normal;
  float count, mass;
};

}  // namespace

SoftBodyValidateResult Listener::OnSoftBodyContactValidate(const Body &soft, const Body &other,
                                                           SoftBodyContactSettings &settings) {
  // Bodies that overlap by their filters pass through each other: a sensor's contact.
  if (takenLayers(soft.GetObjectLayer(), other.GetObjectLayer()) == Meeting::Overlap)
    settings.mIsSensor = true;
  // A sensor meets a soft body for its events alone: none wanted, it is passed by, as with no
  // listener. The static body its pins hang inside is passed through: it would push the cloth
  // near them out against them at every step (`hangsOn`). Any other body collides as Jolt makes it.
  if (settings.mIsSensor) {
    bool heard = wantsEvents(uint32_t(soft.GetUserData())) || wantsEvents(uint32_t(other.GetUserData()));
    return heard ? SoftBodyValidateResult::AcceptContact : SoftBodyValidateResult::RejectContact;
  }
  return hangsOn(soft, other) ? SoftBodyValidateResult::RejectContact : SoftBodyValidateResult::AcceptContact;
}

void Listener::OnSoftBodyContactAdded(const Body &soft, const SoftBodyManifold &manifold) {
  uint32_t ia = uint32_t(soft.GetUserData());
  bool wanted = wantsEvents(ia);
  // Called for every soft body that touched anything, each step: the list is kept, never reallocated.
  thread_local std::vector<Touch> touches;
  touches.clear();
  // The bodies no side of the pair listens to are left out at once.
  auto touch = [&](const BodyID &id) -> Touch * {
    auto found = std::find_if(touches.begin(), touches.end(), [&](const Touch &t) { return t.id == id; });
    if (found != touches.end()) return &*found;
    uint32_t engine = live(id);
    bool kept = engine != ~0u && (wanted || wantsEvents(engine));
    return &touches.emplace_back(Touch{id, kept ? engine : ~0u, Vec3::sZero(), Vec3::sZero(), 0, 0});
  };
  for (const SoftBodyVertex &v : manifold.GetVertices()) {
    if (!manifold.HasContact(v)) continue;
    Touch *t = touch(manifold.GetContactBodyID(v));
    if (t->engine == ~0u) continue;
    t->point += manifold.GetLocalContactPoint(v);
    t->normal += manifold.GetContactNormal(v);
    t->count += 1;
    t->mass += v.mInvMass > 0 ? 1.0f / v.mInvMass : INFINITY;
  }
  // A sensor reports presence alone: at the soft body's centre, with no impulse.
  for (uint32_t i = 0; i < manifold.GetNumSensorContacts(); ++i) touch(manifold.GetSensorContactBodyID(i));
  if (std::none_of(touches.begin(), touches.end(), [](const Touch &t) { return t.engine != ~0u; })) return;
  RMat44 com = soft.GetCenterOfMassTransform();
  const BodyLockInterfaceNoLock &locks = world().system->GetBodyLockInterfaceNoLock();
  for (const Touch &t : touches) {
    if (t.engine == ~0u) continue;
    // The pairs are only read during the step: a touch the soft pairs already hold is stamped
    // again when the records are replayed (`replayContacts`), a new one sends its enter then.
    if (world().pairs.isSoft(pairKey(ia, t.engine))) {
      deferContact({ContactRecord::SOFT, ia, t.engine, 0.0f, Float3(0, 0, 0), 0});
      continue;
    }
    Vec3 point = t.count > 0 ? Vec3(com * (t.point / t.count)) : Vec3(com.GetTranslation());
    // Estimated before the solver, as a rigid pair's: the soft body's mean velocity (its last
    // step's) against the other's at the point, which no soft body pushed yet, along the vertices'
    // mean normal, over the inverse mass the touch feels there: the vertices' as one lump, the
    // other body's turned about its centre of mass (a vertex against a body), bounced back past
    // the page's restitution speed. The soft solver keeps its own bounce speed: this estimate is
    // the page's, not what the solver applies.
    float impulse = 0;
    BodyLockRead other(locks, t.id);
    if (other.Succeeded() && t.count > 0) {
      const Body &b = other.GetBody();
      Vec3 normal = com.Multiply3x3(t.normal).NormalizedOr(Vec3::sZero());
      Vec3 relative = soft.GetLinearVelocity() - b.GetPointVelocity(RVec3(point));
      Vec3 arm = Vec3(RVec3(point) - b.GetCenterOfMassPosition()).Cross(normal);
      // One point: the impulse that stops the (bounced) approach is `max(0, v) / k`.
      float k = 1.0f / t.mass + inverseMassAlong(b, arm);
      float restitution = world().system->GetCombineRestitution()(soft, SubShapeID(), b, SubShapeID());
      impulse = std::max(0.0f, bounced(relative.Dot(normal), restitution, world().restitutionSpeed)) / k;
    }
    Float3 at;
    point.StoreFloat3(&at);
    deferContact({ContactRecord::SOFT, ia, t.engine, impulse, at, 0});
  }
}

void leaveSoft() {
  World &w = world();
  BodyInterface &bodies = w.system->GetBodyInterfaceNoLock();
  auto stepped = [&](uint32_t engine) {
    return bodies.IsActive(w.slots[engine & INDEX_MASK].id) ||
           std::find(w.deactivated.begin(), w.deactivated.end(), engine) != w.deactivated.end();
  };
  // A pair ended here, or in `leaveAll` when a body of it leaves, is unlisted: the last soft pair
  // moves into its place.
  const std::vector<uint64_t> &soft = w.pairs.softPairs();
  for (size_t i = 0; i < soft.size();) {
    uint64_t key = soft[i];
    auto pair = w.pairs.find(key);
    // Touched this step, or both asleep through it: kept, as a rigid pair keeps its own. A body
    // that moved while the soft body slept left it: overlapping it, it would have woken it.
    if (pair->second.touched == w.step || !(stepped(uint32_t(key)) || stepped(uint32_t(key >> 32)))) {
      ++i;
      continue;
    }
    if (pair->second.count & ENTERED) pushLeave(key);
    w.pairs.erase(pair);
  }
}

}  // namespace trillion
