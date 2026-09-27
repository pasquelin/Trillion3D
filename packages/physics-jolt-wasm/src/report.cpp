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
/** The bodies `place` has measured since the module started: a diagnostic, read by the tests only
 *  (`jolt_place_visits`), so its cost is counted, never timed. */
uint32_t placeVisits = 0;

struct Placement {
  bool far, seen;
  /** How far the eye may travel before a far body could be in range: a lower bound (the float
   *  rounding of its distance taken off), negative when not far. */
  double slack;
};

/// Whether a body `radius` around a centre `to` from the eye (`distance` away) reaches into the
/// view cone: `acos(cos angle) - asin(radius / distance) <= halfCone`. Decided without inverse
/// trigonometry, `cos angle >= cos(halfCone + asin(r / d))`, away from the cone's edge; within
/// `EDGE` of it (in cosine, hence at least as much in angle), by the exact formula, so that every
/// answer is the one the exact formula gives.
bool inCone(const View &v, Vec3 to, float radius, float distance) {
  constexpr float EDGE = 1e-4f;
  float c = std::clamp(to.Dot(v.facing) / distance, -1.0f, 1.0f);
  float s = std::min(1.0f, radius / distance);
  // Below a right angle, halfCone + asin(s) stays within [0, pi], where the cosine decreases.
  if (v.halfCone < 0.5f * JPH_PI) {
    float margin = c - (v.cosHalf * std::sqrt(std::max(0.0f, 1.0f - s * s)) - v.sinHalf * s);
    if (margin > EDGE) return true;
    if (margin < -EDGE) return false;
  }
  return std::acos(c) - std::asin(s) <= v.halfCone;
}

Placement place(const World &w, const Slot &slot, const Body &body) {
  ++placeVisits;
  const View &v = w.view;
  AABox bounds = body.GetWorldSpaceBounds();
  Vec3 to = Vec3(bounds.GetCenter()) - v.eye;
  float radius = bounds.GetExtent().Length(), distance = to.Length();
  // A body gone non-finite is placed nowhere: seen, so its pose is checked and it leaves (`put`).
  if (!std::isfinite(distance - radius)) return {false, true};
  bool far = v.range > 0 && distance - radius > v.range;
  // The cone is measured only when it decides something: not for a body far or hidden.
  bool seen = !far && !(slot.flags & HIDDEN) &&
              (v.halfCone <= 0 || distance <= radius || inCone(v, to, radius, distance));
  double slack = double(distance - radius - v.range) - 1e-3 - 1e-5 * double(distance + radius + v.range);
  return {far, seen, far ? slack : -1.0};
}

/// Notes how far the eye may travel before the frozen body of `slot` must be measured again.
void noteFar(const World &w, Slot &slot, const Placement &at) {
  // A body not far has a negative slack (`place`): measured again at once.
  slot.farUntil = at.slack > 0 ? w.travel + at.slack : -1;
  slot.farEpoch = w.viewEpoch;
}

/// Writes the body's pose record; false, writing nothing, when a value is not finite.
bool put(uint32_t *record, uint32_t engine, const Body &body) {
  RVec3 p = body.GetPosition();
  Quat q = body.GetRotation();
  Vec3 v = body.GetLinearVelocity(), w = body.GetAngularVelocity();
  float values[POSE_WORDS - 1] = {float(p.GetX()), float(p.GetY()), float(p.GetZ()), q.GetX(),
                                  q.GetY(),        q.GetZ(),        q.GetW(),        v.GetX(),
                                  v.GetY(),        v.GetZ(),        w.GetX(),        w.GetY(),
                                  w.GetZ()};
  for (float value : values)
    if (!std::isfinite(value)) return false;
  record[0] = engine;
  std::memcpy(record + 1, values, sizeof(values));
  return true;
}

}  // namespace

void setView(View next) {
  World &w = world();
  next.cosHalf = std::cos(next.halfCone);
  next.sinHalf = std::sin(next.halfCone);
  // A non-finite eye, or a way back from one, is a new view: every margin is dropped, and the
  // travel stays finite, so margins taken after it hold again.
  double moved = double((next.eye - w.view.eye).Length());
  if (std::isfinite(moved)) w.travel += moved;
  if (!std::isfinite(moved) || next.range != w.view.range) ++w.viewEpoch;
  w.view = next;
}

uint32_t writePoses() {
  World &w = world();
  BodyInterface &bodies = w.system->GetBodyInterfaceNoLock();
  const BodyLockInterfaceNoLock &locks = w.system->GetBodyLockInterfaceNoLock();
  uint32_t count = 0;
  // One record per body and step, so the buffer (a record per body) always holds the step's.
  auto send = [&](Slot &slot, const Body &body, bool asleep) {
    slot.withheld = false;
    if (slot.sent == w.step) return;
    slot.sent = w.step;
    // A diverged body sends no pose: it leaves the simulation after the step (`jolt_step`).
    if (put(w.buffers[1] + count * POSE_WORDS, slot.engine | (asleep ? ASLEEP_BIT : 0), body)) ++count;
    else w.diverged.push_back(slot.engine);
  };
  auto wait = [&](Slot &slot, uint32_t index) {
    if (slot.waiting) return;
    slot.waiting = true;
    w.waiting.push_back(index);
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
      noteFar(w, slot, at);
      slot.linear = body.GetLinearVelocity();
      slot.angular = body.GetAngularVelocity();
      bodies.DeactivateBody(slot.id);
    }
    // A body that fell asleep sends its last pose even out of view, once: the page's `asleep` and
    // pose are then true, and a decorative body can leave the simulation. A frozen one is not
    // asleep (it resumes with its velocities), and sends nothing while it is out of view.
    if (at.seen || asleep) send(slot, body, asleep);
    else slot.withheld = true;
    if (frozen || (asleep && slot.withheld)) wait(slot, index);
  };
  // Waiting bodies first: a thawed one joins the active list below in this same step's order.
  static std::vector<uint32_t> waiting;
  waiting.clear();
  waiting.swap(w.waiting);
  for (uint32_t index : waiting) {
    Slot &slot = w.slots[index];
    // Listed twice (removed, then added again while listed): examined once.
    if (!slot.waiting) continue;
    slot.waiting = false;
    if (!slot.used || !(slot.withheld || slot.frozen)) continue;
    BodyLockRead lock(locks, slot.id);
    if (!lock.Succeeded() || lock.GetBody().IsActive()) continue;
    // Frozen beyond the range, and the eye has not travelled its margin since: still beyond it,
    // so still frozen, unseen and waiting — what measuring it again would conclude.
    if (slot.frozen && slot.farEpoch == w.viewEpoch && w.travel < slot.farUntil) {
      wait(slot, index);
      continue;
    }
    const Body &body = lock.GetBody();
    Placement at = place(w, slot, body);
    bool decorative = body.GetObjectLayer() == DECORATIVE;
    if (slot.frozen) noteFar(w, slot, at);
    if (slot.frozen && !at.far && (!decorative || at.seen)) {
      slot.frozen = false;
      bodies.ActivateBody(slot.id);
      bodies.SetLinearAndAngularVelocity(slot.id, slot.linear, slot.angular);
      continue;
    }
    if (slot.withheld && at.seen) send(slot, body, true);
    if (slot.withheld || slot.frozen) wait(slot, index);
  }
  uint32_t active = w.system->GetNumActiveBodies(EBodyType::RigidBody);
  const BodyID *ids = w.system->GetActiveBodiesUnsafe(EBodyType::RigidBody);
  static std::vector<BodyID> awake;
  awake.assign(ids, ids + active);
  for (const BodyID &id : awake) {
    BodyLockRead lock(locks, id);
    if (lock.Succeeded() && lock.GetBody().IsDynamic())
      emit(uint32_t(lock.GetBody().GetUserData()) & INDEX_MASK, lock.GetBody(), false);
  }
  for (uint32_t engine : w.deactivated) {
    Slot &slot = w.slots[engine & INDEX_MASK];
    if (!slot.used || slot.engine != engine || slot.frozen) continue;
    BodyLockRead lock(locks, slot.id);
    if (lock.Succeeded() && lock.GetBody().IsDynamic() && lock.GetBody().IsRigidBody())
      emit(engine & INDEX_MASK, lock.GetBody(), true);
  }
  return count;
}

}  // namespace trillion

/// The bodies placed against the view since the module started: the tests' measure of its cost.
extern "C" uint32_t jolt_place_visits() { return trillion::placeVisits; }
