// Soft bodies (SOFT, `packages/sdk-core/src/physics/softLayout.ts`): cloths, ropes and volumes on
// Jolt's soft bodies, made from the page's vertices, and their vertices written back after each
// step in the frame of the geometry they came from.
#include "binding.h"
#include "words.h"

#include <Jolt/Physics/SoftBody/SoftBodyCreationSettings.h>
#include <Jolt/Physics/SoftBody/SoftBodyMotionProperties.h>

#include <cfloat>
#include <cmath>
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

/// A compliance from the words: `Infinity` is Jolt's "no constraint".
float compliance(const uint32_t *w) { return std::isfinite(f32(w)) ? f32(w) : FLT_MAX; }

/// The constraints of `shared`, `count` vertices: a rope's chain when no corner is given, else the
/// triangles' edges; false when a corner names no vertex.
bool constrain(SoftBodySharedSettings &shared, const uint32_t *w, uint32_t count) {
  float stretch = compliance(w + 16), bend = compliance(w + 17);
  const uint32_t corners = w[20], *c = w + SOFT_WORDS + count * SOFT_VERTEX_WORDS;
  if (corners == 0) {
    for (uint32_t i = 0; i + 1 < count; ++i) shared.mEdgeConstraints.emplace_back(i, i + 1, stretch);
    // A rope's fold: each vertex held at its distance from the one after next.
    for (uint32_t i = 0; bend < FLT_MAX && i + 2 < count; ++i)
      shared.mEdgeConstraints.emplace_back(i, i + 2, bend);
    shared.CalculateEdgeLengths();
    return true;
  }
  for (uint32_t i = 0; i + 2 < corners; i += 3) {
    if (c[i] >= count || c[i + 1] >= count || c[i + 2] >= count) return false;
    SoftBodySharedSettings::Face face(c[i], c[i + 1], c[i + 2]);
    if (face.IsDegenerate()) return false;
    shared.AddFace(face);
  }
  SoftBodySharedSettings::VertexAttributes attributes(stretch, stretch, bend);
  using Bend = SoftBodySharedSettings::EBendType;
  shared.CreateConstraints(&attributes, 1, bend < FLT_MAX ? Bend::Dihedral : Bend::None);
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
  uint32_t engine = w[1], index = engine & INDEX_MASK, count = w[19];
  if (index >= world.slots.size() || world.slots[index].used || world.slots[index].refused)
    return (world.error = BAD_COMMAND, false);
  Vec3 scale = vec3(w + 9);
  Ref<SoftBodySharedSettings> shared = new SoftBodySharedSettings;
  for (const uint32_t *v = w + SOFT_WORDS, *end = v + count * SOFT_VERTEX_WORDS; v < end; v += SOFT_VERTEX_WORDS) {
    Float3 at;
    (vec3(v) * scale).StoreFloat3(&at);
    // A mass of 0 is a pin: held where it is.
    shared->mVertices.emplace_back(at, Float3(0, 0, 0), f32(v + 3) > 0 ? 1.0f / f32(v + 3) : 0.0f);
  }
  if (count < 2 || !constrain(*shared, w, count)) {
    world.slots[index] = {};
    world.slots[index].refused = true;
    world.refused.push_back(engine);
    return true;
  }
  shared->Optimize();
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
  softs.push_back({index, engine, vec3(w + 2), Vec3::sReplicate(1) / scale, quat(w + 5).Conjugated()});
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
