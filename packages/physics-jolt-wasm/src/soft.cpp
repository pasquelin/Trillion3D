// Soft bodies (SOFT, `packages/sdk-core/src/physics/softLayout.ts`): cloths, ropes and volumes on
// Jolt's soft bodies, made from the page's vertices or restored from the compiler's cook, and their
// vertices written back after each step in the frame of the geometry they came from.
#include "binding.h"
#include "blob.h"
#include "softSettings.h"

#include <Jolt/Physics/SoftBody/SoftBodyCreationSettings.h>
#include <Jolt/Physics/SoftBody/SoftBodyMotionProperties.h>

#include <cstring>

using namespace JPH;

namespace trillion {

namespace {

/// What turns a simulated vertex, in the world, back into its geometry's frame.
struct Soft {
  uint32_t index = 0, engine = 0;
  Vec3 origin = Vec3::sZero(), inverseScale = Vec3::sReplicate(1);
  Quat inverse = Quat::sIdentity();
  /** Written at the last step: once it rests, it is written one last time. */
  bool awake = true;
};

std::vector<Soft> softs;
std::vector<uint32_t> state;

/// The settings a SOFT command carries into `shared`: restored from the cooked bytes it holds
/// (`byteCount`), else built from its vertices and corners (`softSettings.h`), null when they make
/// no soft body. False (with `world().error`) when the cooked bytes are unreadable.
bool settingsOf(const uint32_t *w, Ref<SoftBodySharedSettings> &shared) {
  const uint32_t count = w[19], corners = w[20], bytes = w[21], *v = w + SOFT_WORDS;
  const uint32_t *c = v + count * SOFT_VERTEX_WORDS;
  if (bytes == 0) {
    shared = softSettings(v, count, vec3(w + 9), c, corners, f32(w + 16), f32(w + 17));
    return true;
  }
  BlobIn blob(reinterpret_cast<const uint8_t *>(c + corners), bytes);
  SoftBodySharedSettings::IDToSharedSettingsMap settings;
  SoftBodySharedSettings::IDToMaterialMap materials;
  SoftBodySharedSettings::SettingsResult restored = SoftBodySharedSettings::sRestoreWithMaterials(blob, settings, materials);
  if (restored.HasError() || blob.IsFailed()) return (world().error = BAD_SHAPE, false);
  shared = restored.Get();
  return true;
}

/// Six times the volume the faces of `shared` enclose (positive when they face out).
float sixVolume(const SoftBodySharedSettings &shared) {
  float six = 0;
  for (const SoftBodySharedSettings::Face &f : shared.mFaces) {
    Vec3 a(shared.mVertices[f.mVertex[0]].mPosition), b(shared.mVertices[f.mVertex[1]].mPosition),
        c(shared.mVertices[f.mVertex[2]].mPosition);
    six += a.Dot(b.Cross(c));
  }
  return six;
}

}  // namespace

bool addSoft(const uint32_t *w) {
  World &world = trillion::world();
  uint32_t engine = w[1], index = engine & INDEX_MASK;
  if (index >= world.slots.size() || world.slots[index].used || world.slots[index].refused)
    return (world.error = BAD_COMMAND, false);
  Ref<SoftBodySharedSettings> shared;
  if (!settingsOf(w, shared)) return false;
  if (!shared) {
    world.slots[index] = {};
    world.slots[index].refused = true;
    world.refused.push_back(engine);
    return true;
  }
  SoftBodyCreationSettings settings(shared, RVec3(vec3(w + 2)), quat(w + 5), MOVING);
  settings.mUserData = engine;
  settings.mFriction = f32(w + 12);
  settings.mRestitution = f32(w + 13);
  settings.mGravityFactor = f32(w + 14);
  settings.mLinearDamping = f32(w + 15);
  // Jolt's pressure is n·R·T, the gauge pressure times the volume (Boyle): given at rest.
  settings.mPressure = f32(w + 18) * std::max(0.0f, sixVolume(*shared) / 6.0f);
  BodyInterface &bodies = world.system->GetBodyInterfaceNoLock();
  Body *body = bodies.CreateSoftBody(settings);
  if (!body) return (world.error = BODY_LIMIT, false);
  bodies.AddBody(body->GetID(), EActivation::Activate);
  Slot &slot = world.slots[index];
  slot = {};
  slot.id = body->GetID();
  slot.engine = engine;
  slot.used = slot.soft = true;
  world.engineOf[body->GetID().GetIndex()] = engine;
  softs.push_back({index, engine, vec3(w + 2), Vec3::sReplicate(1) / vec3(w + 9), quat(w + 5).Conjugated()});
  return true;
}

void writeSoft() {
  World &world = trillion::world();
  const BodyLockInterfaceNoLock &locks = world.system->GetBodyLockInterfaceNoLock();
  state.clear();
  // Bodies removed since are dropped from the list; the others keep their order.
  size_t kept = 0;
  for (Soft &soft : softs) {
    const Slot &slot = world.slots[soft.index];
    if (!slot.used || !slot.soft || slot.engine != soft.engine) continue;
    softs[kept++] = soft;
    BodyLockRead lock(locks, slot.id);
    if (!lock.Succeeded()) continue;
    const Body &body = lock.GetBody();
    if (!body.IsActive() && !soft.awake) continue;
    softs[kept - 1].awake = body.IsActive();
    const auto &motion = *static_cast<const SoftBodyMotionProperties *>(body.GetMotionProperties());
    RMat44 com = body.GetCenterOfMassTransform();
    state.push_back(soft.engine);
    state.push_back(uint32_t(motion.GetVertices().size()));
    for (const SoftBodyVertex &v : motion.GetVertices()) {
      Vec3 local = soft.inverse * (Vec3(com * v.mPosition) - soft.origin) * soft.inverseScale;
      float xyz[3] = {local.GetX(), local.GetY(), local.GetZ()};
      uint32_t words[3];
      std::memcpy(words, xyz, sizeof(words));
      state.insert(state.end(), words, words + 3);
    }
  }
  softs.resize(kept);
}

}  // namespace trillion

extern "C" {

/// The soft bodies the last step moved (layout: softLayout.ts), and their word count.
uint32_t *jolt_soft() { return trillion::state.data(); }
uint32_t jolt_soft_words() { return uint32_t(trillion::state.size()); }

}  // extern "C"
