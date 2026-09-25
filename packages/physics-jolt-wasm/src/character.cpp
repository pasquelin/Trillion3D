// The world's character: one Jolt `CharacterVirtual`, an upright capsule whose feet are its
// position, moved each step by the velocity the worker's driver asks for
// (`packages/sdk-browser/src/physics/characterDriver.ts`). Jolt resolves the contacts: it slides
// along walls, climbs stairs, stands on slopes up to its angle, is carried by what it stands on
// and pushed by what moves into it, and pushes dynamic bodies with at most its strength. An inner
// kinematic capsule lets the bodies meet it in turn. Word layouts: `layout.ts` (CHARACTER,
// CHARACTER_MOVE, CHARACTER_STATE_WORDS).
#include "binding.h"
#include "words.h"

#include <Jolt/Physics/Character/CharacterVirtual.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/RotatedTranslatedShape.h>

using namespace JPH;

namespace trillion {

namespace {

Ref<CharacterVirtual> character;
float stepHeight = 0;
/** The velocity the last CHARACTER_MOVE asked for, and whether it is owed to this step. */
Vec3 wished = Vec3::sZero();
bool due = false, grounded = false;
/** `present, feet x y z, ground state, ground velocity x y z, ground friction` (layout.ts). */
float state[CHARACTER_STATE_WORDS] = {};

/// The inner capsule is placed, never simulated: kept asleep, it never counts as a body awake,
/// so a world whose bodies all rest still stops stepping with a character in it.
void rest() {
  trillion::world().system->GetBodyInterfaceNoLock().DeactivateBody(character->GetInnerBodyID());
}

void create(const uint32_t *w) {
  World &world = trillion::world();
  // The inner body's engine id names the slot past the page's: no command or pose reaches it, and
  // its contacts are reported under that id (the page names it by the character's camera).
  uint32_t engine = uint32_t(world.slots.size() - 1);
  Slot &slot = world.slots[engine];
  // The character replaced or removed ends every touch its inner capsule began.
  if (slot.used) leaveAll(engine);
  slot = Slot();
  character = nullptr;
  float radius = f32(w + 1), height = f32(w + 2);
  if (radius <= 0) return;
  // The capsule stands on its feet: the shape rises by half the height from the position.
  float half = std::max(height * 0.5f, radius);
  RefConst<Shape> capsule =
      RotatedTranslatedShapeSettings(Vec3(0, half, 0), Quat::sIdentity(),
                                     new CapsuleShape(std::max(half - radius, 1e-3f), radius))
          .Create()
          .Get();
  Ref<CharacterVirtualSettings> settings = new CharacterVirtualSettings();
  settings->mShape = capsule;
  settings->mInnerBodyShape = capsule;
  settings->mInnerBodyLayer = MOVING;
  settings->mMaxSlopeAngle = f32(w + 3);
  // Only a touch on the lower sphere supports the body; its sides are walls.
  settings->mSupportingVolume = Plane(Vec3::sAxisY(), -radius);
  settings->mMass = f32(w + 5);
  settings->mMaxStrength = f32(w + 6);
  stepHeight = f32(w + 4);
  character = new CharacterVirtual(settings, RVec3(vec3(w + 7)), Quat::sIdentity(), engine, world.system);
  // A slot of its own: a contact's enter and leave both name the capsule, as any body's do.
  slot.id = character->GetInnerBodyID();
  slot.engine = engine;
  slot.used = true;
  world.engineOf[slot.id.GetIndex()] = engine;
  due = grounded = false;
  rest();
}

}  // namespace

uint32_t characterCommand(const uint32_t *w) {
  if (w[0] == CHARACTER) {
    create(w);
    return CHARACTER_WORDS;
  }
  wished = vec3(w + 1);
  grounded = w[4] != 0;
  due = character != nullptr;
  return CHARACTER_MOVE_WORDS;
}

void moveCharacter(float dt) {
  if (!due || dt <= 0) return;
  due = false;
  World &world = trillion::world();
  character->SetLinearVelocity(wished);
  CharacterVirtual::ExtendedUpdateSettings settings;
  // A body on its feet follows the floor down a step and climbs one up; a body in the air neither.
  settings.mStickToFloorStepDown = grounded ? Vec3(0, -stepHeight, 0) : Vec3::sZero();
  settings.mWalkStairsStepUp = grounded ? Vec3(0, stepHeight, 0) : Vec3::sZero();
  character->ExtendedUpdate(dt, world.system->GetGravity(), settings,
                            world.system->GetDefaultBroadPhaseLayerFilter(MOVING),
                            world.system->GetDefaultLayerFilter(MOVING), {}, {}, *world.temp);
  rest();
}

void writeCharacter() {
  state[0] = character ? 1.0f : 0.0f;
  if (!character) return;
  World &world = trillion::world();
  // What the body stands on moved during the step: its velocity is the next step's to follow.
  character->UpdateGroundVelocity();
  RVec3 feet = character->GetPosition();
  Vec3 ground = character->GetGroundVelocity();
  // The friction of the body the feet stand on, -1 when none: the driver bounds the step by it.
  BodyID floor = character->GetGroundBodyID();
  float friction =
      floor.IsInvalid() ? -1.0f : world.system->GetBodyInterfaceNoLock().GetFriction(floor);
  float values[CHARACTER_STATE_WORDS - 1] = {
      float(feet.GetX()), float(feet.GetY()), float(feet.GetZ()),
      float(int(character->GetGroundState())), ground.GetX(), ground.GetY(), ground.GetZ(),
      friction};
  std::memcpy(state + 1, values, sizeof(values));
}

}  // namespace trillion

extern "C" {

/// The character's state after the last step (layout.ts CHARACTER_STATE_WORDS).
float *jolt_character() { return trillion::state; }

}  // extern "C"
