// Soft-body contacts: Jolt collides a soft body's vertices with rigid bodies and reports them through
// its SoftBodyContactListener, once per soft body and step, never through the rigid pairs' listener
// (`contacts.cpp`). The pairs share `World::pairs` and the event buffer with the rigid ones.
#include "contacts.h"

#include <Jolt/Physics/Body/BodyLock.h>
#include <Jolt/Physics/SoftBody/SoftBodyManifold.h>

#include <algorithm>
#include <cmath>

using namespace JPH;

namespace trillion {

namespace {

/// One body the soft body's vertices touched this step: the sums of their contact points and
/// normals, their count and their mass (infinite when one is pinned).
struct Touch {
  BodyID id;
  Vec3 point, normal;
  float count, mass;
};

float inverseMass(const Body &body) {
  return body.IsDynamic() ? body.GetMotionProperties()->GetInverseMass() : 0.0f;
}

}  // namespace

SoftBodyValidateResult Listener::OnSoftBodyContactValidate(const Body &soft, const Body &other,
                                                           SoftBodyContactSettings &settings) {
  uint32_t ia = uint32_t(soft.GetUserData()), ib = uint32_t(other.GetUserData());
  // A sensor meets a soft body for its events alone: none wanted, it is passed by.
  if (settings.mIsSensor)
    return wantsEvents(ia) || wantsEvents(ib) ? SoftBodyValidateResult::AcceptContact
                                              : SoftBodyValidateResult::RejectContact;
  // XPBD holds a rigid body no heavier than the free vertices it lands on; a heavier one pushes
  // between them, so it meets them as heavy as itself.
  float mass = world().slots[ia & INDEX_MASK].softMass, inverse = inverseMass(other);
  if (inverse > 0 && mass * inverse < 1) settings.mInvMassScale1 = mass * inverse;
  return SoftBodyValidateResult::AcceptContact;
}

void Listener::OnSoftBodyContactAdded(const Body &soft, const SoftBodyManifold &manifold) {
  uint32_t ia = uint32_t(soft.GetUserData());
  RMat44 com = soft.GetCenterOfMassTransform();
  // Called for every soft body that touched anything, each step: the list is kept, never reallocated.
  thread_local std::vector<Touch> touches;
  touches.clear();
  for (const SoftBodyVertex &v : manifold.GetVertices()) {
    if (!manifold.HasContact(v)) continue;
    BodyID id = manifold.GetContactBodyID(v);
    auto found = std::find_if(touches.begin(), touches.end(), [&](const Touch &t) { return t.id == id; });
    if (found == touches.end()) found = touches.insert(touches.end(), {id, Vec3::sZero(), Vec3::sZero(), 0, 0});
    found->point += manifold.GetLocalContactPoint(v);
    found->normal += manifold.GetContactNormal(v);
    found->count += 1;
    found->mass += v.mInvMass > 0 ? 1.0f / v.mInvMass : INFINITY;
  }
  // The vertices' mean point and normal, in the world.
  for (Touch &touch : touches) {
    touch.point = Vec3(com * (touch.point / touch.count));
    touch.normal = com.Multiply3x3(touch.normal).NormalizedOr(Vec3::sZero());
  }
  // A sensor reports presence alone: at the soft body's centre, with no impulse.
  for (uint32_t i = 0; i < manifold.GetNumSensorContacts(); ++i)
    touches.push_back({manifold.GetSensorContactBodyID(i), Vec3(com.GetTranslation()), Vec3::sZero(), 1, 0});
  const BodyLockInterfaceNoLock &locks = world().system->GetBodyLockInterfaceNoLock();
  std::lock_guard guard(lock);
  for (const Touch &touch : touches) {
    uint32_t ib = live(touch.id);
    if (ib == ~0u || (!wantsEvents(ia) && !wantsEvents(ib))) continue;
    uint64_t key = pairKey(ia, ib);
    world().softSeen.push_back(key);
    if (!world().softPairs.emplace(key, ia).second) continue;
    uint32_t &pair = world().pairs[key];
    pair = 1;
    // Estimated before the solver, as a rigid pair's: the soft body's mean velocity (its last
    // step's) against the other's at the point, which no soft body pushed yet, times the pair's
    // reduced mass.
    float impulse = 0;
    BodyLockRead other(locks, touch.id);
    if (other.Succeeded() && touch.mass > 0) {
      const Body &b = other.GetBody();
      Vec3 relative = soft.GetLinearVelocity() - b.GetPointVelocity(RVec3(touch.point));
      float inverse = 1.0f / touch.mass + inverseMass(b);
      if (inverse > 0) impulse = std::max(0.0f, relative.Dot(touch.normal)) / inverse;
    }
    if (pushEvent(1, ia, ib, impulse, touch.point)) pair |= ENTERED;
    else ++world().dropped;
  }
}

void leaveSoft() {
  World &w = world();
  if (w.softPairs.empty()) return;
  std::sort(w.softSeen.begin(), w.softSeen.end());
  BodyInterface &bodies = w.system->GetBodyInterfaceNoLock();
  for (auto at = w.softPairs.begin(); at != w.softPairs.end();) {
    auto pair = w.pairs.find(at->first);
    // Gone from `pairs`: a body of the pair left, and `leaveAll` sent its leave.
    if (pair == w.pairs.end()) {
      at = w.softPairs.erase(at);
      continue;
    }
    // A soft body asleep through the step keeps its pairs, as a rigid body keeps its own.
    const Slot &soft = w.slots[at->second & INDEX_MASK];
    bool stepped = bodies.IsActive(soft.id) ||
                   std::find(w.deactivated.begin(), w.deactivated.end(), at->second) != w.deactivated.end();
    if (!stepped || std::binary_search(w.softSeen.begin(), w.softSeen.end(), at->first)) {
      ++at;
      continue;
    }
    if (pair->second & ENTERED) pushLeave(pair->first);
    w.pairs.erase(pair);
    at = w.softPairs.erase(at);
  }
  w.softSeen.clear();
}

}  // namespace trillion
