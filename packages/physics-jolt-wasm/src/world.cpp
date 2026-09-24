// World creation, collision layers, contact and sleep listeners, and the exported entry points.
#include "binding.h"

#include <Jolt/Core/Factory.h>
#include <Jolt/Core/JobSystemSingleThreaded.h>
#include <Jolt/Core/JobSystemThreadPool.h>
#include <Jolt/Physics/Collision/BroadPhase/BroadPhaseLayer.h>
#include <Jolt/RegisterTypes.h>

#include <cstdlib>

using namespace JPH;

namespace trillion {

namespace {

constexpr BroadPhaseLayer BP_STATIC(0), BP_MOVING(1);

class BroadPhaseLayers final : public BroadPhaseLayerInterface {
public:
  uint GetNumBroadPhaseLayers() const override { return 2; }
  BroadPhaseLayer GetBroadPhaseLayer(ObjectLayer layer) const override {
    return layer == STATIC ? BP_STATIC : BP_MOVING;
  }
#if defined(JPH_EXTERNAL_PROFILE) || defined(JPH_PROFILE_ENABLED)
  // Named for the profiler of the bench builds (`bench/profile.cpp`).
  const char *GetBroadPhaseLayerName(BroadPhaseLayer layer) const override {
    return layer == BP_STATIC ? "static" : "moving";
  }
#endif
};

class ObjectVsBroadPhase final : public ObjectVsBroadPhaseLayerFilter {
public:
  bool ShouldCollide(ObjectLayer layer, BroadPhaseLayer bp) const override {
    return layer != STATIC || bp == BP_MOVING;
  }
};

class ObjectPairs final : public ObjectLayerPairFilter {
public:
  bool ShouldCollide(ObjectLayer a, ObjectLayer b) const override {
    if (a == STATIC) return b != STATIC;
    if (a == DECORATIVE) return b == STATIC;
    return b != DECORATIVE;
  }
};

BroadPhaseLayers broadPhaseLayers;
ObjectVsBroadPhase objectVsBroadPhase;
ObjectPairs objectPairs;
World instance;

uint64_t pairKey(uint32_t a, uint32_t b) {
  return a < b ? (uint64_t(a) << 32) | b : (uint64_t(b) << 32) | a;
}

/// Set on a pair's count once its enter reached the event buffer: only then is a leave owed.
constexpr uint32_t ENTERED = 0x80000000u;

bool pushEvent(uint32_t type, uint32_t a, uint32_t b, float impulse, Vec3 point) {
  World &w = instance;
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

/// A leave the buffer cannot take waits for the next step: an enter the page saw always ends.
void pushLeave(uint64_t key) {
  if (!pushEvent(2, uint32_t(key >> 32), uint32_t(key), 0.0f, Vec3::sZero()))
    instance.leaving.push_back(key);
}

bool wantsEvents(uint32_t engine) {
  return (instance.slots[engine & INDEX_MASK].flags & EVENTS) != 0;
}

/// The engine id of a body a contact names, or `~0u` when that body was removed since.
uint32_t live(const BodyID &id) {
  uint32_t engine = instance.engineOf[id.GetIndex()];
  const Slot &slot = instance.slots[engine & INDEX_MASK];
  return slot.used && slot.id == id ? engine : ~0u;
}

}  // namespace

World &world() { return instance; }

void leaveAll(uint32_t engine) {
  for (auto at = instance.pairs.begin(); at != instance.pairs.end();) {
    if (uint32_t(at->first >> 32) != engine && uint32_t(at->first) != engine) {
      ++at;
      continue;
    }
    if (at->second & ENTERED) pushLeave(at->first);
    at = instance.pairs.erase(at);
  }
}

void Listener::OnContactAdded(const Body &a, const Body &b, const ContactManifold &manifold,
                              ContactSettings &) {
  uint32_t ia = uint32_t(a.GetUserData()), ib = uint32_t(b.GetUserData());
  if (!wantsEvents(ia) && !wantsEvents(ib)) return;
  std::lock_guard guard(lock);
  uint32_t &pair = instance.pairs[pairKey(ia, ib)];
  if (pair++ != 0) return;
  Vec3 point = Vec3(manifold.GetWorldSpaceContactPointOn1(0));
  // Approach speed along the normal times the pair's reduced mass: the impulse needed to stop the
  // approach, an estimate made before the solver runs.
  Vec3 relative = a.GetPointVelocity(RVec3(point)) - b.GetPointVelocity(RVec3(point));
  float approach = std::max(0.0f, relative.Dot(manifold.mWorldSpaceNormal));
  float inverse = (a.IsDynamic() ? a.GetMotionProperties()->GetInverseMass() : 0.0f) +
                  (b.IsDynamic() ? b.GetMotionProperties()->GetInverseMass() : 0.0f);
  // An enter the buffer cannot take is counted, and its leave is never sent.
  if (pushEvent(1, ia, ib, inverse > 0 ? approach / inverse : 0.0f, point)) pair |= ENTERED;
  else ++instance.dropped;
}

void Listener::OnContactRemoved(const SubShapeIDPair &pair) {
  std::lock_guard guard(lock);
  // A removed body's pairs were closed when it left (`leaveAll`).
  uint32_t ia = live(pair.GetBody1ID()), ib = live(pair.GetBody2ID());
  if (ia == ~0u || ib == ~0u) return;
  auto found = instance.pairs.find(pairKey(ia, ib));
  if (found == instance.pairs.end() || (--found->second & ~ENTERED) != 0) return;
  if (found->second & ENTERED) pushLeave(found->first);
  instance.pairs.erase(found);
}

void Listener::OnBodyDeactivated(const BodyID &, uint64 user) {
  std::lock_guard guard(lock);
  instance.deactivated.push_back(uint32_t(user));
}

}  // namespace trillion

using trillion::world;

extern "C" {

/// Creates the physics system for at most `maxBodies` bodies, `bodyPairs` broad phase pairs and
/// `contactConstraints` contacts per step (the budget's), stepped by `threads` threads (the
/// caller's included; 1 steps on the caller alone). Returns 0, or 1 when called twice or past the
/// bodies an engine id can name.
uint32_t jolt_init(uint32_t maxBodies, uint32_t bodyPairs, uint32_t contactConstraints,
                   uint32_t tempBytes, uint32_t threads) {
  trillion::World &w = world();
  if (w.system || maxBodies > trillion::INDEX_MASK + 1) return 1;
  RegisterDefaultAllocator();
  Factory::sInstance = new Factory();
  RegisterTypes();
  w.temp = new TempAllocatorImplWithMallocFallback(tempBytes);
  // Jolt's own pool: its threads are started through `pthread_create`, which the loader answers
  // with one worker per thread on the module's shared memory (`joltModule.ts`).
  if (threads > 1)
    w.jobs = new JobSystemThreadPool(cMaxPhysicsJobs, cMaxPhysicsBarriers, int(threads - 1));
  else
    w.jobs = new JobSystemSingleThreaded(cMaxPhysicsJobs);
  w.system = new PhysicsSystem();
  // A step that needs more scratch than `tempBytes` takes it from the heap, inside the memory budget.
  w.system->Init(maxBodies, 0, bodyPairs, contactConstraints, trillion::broadPhaseLayers,
                 trillion::objectVsBroadPhase, trillion::objectPairs);
  w.system->SetContactListener(&w.listener);
  w.system->SetBodyActivationListener(&w.listener);
  w.slots.resize(maxBodies);
  w.engineOf.assign(maxBodies, 0);
  return 0;
}

/// Returns buffer `which` (0 commands, 1 poses, 2 events) grown to at least `words` words.
uint32_t *jolt_buffer(uint32_t which, uint32_t words) {
  trillion::World &w = world();
  if (w.capacity[which] < words) {
    std::free(w.buffers[which]);
    w.buffers[which] = static_cast<uint32_t *>(std::malloc(size_t(words) * 4));
    w.capacity[which] = w.buffers[which] ? words : 0;
  }
  return w.buffers[which];
}

/// Runs `commandWords` words of commands, then advances by `dt` seconds in one collision step (none
/// when `dt` is 0). Returns the pose count, or 0xFFFFFFFF on failure (`jolt_error`).
uint32_t jolt_step(uint32_t commandWords, float dt) {
  trillion::World &w = world();
  w.eventWords = w.dropped = w.updateError = 0;
  w.refused.clear();
  w.dt = dt;
  ++w.step;
  std::vector<uint64_t> owed;
  owed.swap(w.leaving);
  for (uint64_t key : owed) trillion::pushLeave(key);
  if (!trillion::runCommands(w.buffers[0], commandWords)) return 0xFFFFFFFFu;
  // A body removed awake was put to sleep by its removal: not a body of this step.
  w.deactivated.clear();
  if (dt > 0) w.updateError = uint32_t(w.system->Update(dt, 1, w.temp, w.jobs));
  return trillion::writePoses();
}

uint32_t jolt_event_count() { return world().eventWords / trillion::EVENT_WORDS; }
/// Enters the last step's event buffer could not hold (their leaves are never sent).
uint32_t jolt_dropped_events() { return world().dropped; }
/// What the last step's collision could not hold (`EPhysicsUpdateError` bits: 1 manifold cache,
/// 2 body pairs, 4 contact constraints): contacts were missed, the budget is too small.
uint32_t jolt_update_error() { return world().updateError; }
/// The last step's bodies whose shape was refused: their count, then each engine id.
uint32_t jolt_refused_count() { return uint32_t(world().refused.size()); }
uint32_t jolt_refused(uint32_t i) { return world().refused[i]; }
uint32_t jolt_error() { return world().error; }
uint32_t jolt_active_count() { return world().system->GetNumActiveBodies(EBodyType::RigidBody); }

}  // extern "C"
