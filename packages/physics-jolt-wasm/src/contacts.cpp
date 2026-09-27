// Contact events: the pairs a body touches, their enters and leaves in the event buffer, and the
// bodies Jolt puts to sleep. Jolt calls the listener from its jobs, on every pool thread at once:
// each call keeps a record in its own thread's list, and the step replays them all once `Update`
// is done, in the order the calls ran, so no call waits on another.
#include "contacts.h"

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
  Vec3 point = Vec3(manifold.GetWorldSpaceContactPointOn1(0));
  // Approach speed along the normal times the pair's reduced mass; only a pair's first contact
  // sends it (`replayContacts`).
  Vec3 relative = a.GetPointVelocity(RVec3(point)) - b.GetPointVelocity(RVec3(point));
  float impulse = approachImpulse(relative.Dot(manifold.mWorldSpaceNormal), inverseMass(a) + inverseMass(b));
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

/// A rigid pair's contact added: its first one sends the enter.
void added(World &w, const ContactRecord &r) {
  uint32_t &pair = w.pairs[pairKey(r.a, r.b)];
  if (pair++ != 0) return;
  // An enter the buffer cannot take is counted, and its leave is never sent.
  if (pushEvent(1, r.a, r.b, r.impulse, Vec3(r.point))) pair |= ENTERED;
  else ++w.dropped;
}

/// A rigid pair's contact removed: its last one sends the leave, once the enter was sent.
void removed(World &w, const ContactRecord &r) {
  auto found = w.pairs.find(pairKey(r.a, r.b));
  if (found == w.pairs.end() || (--found->second & ~ENTERED) != 0) return;
  if (found->second & ENTERED) pushLeave(found->first);
  w.pairs.erase(found);
}

/// A soft body's touch: stamped with the step; the pair's first sends the enter.
void soft(World &w, const ContactRecord &r) {
  uint64_t key = pairKey(r.a, r.b);
  auto [at, fresh] = w.softPairs.try_emplace(key, w.step);
  if (!fresh) {
    at->second = w.step;
    return;
  }
  uint32_t &pair = w.pairs[key];
  pair = 1;
  if (pushEvent(1, r.a, r.b, r.impulse, Vec3(r.point))) pair |= ENTERED;
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
  std::sort(all.begin(), all.end(), [](const ContactRecord &x, const ContactRecord &y) { return x.order < y.order; });
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
