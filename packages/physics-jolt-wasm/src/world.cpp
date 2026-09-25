// World creation, collision layers, and the exported entry points.
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

}  // namespace

World &world() { return instance; }

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
  if (w.system || maxBodies > trillion::INDEX_MASK) return 1;
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
  // One body more than the page's: the character's inner capsule (`character.cpp`).
  uint32_t bodies = maxBodies + 1;
  // A step that needs more scratch than `tempBytes` takes it from the heap, inside the memory budget.
  w.system->Init(bodies, 0, bodyPairs, contactConstraints, trillion::broadPhaseLayers,
                 trillion::objectVsBroadPhase, trillion::objectPairs);
  w.system->SetContactListener(&w.listener);
  w.system->SetBodyActivationListener(&w.listener);
  w.slots.resize(bodies);
  w.engineOf.assign(bodies, 0);
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
  trillion::sendOwedLeaves();
  if (!trillion::runCommands(w.buffers[0], commandWords)) return 0xFFFFFFFFu;
  // A body removed awake was put to sleep by its removal: not a body of this step.
  w.deactivated.clear();
  trillion::moveCharacter(dt);
  trillion::driveVehicles(dt);
  if (dt > 0) {
    trillion::notePaths();
    w.updateError = uint32_t(w.system->Update(dt, 1, w.temp, w.jobs));
    trillion::carryPaths();
  }
  trillion::breakJoints(dt);
  trillion::writeVehicles();
  trillion::writeCharacter();
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
/// Leaves still owed from a step whose event buffer was full: the next step writes them first.
uint32_t jolt_owed_leaves() { return uint32_t(world().leaving.size()); }
uint32_t jolt_active_count() { return world().system->GetNumActiveBodies(EBodyType::RigidBody); }

}  // extern "C"
