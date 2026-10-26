// The world's character: one Jolt `CharacterVirtual`, an upright capsule whose feet are its
// position, moved each step by the velocity the worker's driver asks for
// (`packages/sdk-browser/src/physics/character/characterDriver.ts`). Jolt resolves the contacts: it slides
// along walls, climbs stairs, stands on slopes up to its angle, is carried by what it stands on
// and pushed by what moves into it, and pushes dynamic bodies with at most its strength. An inner
// kinematic capsule lets the bodies meet it in turn. It meets what its filter blocks and passes
// through what it overlaps (`filters.h`), crouches to a shorter capsule where the room is. Word
// layouts: `layout.ts` (CHARACTER, CHARACTER_MOVE, CHARACTER_STATE_WORDS).
#include "binding.h"
#include "words.h"

#include <Jolt/Physics/Character/CharacterVirtual.h>
#include <Jolt/Physics/Collision/ObjectLayer.h>
#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/RotatedTranslatedShape.h>

using namespace JPH;

namespace trillion {

namespace {

Ref<CharacterVirtual> character;
float stepHeight = 0;
/** The two capsules (standing, crouched), their half heights, whether a crouch keeps the base in
 *  place (else the centre), the object layer of the body, whether a crouch is wished and held. */
RefConst<Shape> standing, crouching;
float standingHalf = 0, crouchedHalf = 0;
bool keepsBase = false, wishCrouch = false, crouched = false;
ObjectLayer layer = 0;
/** The velocity the last CHARACTER_MOVE asked for, and whether it is owed to this step. */
Vec3 wished = Vec3::sZero();
bool due = false, grounded = false;
/** `present, feet x y z, ground state, ground velocity x y z, crouched` (layout.ts). */
float state[CHARACTER_STATE_WORDS] = {};

/// What the character collides with: the bodies that block its filter. Bodies it overlaps pass
/// through it and are not met here.
class Blocks final : public ObjectLayerFilter {
public:
  bool ShouldCollide(ObjectLayer other) const override {
    return taken(filterOf(layer), filterOf(other)) == Meeting::Block;
  }
};

/// Half the total `height` of a capsule of `radius`: never less than the radius.
float halfOf(float height, float radius) { return std::max(height * 0.5f, radius); }

/// An upright capsule of total `height` and `radius`, its base at the origin.
RefConst<Shape> capsuleOf(float height, float radius) {
  float half = halfOf(height, radius);
  return RotatedTranslatedShapeSettings(Vec3(0, half, 0), Quat::sIdentity(),
                                        new CapsuleShape(std::max(half - radius, 1e-3f), radius))
      .Create()
      .Get();
}

/// Stands up or crouches down where the room is: the capsule changes, at the base's place or at
/// the centre's (a crouch keeps the base or the centre, `CHARACTER`); a stand that finds no room
/// at the centre's place tries the base's. Returns whether the shape changed.
bool reshape(bool crouch) {
  World &world = trillion::world();
  const RVec3 feet = character->GetPosition();
  const float change = standingHalf - crouchedHalf;
  // Centre kept: a crouch lifts the base by `change`, a stand lowers it.
  const float shifts[2] = {keepsBase ? 0.0f : (crouch ? change : -change), 0.0f};
  const Shape *shape = crouch ? crouching.GetPtr() : standing.GetPtr();
  for (int attempt = 0; attempt < (crouch || keepsBase ? 1 : 2); ++attempt) {
    character->SetPosition(feet + RVec3(0, shifts[attempt], 0));
    if (character->SetShape(shape, 1.5f * world.system->GetPhysicsSettings().mPenetrationSlop,
                            world.system->GetDefaultBroadPhaseLayerFilter(layer), Blocks(), {}, {}, *world.temp)) {
      character->SetInnerBodyShape(shape);
      return true;
    }
  }
  character->SetPosition(feet);
  return false;
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
  standing = crouching = nullptr;
  wishCrouch = crouched = false;
  float radius = f32(w + 1), height = f32(w + 2);
  if (radius <= 0) return;
  // The capsule stands on its feet: the shape rises by half the height from the position.
  layer = ObjectLayer(w[10]);
  standing = capsuleOf(height, radius);
  // A crouch is never taller than the body, nor lower than its radius is wide.
  const float crouchedHeight = std::clamp(f32(w + 11), 2 * radius, std::max(height, 2 * radius));
  crouching = capsuleOf(crouchedHeight, radius);
  standingHalf = halfOf(height, radius);
  crouchedHalf = halfOf(crouchedHeight, radius);
  keepsBase = w[12] != 0;
  Ref<CharacterVirtualSettings> settings = new CharacterVirtualSettings();
  settings->mShape = standing;
  settings->mInnerBodyShape = standing;
  settings->mInnerBodyLayer = layer;
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
  // The inner capsule is placed, never simulated: put to sleep once (Jolt adds it awake), it stays
  // asleep — Jolt places it without waking it and a contact wakes only dynamic bodies —, so it
  // never counts as a body awake and a world whose bodies all rest still stops stepping.
  world.system->GetBodyInterfaceNoLock().DeactivateBody(slot.id);
}

}  // namespace

uint32_t characterCommand(const uint32_t *w) {
  if (w[0] == CHARACTER) {
    create(w);
    return CHARACTER_WORDS;
  }
  wished = vec3(w + 1);
  grounded = w[4] != 0;
  wishCrouch = w[5] != 0;
  due = character != nullptr;
  return CHARACTER_MOVE_WORDS;
}

void moveCharacter(float dt) {
  if (!due || dt <= 0) return;
  due = false;
  World &world = trillion::world();
  if (wishCrouch != crouched && reshape(wishCrouch)) crouched = wishCrouch;
  // On a walkable slope the horizontal move follows the floor: the vertical part that keeps its
  // horizontal speed is added, the floor's plane projected along the up axis.
  Vec3 velocity = wished;
  if (grounded && character->GetGroundState() == CharacterBase::EGroundState::OnGround) {
    Vec3 n = character->GetGroundNormal();
    if (n.GetY() > 1e-5f && n.GetY() < 1.0f - 1e-5f)
      velocity.SetY(velocity.GetY() - (n.GetX() * velocity.GetX() + n.GetZ() * velocity.GetZ()) / n.GetY());
  }
  character->SetLinearVelocity(velocity);
  CharacterVirtual::ExtendedUpdateSettings settings;
  // A body on its feet follows the floor down a step and climbs one up; a body in the air neither.
  settings.mStickToFloorStepDown = grounded ? Vec3(0, -stepHeight, 0) : Vec3::sZero();
  settings.mWalkStairsStepUp = grounded ? Vec3(0, stepHeight, 0) : Vec3::sZero();
  character->ExtendedUpdate(dt, world.system->GetGravity(), settings,
                            world.system->GetDefaultBroadPhaseLayerFilter(layer), Blocks(), {}, {}, *world.temp);
}

void writeCharacter() {
  state[0] = character ? 1.0f : 0.0f;
  if (!character) return;
  // What the body stands on moved during the step: its velocity is the next step's to follow.
  character->UpdateGroundVelocity();
  RVec3 feet = character->GetPosition();
  Vec3 ground = character->GetGroundVelocity();
  float values[CHARACTER_STATE_WORDS - 2] = {
      float(feet.GetX()), float(feet.GetY()), float(feet.GetZ()),
      float(int(character->GetGroundState())), ground.GetX(), ground.GetY(), ground.GetZ()};
  std::memcpy(state + 1, values, sizeof(values));
  state[CHARACTER_STATE_WORDS - 1] = crouched ? 1.0f : 0.0f;
}

}  // namespace trillion

extern "C" {

/// The character's state after the last step (layout.ts CHARACTER_STATE_WORDS).
float *jolt_character() { return trillion::state; }

}  // extern "C"
