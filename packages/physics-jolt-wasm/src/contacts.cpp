// Contact events: the pairs a body touches, their enters and leaves in the event buffer, and the
// bodies Jolt puts to sleep. Jolt calls the listener from its jobs, on every pool thread at once:
// each call keeps a record in its own thread's list, so no call waits on another, and the step
// replays them all once `Update` is done in one order that depends on no thread (`canonical`): a
// pool of any size sends the single thread's events in the single thread's order.
#include "contacts.h"

#include <Jolt/Physics/Collision/EstimateCollisionResponse.h>

#include <atomic>
#include <memory>

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
  if (!pushEvent(EVENT_END, uint32_t(key >> 32), uint32_t(key), 0.0f, Vec3::sZero()))
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
  World &w = world();
  // Only the body's own pairs (PHY-15), a copy since leaving them unlists them, in key order so
  // that the leaves are written in the same order every run.
  static std::vector<uint64_t> keys;
  keys = w.pairs.of(engine & INDEX_MASK);
  std::sort(keys.begin(), keys.end());
  for (uint64_t key : keys) {
    auto at = w.pairs.find(key);
    if (at->second.count & ENTERED) pushLeave(key);
    w.pairs.erase(at);
  }
}

namespace {

/// Bodies that overlap by their filters (`filters.h`) pass through each other and report it: their
/// contact is a sensor's, no collision response.
void passThrough(const Body &a, const Body &b, ContactSettings &settings) {
  if (takenLayers(a.GetObjectLayer(), b.GetObjectLayer()) == Meeting::Overlap)
    settings.mIsSensor = true;
}

}  // namespace

void Listener::OnContactPersisted(const Body &a, const Body &b, const ContactManifold &,
                                  ContactSettings &settings) {
  passThrough(a, b, settings);
}

void Listener::OnContactAdded(const Body &a, const Body &b, const ContactManifold &manifold,
                              ContactSettings &settings) {
  passThrough(a, b, settings);
  uint32_t ia = uint32_t(a.GetUserData()), ib = uint32_t(b.GetUserData());
  if (!wantsEvents(ia) && !wantsEvents(ib)) return;
  Vec3 point = Vec3(manifold.GetWorldSpaceContactPointOn1(0));
  // Only a pair's first contact sends its impulse (`replayContacts`).
  // Estimated before the solver runs, at the pair's friction and restitution, bounced back past
  // the page's restitution speed, over the estimator's own iteration count.
  // A pair that passes through exerts none.
  float impulse = 0;
  if (!settings.mIsSensor) {
    CollisionEstimationResult estimate;
    EstimateCollisionResponse(a, b, manifold, estimate, settings.mCombinedFriction,
                              settings.mCombinedRestitution, world().restitutionSpeed);
    for (float lambda : estimate.mContactImpulse) impulse += lambda;
  }
  Float3 at;
  point.StoreFloat3(&at);
  deferContact({ContactRecord::ADDED, ia, ib, impulse, at, 0});
}

void Listener::OnContactRemoved(const SubShapeIDPair &pair) {
  // A removed body's pairs were closed when it left (`leaveAll`).
  uint32_t ia = live(pair.GetBody1ID()), ib = live(pair.GetBody2ID());
  if (ia == ~0u || ib == ~0u) return;
  deferContact({ContactRecord::REMOVED, ia, ib, 0.0f, Float3(0, 0, 0), 0});
}

namespace {

/// The records of every thread that ran a callback, each list its own thread's; kept, never freed.
Mutex threadsLock;
std::vector<std::unique_ptr<std::vector<ContactRecord>>> threadRecords;
std::atomic<uint64_t> nextOrder{0};

/// The engine's own order, not Jolt's callback order: pair by pair, in key order, each pair's
/// records in the order its callbacks ran. Jolt runs one pair's callbacks one after the other, in
/// the same order on any thread count, and computes the same records: so sorted, they give the
/// single thread's events in one order a pool of any size gives too.
bool canonical(const ContactRecord &x, const ContactRecord &y) {
  uint64_t kx = pairKey(x.a, x.b), ky = pairKey(y.a, y.b);
  return kx != ky ? kx < ky : x.order < y.order;
}

/// A rigid pair's contact added: its first one sends the enter.
void added(World &w, const ContactRecord &r) {
  uint32_t &pair = w.pairs[pairKey(r.a, r.b)];
  if (pair++ != 0) return;
  // An enter the buffer cannot take is counted, and its leave is never sent.
  if (pushEvent(EVENT_BEGIN, r.a, r.b, r.impulse, Vec3(r.point))) pair |= ENTERED;
  else ++w.dropped;
}

/// A rigid pair's contact removed: its last one sends the leave, once the enter was sent.
void removed(World &w, const ContactRecord &r) {
  auto found = w.pairs.find(pairKey(r.a, r.b));
  if (found == w.pairs.end() || (--found->second.count & ~ENTERED) != 0) return;
  if (found->second.count & ENTERED) pushLeave(found->first);
  w.pairs.erase(found);
}

/// A soft body's touch: stamped with the step; the pair's first sends the enter.
void soft(World &w, const ContactRecord &r) {
  uint32_t *pair = w.pairs.touchSoft(pairKey(r.a, r.b), w.step);
  if (!pair) return;
  *pair = 1;
  if (pushEvent(EVENT_BEGIN, r.a, r.b, r.impulse, Vec3(r.point))) *pair |= ENTERED;
  else ++w.dropped;
}

}  // namespace

void deferContact(ContactRecord record) {
  thread_local std::vector<ContactRecord> *mine = nullptr;
  if (!mine) {
    std::lock_guard guard(threadsLock);
    mine = threadRecords.emplace_back(std::make_unique<std::vector<ContactRecord>>()).get();
  }
  record.order = nextOrder.fetch_add(1, std::memory_order_relaxed);
  mine->push_back(record);
}

void replayContacts() {
  World &w = world();
  static std::vector<ContactRecord> all;
  all.clear();
  for (auto &records : threadRecords) {
    all.insert(all.end(), records->begin(), records->end());
    records->clear();
  }
  std::sort(all.begin(), all.end(), canonical);
  for (const ContactRecord &r : all) {
    if (r.kind == ContactRecord::ADDED) added(w, r);
    else if (r.kind == ContactRecord::REMOVED) removed(w, r);
    else soft(w, r);
  }
}

void Listener::OnBodyDeactivated(const BodyID &, uint64 user) {
  std::lock_guard guard(lock);
  world().deactivated.push_back(uint32_t(user));
}

}  // namespace trillion
