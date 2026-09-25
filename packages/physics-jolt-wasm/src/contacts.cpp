// Contact events: the pairs a body touches, their enters and leaves in the event buffer, and the
// bodies Jolt puts to sleep. Jolt calls the listener from its jobs, on every pool thread at once.
#include "contacts.h"

using namespace JPH;

namespace trillion {

uint64_t pairKey(uint32_t a, uint32_t b) {
  return a < b ? (uint64_t(a) << 32) | b : (uint64_t(b) << 32) | a;
}

bool pushEvent(uint32_t type, uint32_t a, uint32_t b, float impulse, Vec3 point) {
  World &w = world();
  if (w.eventWords + EVENT_WORDS > w.capacity[2]) return false;
  uint32_t *e = w.buffers[2] + w.eventWords;
  float *f = reinterpret_cast<float *>(e);
  e[0] = type;
  e[1] = a;
  e[2] = b;
  f[3] = impulse;
  f[4] = point.GetX();
  f[5] = point.GetY();
  f[6] = point.GetZ();
  w.eventWords += EVENT_WORDS;
  return true;
}

void pushLeave(uint64_t key) {
  if (!pushEvent(2, uint32_t(key >> 32), uint32_t(key), 0.0f, Vec3::sZero()))
    world().leaving.push_back(key);
}

bool wantsEvents(uint32_t engine) {
  return (world().slots[engine & INDEX_MASK].flags & EVENTS) != 0;
}

uint32_t live(const BodyID &id) {
  uint32_t engine = world().engineOf[id.GetIndex()];
  const Slot &slot = world().slots[engine & INDEX_MASK];
  return slot.used && slot.id == id ? engine : ~0u;
}

void sendOwedLeaves() {
  std::vector<uint64_t> owed;
  owed.swap(world().leaving);
  for (uint64_t key : owed) pushLeave(key);
}

void leaveAll(uint32_t engine) {
  for (auto at = world().pairs.begin(); at != world().pairs.end();) {
    if (uint32_t(at->first >> 32) != engine && uint32_t(at->first) != engine) {
      ++at;
      continue;
    }
    if (at->second & ENTERED) pushLeave(at->first);
    world().softPairs.erase(at->first);
    at = world().pairs.erase(at);
  }
}

void Listener::OnContactAdded(const Body &a, const Body &b, const ContactManifold &manifold,
                              ContactSettings &) {
  uint32_t ia = uint32_t(a.GetUserData()), ib = uint32_t(b.GetUserData());
  if (!wantsEvents(ia) && !wantsEvents(ib)) return;
  std::lock_guard guard(lock);
  uint32_t &pair = world().pairs[pairKey(ia, ib)];
  if (pair++ != 0) return;
  Vec3 point = Vec3(manifold.GetWorldSpaceContactPointOn1(0));
  // Approach speed along the normal times the pair's reduced mass.
  Vec3 relative = a.GetPointVelocity(RVec3(point)) - b.GetPointVelocity(RVec3(point));
  float impulse = approachImpulse(relative.Dot(manifold.mWorldSpaceNormal), inverseMass(a) + inverseMass(b));
  // An enter the buffer cannot take is counted, and its leave is never sent.
  if (pushEvent(1, ia, ib, impulse, point)) pair |= ENTERED;
  else ++world().dropped;
}

void Listener::OnContactRemoved(const SubShapeIDPair &pair) {
  std::lock_guard guard(lock);
  // A removed body's pairs were closed when it left (`leaveAll`).
  uint32_t ia = live(pair.GetBody1ID()), ib = live(pair.GetBody2ID());
  if (ia == ~0u || ib == ~0u) return;
  auto found = world().pairs.find(pairKey(ia, ib));
  if (found == world().pairs.end() || (--found->second & ~ENTERED) != 0) return;
  if (found->second & ENTERED) pushLeave(found->first);
  world().pairs.erase(found);
}

void Listener::OnBodyDeactivated(const BodyID &, uint64 user) {
  std::lock_guard guard(lock);
  world().deactivated.push_back(uint32_t(user));
}

}  // namespace trillion
