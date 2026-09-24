// The pose buffer, and the distance and view rules that decide what is simulated and what is sent.
// Distance decides what is simulated: a dynamic body beyond the view's range is deactivated, its
// velocities kept, and given them back when it returns. View decides only what is sent: a body out
// of the view cone, or hidden by the page, sends no pose, and its latest one is sent once it is seen
// again (it keeps falling meanwhile), or when it falls asleep. A decorative body is simulated only
// when in range and in view.
#include "binding.h"

#include <cmath>
#include <cstring>

using namespace JPH;

namespace trillion {

namespace {

constexpr uint32_t ASLEEP_BIT = 0x80000000u;

struct Placement {
  bool far, seen;
};

Placement place(const World &w, const Slot &slot, const Body &body) {
  const View &v = w.view;
  AABox bounds = body.GetWorldSpaceBounds();
  Vec3 to = Vec3(bounds.GetCenter()) - v.eye;
  float radius = bounds.GetExtent().Length(), distance = to.Length();
  bool far = v.range > 0 && distance - radius > v.range;
  bool inCone = v.halfCone <= 0 || distance <= radius ||
                std::acos(std::clamp(to.Dot(v.facing) / distance, -1.0f, 1.0f)) -
                        std::asin(std::min(1.0f, radius / distance)) <= v.halfCone;
  return {far, !far && inCone && !(slot.flags & HIDDEN)};
}

void put(uint32_t *record, uint32_t index, const Body &body) {
  RVec3 p = body.GetPosition();
  Quat q = body.GetRotation();
  Vec3 v = body.GetLinearVelocity(), w = body.GetAngularVelocity();
  float values[POSE_WORDS - 1] = {float(p.GetX()), float(p.GetY()), float(p.GetZ()), q.GetX(),
                                  q.GetY(),        q.GetZ(),        q.GetW(),        v.GetX(),
                                  v.GetY(),        v.GetZ(),        w.GetX(),        w.GetY(),
                                  w.GetZ()};
  record[0] = index;
  std::memcpy(record + 1, values, sizeof(values));
}

}  // namespace

uint32_t writePoses() {
  World &w = world();
  BodyInterface &bodies = w.system->GetBodyInterfaceNoLock();
  const BodyLockInterfaceNoLock &locks = w.system->GetBodyLockInterfaceNoLock();
  uint32_t count = 0;
  auto send = [&](uint32_t index, const Body &body, bool asleep) {
    if ((count + 1) * POSE_WORDS > w.capacity[1]) return;
    w.slots[index].withheld = false;
    put(w.buffers[1] + count++ * POSE_WORDS, index | (asleep ? ASLEEP_BIT : 0), body);
  };
  auto emit = [&](uint32_t index, const Body &body, bool asleep) {
    Slot &slot = w.slots[index];
    // Awake is not frozen, even when a contact woke a frozen body.
    if (!asleep) slot.frozen = false;
    Placement at = place(w, slot, body);
    bool decorative = body.GetObjectLayer() == DECORATIVE;
    bool frozen = false;
    if (!asleep && (at.far || (decorative && !at.seen))) {
      slot.frozen = frozen = true;
      slot.linear = body.GetLinearVelocity();
      slot.angular = body.GetAngularVelocity();
      bodies.DeactivateBody(slot.id);
    }
    // A body that fell asleep sends its last pose even out of view, once: the page's `asleep` and
    // pose are then true, and a decorative body can leave the simulation. A frozen one is not
    // asleep (it resumes with its velocities), and sends nothing while it is out of view.
    if (at.seen || asleep) send(index, body, asleep || frozen);
    else slot.withheld = true;
    if (frozen || (asleep && slot.withheld)) w.waiting.push_back(index);
  };
  // Waiting bodies first: a thawed one joins the active list below in this same step's order.
  std::vector<uint32_t> waiting;
  waiting.swap(w.waiting);
  for (uint32_t index : waiting) {
    Slot &slot = w.slots[index];
    if (!slot.used || !(slot.withheld || slot.frozen)) continue;
    BodyLockRead lock(locks, slot.id);
    if (!lock.Succeeded() || lock.GetBody().IsActive()) continue;
    const Body &body = lock.GetBody();
    Placement at = place(w, slot, body);
    bool decorative = body.GetObjectLayer() == DECORATIVE;
    if (slot.frozen && !at.far && (!decorative || at.seen)) {
      slot.frozen = false;
      bodies.ActivateBody(slot.id);
      bodies.SetLinearAndAngularVelocity(slot.id, slot.linear, slot.angular);
      continue;
    }
    if (slot.withheld && at.seen) send(index, body, true);
    if (slot.withheld || slot.frozen) w.waiting.push_back(index);
  }
  uint32_t active = w.system->GetNumActiveBodies(EBodyType::RigidBody);
  const BodyID *ids = w.system->GetActiveBodiesUnsafe(EBodyType::RigidBody);
  static std::vector<BodyID> awake;
  awake.assign(ids, ids + active);
  for (const BodyID &id : awake) {
    BodyLockRead lock(locks, id);
    if (lock.Succeeded() && lock.GetBody().IsDynamic())
      emit(uint32_t(lock.GetBody().GetUserData()), lock.GetBody(), false);
  }
  for (uint32_t index : w.deactivated) {
    if (!w.slots[index].used || w.slots[index].frozen) continue;
    BodyLockRead lock(locks, w.slots[index].id);
    if (lock.Succeeded() && lock.GetBody().IsDynamic()) emit(index, lock.GetBody(), true);
  }
  return count;
}

}  // namespace trillion
