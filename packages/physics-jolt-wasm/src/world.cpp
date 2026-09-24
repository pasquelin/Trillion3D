// World creation, collision layers, contact and sleep listeners, and the exported entry points.
#include "binding.h"

#include <Jolt/Core/Factory.h>
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

void pushEvent(uint32_t type, uint32_t a, uint32_t b, float impulse, Vec3 point) {
  World &w = instance;
  if (w.eventWords + EVENT_WORDS > w.capacity[2]) return;
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
}

bool wantsEvents(uint32_t index) {
  return index < instance.slots.size() && (instance.slots[index].flags & EVENTS) != 0;
}

}  // namespace

World &world() { return instance; }

void Listener::OnContactAdded(const Body &a, const Body &b, const ContactManifold &manifold,
                              ContactSettings &) {
  uint32_t ia = uint32_t(a.GetUserData()), ib = uint32_t(b.GetUserData());
  if (!wantsEvents(ia) && !wantsEvents(ib)) return;
  if (instance.pairs[pairKey(ia, ib)]++ != 0) return;
  Vec3 point = Vec3(manifold.GetWorldSpaceContactPointOn1(0));
  // Approach speed along the normal times the pair's reduced mass: the impulse needed to stop the
  // approach, an estimate made before the solver runs.
  Vec3 relative = a.GetPointVelocity(RVec3(point)) - b.GetPointVelocity(RVec3(point));
  float approach = std::max(0.0f, relative.Dot(manifold.mWorldSpaceNormal));
  float inverse = (a.IsDynamic() ? a.GetMotionProperties()->GetInverseMass() : 0.0f) +
                  (b.IsDynamic() ? b.GetMotionProperties()->GetInverseMass() : 0.0f);
  pushEvent(1, ia, ib, inverse > 0 ? approach / inverse : 0.0f, point);
}

void Listener::OnContactRemoved(const SubShapeIDPair &pair) {
  uint32_t ia = instance.engineIndex[pair.GetBody1ID().GetIndex()];
  uint32_t ib = instance.engineIndex[pair.GetBody2ID().GetIndex()];
  auto found = instance.pairs.find(pairKey(ia, ib));
  if (found == instance.pairs.end() || --found->second != 0) return;
  instance.pairs.erase(found);
  pushEvent(2, ia, ib, 0.0f, Vec3::sZero());
}

void Listener::OnBodyDeactivated(const BodyID &, uint64 user) {
  instance.deactivated.push_back(uint32_t(user));
}

}  // namespace trillion

using trillion::world;

extern "C" {

/// Creates the physics system for at most `maxBodies` bodies. Returns 0, or 1 when called twice.
uint32_t jolt_init(uint32_t maxBodies, uint32_t tempBytes) {
  trillion::World &w = world();
  if (w.system) return 1;
  RegisterDefaultAllocator();
  Factory::sInstance = new Factory();
  RegisterTypes();
  w.temp = new TempAllocatorImplWithMallocFallback(tempBytes);
  w.jobs = new JobSystemSingleThreaded(cMaxPhysicsJobs);
  w.system = new PhysicsSystem();
  // Body pairs and contact constraints in the proportions of Jolt's own samples; a step that needs
  // more scratch than `tempBytes` takes it from the heap, still inside the memory budget.
  uint32_t pairs = std::min<uint32_t>(maxBodies * 4, 262144);
  w.system->Init(maxBodies, 0, pairs, maxBodies, trillion::broadPhaseLayers,
                 trillion::objectVsBroadPhase, trillion::objectPairs);
  w.system->SetContactListener(&w.listener);
  w.system->SetBodyActivationListener(&w.listener);
  w.slots.resize(maxBodies);
  w.engineIndex.assign(maxBodies, 0);
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

/// Runs `commandWords` words of commands, then advances by `dt` seconds in `substeps` collision
/// steps (none when `dt` is 0). Returns the pose count, or 0xFFFFFFFF on failure (`jolt_error`).
uint32_t jolt_step(uint32_t commandWords, float dt, uint32_t substeps) {
  trillion::World &w = world();
  w.eventWords = 0;
  w.deactivated.clear();
  w.dt = dt;
  if (!trillion::runCommands(w.buffers[0], commandWords)) return 0xFFFFFFFFu;
  if (dt > 0) w.system->Update(dt, int(std::max(1u, substeps)), w.temp, w.jobs);
  return trillion::writePoses();
}

uint32_t jolt_event_count() { return world().eventWords / trillion::EVENT_WORDS; }
uint32_t jolt_error() { return world().error; }
uint32_t jolt_active_count() { return world().system->GetNumActiveBodies(EBodyType::RigidBody); }

}  // extern "C"
