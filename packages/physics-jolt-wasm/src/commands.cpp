// The command buffer: body creation with its shape, cooked shapes restored and released, removal, teleport, kinematic moves, velocity,
// impulses, wake/freeze, gravity. Word layouts: `packages/sdk-core/src/physics/layout.ts`.
#include "binding.h"
#include "restore.h"
#include "words.h"

#include <Jolt/Physics/Body/BodyCreationSettings.h>

using namespace JPH;

namespace trillion {

namespace {

enum Op : uint32_t {
  ADD = 1, REMOVE, TELEPORT, MOVE_KINEMATIC, VELOCITY, IMPULSE, WAKE, GRAVITY, GRAVITY_SCALE,
  VIEW, FLAGS, MATERIAL, RESTORE, RELEASE
};
/// Words of each fixed-size command, by opcode (layout.ts).
constexpr uint32_t SIZES[] = {0, 0, 2, 9, 9, 5, 5, 2, 4, 3, 9, 3, 4};
/** Adds in one batch past which the broad phase is rebuilt after it. */
constexpr uint32_t BULK_ADDS = 256;
/// Density every shape is built with; a body's mass is set from the engine's density or mass.
constexpr float SHAPE_DENSITY = 1000.0f;

bool add(const uint32_t *w) {
  World &world = trillion::world();
  uint32_t engine = w[1], index = engine & INDEX_MASK, motion = w[2], layer = w[3], flags = w[5];
  if (index >= world.slots.size() || world.slots[index].used || world.slots[index].refused)
    return (world.error = BAD_COMMAND, false);
  RefConst<Shape> shape = shapeOf(w);
  // A refused shape fails its body alone: the page hears its id and removes it.
  if (!shape) {
    world.slots[index] = {};
    world.slots[index].refused = true;
    world.refused.push_back(engine);
    return true;
  }
  EMotionType type = motion == 0 ? EMotionType::Static : motion == 1 ? EMotionType::Kinematic : EMotionType::Dynamic;
  BodyCreationSettings settings(shape, RVec3(vec3(w + 6)), quat(w + 9), type, ObjectLayer(layer));
  settings.mUserData = engine;
  settings.mIsSensor = (flags & SENSOR) != 0;
  settings.mMotionQuality = (flags & CCD) ? EMotionQuality::LinearCast : EMotionQuality::Discrete;
  settings.mFriction = f32(w + 18);
  settings.mRestitution = f32(w + 19);
  settings.mGravityFactor = f32(w + 20);
  if (type == EMotionType::Dynamic) {
    float mass = f32(w + 16);
    if (mass <= 0) mass = f32(w + 17) * shape->GetMassProperties().mMass / SHAPE_DENSITY;
    settings.mOverrideMassProperties = EOverrideMassProperties::CalculateInertia;
    settings.mMassPropertiesOverride.mMass = std::max(mass, 1e-6f);
  }
  Body *body = world.system->GetBodyInterfaceNoLock().CreateBody(settings);
  if (!body) return (world.error = BODY_LIMIT, false);
  world.system->GetBodyInterfaceNoLock().AddBody(body->GetID(), type == EMotionType::Static ? EActivation::DontActivate : EActivation::Activate);
  Slot &slot = world.slots[index];
  slot = {};
  slot.id = body->GetID();
  slot.engine = engine;
  slot.flags = flags;
  slot.used = true;
  world.engineOf[body->GetID().GetIndex()] = engine;
  return true;
}

}  // namespace

bool runCommands(const uint32_t *w, uint32_t count) {
  World &world = trillion::world();
  BodyInterface &bodies = world.system->GetBodyInterfaceNoLock();
  const uint32_t *end = w + count;
  uint32_t added = 0;
  while (w < end) {
    uint32_t op = w[0];
    if (op == ADD) {
      if (!add(w)) return false;
      w += ADD_WORDS + w[21] * 3 + w[22];
      ++added;
      continue;
    }
    if (op == GRAVITY) {
      world.system->SetGravity(vec3(w + 1));
      w += 4;
      continue;
    }
    if (op == RESTORE) {
      if (!restoreShape(w)) return false;
      w += RESTORE_WORDS + (w[2] + 3) / 4;
      continue;
    }
    if (op == RELEASE) {
      releaseShape(w);
      w += RELEASE_WORDS;
      continue;
    }
    if (op == VIEW) {
      world.view = {vec3(w + 1), vec3(w + 4).NormalizedOr(Vec3(0, 0, -1)), f32(w + 7), f32(w + 8)};
      w += 9;
      continue;
    }
    uint32_t index = w[1];
    if (op < REMOVE || op > MATERIAL || op == VIEW) return (world.error = BAD_COMMAND, false);
    if (index >= world.slots.size()) return (world.error = UNKNOWN_BODY, false);
    Slot &slot = world.slots[index];
    // Commands the page wrote before it heard of a refused shape.
    if (slot.refused) {
      if (op == REMOVE) slot = Slot{};
      w += SIZES[op];
      continue;
    }
    if (!slot.used) return (world.error = UNKNOWN_BODY, false);
    switch (op) {
      case REMOVE: {
        BodyID id = slot.id;
        leaveAll(slot.engine);
        slot = Slot{};
        bodies.RemoveBody(id);
        bodies.DestroyBody(id);
        break;
      }
      case TELEPORT:
        bodies.SetPositionAndRotation(slot.id, RVec3(vec3(w + 2)), quat(w + 5), EActivation::Activate);
        break;
      case MOVE_KINEMATIC:
        if (world.dt > 0) bodies.MoveKinematic(slot.id, RVec3(vec3(w + 2)), quat(w + 5), world.dt);
        else bodies.SetPositionAndRotation(slot.id, RVec3(vec3(w + 2)), quat(w + 5), EActivation::DontActivate);
        break;
      case VELOCITY:
        bodies.SetLinearVelocity(slot.id, vec3(w + 2));
        break;
      case IMPULSE:
        bodies.AddImpulse(slot.id, vec3(w + 2));
        break;
      case WAKE:
        bodies.ActivateBody(slot.id);
        break;
      case GRAVITY_SCALE:
        bodies.SetGravityFactor(slot.id, f32(w + 2));
        break;
      case FLAGS:
        slot.flags = w[2];
        break;
      default:  // MATERIAL
        bodies.SetFriction(slot.id, f32(w + 2));
        bodies.SetRestitution(slot.id, f32(w + 3));
    }
    w += SIZES[op];
  }
  // Bodies added in bulk leave the broad phase tree unbalanced: rebuilt once, after the batch.
  if (added >= BULK_ADDS) world.system->OptimizeBroadPhase();
  return true;
}

}  // namespace trillion
