// Soft bodies (SOFT, `packages/sdk-core/src/physics/softLayout.ts`): cloths, ropes and volumes on
// Jolt's soft bodies, made from the page's vertices or restored from the compiler's cook, and their
// vertices written back after each step in the frame of the geometry they came from. Each one
// collides a centimetre thick, and passes through the static bodies its pins hang inside.
//
// Its solver's input is bounded when it is made, so that no soft body can run away: no bend is
// stiffer than the solver resolves (`floorBends`, `softSettings.h`: a bend corrects at most five
// sixths of its error a substep, never overshooting), and no vertex moves faster than its swing
// or its fall (`hold`): its kinetic energy is at most half its mass times that speed squared,
// whatever its solver does, and a vertex goes non-finite only on non-finite input (taken out,
// `World::diverged`). Carried further than `SOFT_TELEPORT`, it starts again in its rest shape.
#include "binding.h"
#include "blob.h"
#include "softSettings.h"

#include <Jolt/Physics/Collision/CollidePointResult.h>
#include <Jolt/Physics/Collision/CollisionCollectorImpl.h>
#include <Jolt/Physics/SoftBody/SoftBodyCreationSettings.h>
#include <Jolt/Physics/SoftBody/SoftBodyMotionProperties.h>

#include <algorithm>
#include <cmath>
#include <cstring>

using namespace JPH;

namespace trillion {

namespace {

/// Declared: a soft body's parts move no faster than a fall from this many times its own size
/// (the diagonal of its rest bounds) under its pull: 59 m/s for a 1.8 m flag, 84 for a 3.6 m one,
/// ten times the speed of its swing (`sqrt(2·g·size)`). Neither its weight nor what it meets drives
/// its parts so fast: only a solver gone wrong would, and this bound holds it.
constexpr float SOFT_FALL = 100;
/// The physics module's bound on a soft body's vertex speed, m/s (`SoftBodyCreationSettings::mMaxLinearVelocity`):
/// one that declares no damping falls freely under it.
constexpr float JOLT_FASTEST = 500;
/// Declared: a soft body's vertices keep this far from what they collide with, m (the module's
/// `mVertexRadius`): a centimetre of thickness, so a cloth laid on a surface rests on it, not in it.
constexpr float SOFT_VERTEX_RADIUS = 0.01f;
/// Declared: a soft body carried further than this in one move, m, starts again at rest in its rest
/// shape where it now is; a shorter move carries it as it lies, its motion kept.
constexpr float SOFT_TELEPORT = 3;

/// A static body a soft body's bounds met, judged once where both stand (`hangsOn`).
struct Support {
  uint32_t engine;
  bool holds;
  RVec3 at;
  Quat turn;
  uint32_t placed;
};

/// What turns a simulated vertex, in the world, back into its geometry's frame.
struct Soft {
  uint32_t index = 0, engine = 0;
  Vec3 origin = Vec3::sZero(), inverseScale = Vec3::sReplicate(1);
  Quat inverse = Quat::sIdentity();
  /** The diagonal of its rest bounds in Jolt's frame of its vertices, m: its size, which its
   *  speed is held to (`SOFT_FALL`). */
  float rest = 0;
  /** Counts its placements: a support judged at an older one is out of date. */
  uint32_t placed = 0;
  /** The static bodies its bounds met, and whether its pins hang inside each. */
  std::vector<Support> supports;
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

/// The bounds of the vertices of `shared` at rest, turned by `turn`.
AABox restBounds(const SoftBodySharedSettings &shared, Quat turn) {
  AABox rest;
  for (const SoftBodySharedSettings::Vertex &v : shared.mVertices) rest.Encapsulate(turn * Vec3(v.mPosition));
  return rest;
}

/// The pull a soft body's bounds are reckoned with, m/s²: the gravity times its scale, never less
/// than Earth's (`STANDARD_GRAVITY`), so that one made afloat, or under a weaker pull, is still held
/// to its size.
float pullOf(const MotionProperties &motion) {
  return std::max(world().system->GetGravity().Length() * std::abs(motion.GetGravityFactor()), STANDARD_GRAVITY);
}

/// Holds `soft` to the pull it is under now: the speed Jolt holds each of its vertices under — the
/// faster of its swing (`SOFT_FALL`) and its fall through its own damping, `pull / damping`
/// (Jolt's own bound with none): neither a body falling whole nor its swing is ever held back,
/// and its energy is bounded whatever its solver does.
void hold(const Soft &soft, Body &body) {
  auto &motion = *static_cast<SoftBodyMotionProperties *>(body.GetMotionProperties());
  const float pull = pullOf(motion);
  const float swing = std::sqrt(2 * pull * SOFT_FALL * soft.rest);
  const float damping = motion.GetLinearDamping();
  motion.SetMaxLinearVelocity(std::max(swing, damping > 0 ? pull / damping : JOLT_FASTEST));
}

/// Whether `point` lies inside `shape` with a margin: it and the six points `EMBEDDED` from it
/// along the axes are all in it (Jolt's point query; a mesh by the parity of a ray). A point on a
/// surface is not: a cloth laid on a table is not inside it.
bool deepIn(const TransformedShape &shape, Vec3 point) {
  constexpr float EMBEDDED = 1e-3f;
  const Vec3 probes[] = {Vec3::sZero(), Vec3(EMBEDDED, 0, 0), Vec3(-EMBEDDED, 0, 0), Vec3(0, EMBEDDED, 0),
                         Vec3(0, -EMBEDDED, 0), Vec3(0, 0, EMBEDDED), Vec3(0, 0, -EMBEDDED)};
  for (Vec3 probe : probes) {
    AnyHitCollisionCollector<CollidePointCollector> hit;
    shape.CollidePoint(RVec3(point + probe), hit);
    if (!hit.HadHit()) return false;
  }
  return true;
}

/// Whether the cloth near a pin of `soft` starts inside `other`: the middle of an edge from a pin,
/// at rest where the soft body is placed, lies a millimetre deep in its shape (`deepIn`). Its pins
/// then hang inside that body, which would push the cloth they hold out against them at every step.
bool startsIn(const Soft &soft, const SoftBodySharedSettings &shared, const Body &other) {
  const TransformedShape shape = other.GetTransformedShape();
  const Quat turn = soft.inverse.Conjugated();
  for (const SoftBodySharedSettings::Edge &e : shared.mEdgeConstraints) {
    const SoftBodySharedSettings::Vertex &a = shared.mVertices[e.mVertex[0]], &b = shared.mVertices[e.mVertex[1]];
    if ((a.mInvMass == 0) == (b.mInvMass == 0)) continue;
    if (deepIn(shape, soft.origin + turn * (0.5f * (Vec3(a.mPosition) + Vec3(b.mPosition))))) return true;
  }
  return false;
}

/// Brings `soft` back to its rest shape, at rest, where the page placed it. Jolt's bounds follow
/// at the next step.
void bringBack(const Soft &soft, Body &body) {
  auto &motion = *static_cast<SoftBodyMotionProperties *>(body.GetMotionProperties());
  const SoftBodySharedSettings &shared = *motion.GetSettings();
  Array<SoftBodyVertex> &vertices = motion.GetVertices();
  const Quat turn = soft.inverse.Conjugated();
  const RMat44 back = body.GetCenterOfMassTransform().InversedRotationTranslation();
  for (size_t i = 0; i < vertices.size(); ++i) {
    SoftBodyVertex &v = vertices[i];
    v.mPreviousPosition = v.mPosition = Vec3(back * RVec3(soft.origin + turn * Vec3(shared.mVertices[i].mPosition)));
    v.mVelocity = Vec3::sZero();
  }
}

/// Writes the vertices of `soft` into `state` from word `start` (`SOFT_STATE_WORDS`), each in its
/// geometry's frame; false when one is not finite.
bool written(const Soft &soft, const Body &body, size_t start) {
  const auto &vertices = static_cast<const SoftBodyMotionProperties *>(body.GetMotionProperties())->GetVertices();
  state.resize(start + 2 + vertices.size() * 3);
  state[start] = soft.engine;
  state[start + 1] = uint32_t(vertices.size());
  // World to geometry, composed once per body (PHY-06): scale⁻¹ · rotation⁻¹ ·
  // translation(−origin) · centre of mass. The vertices are those the per-vertex chain gave but
  // for float rounding, a few ulps of the world coordinate (`softWriteback.test.ts`), far below
  // a tenth of a pixel; the simulation never reads them back.
  const Mat44 back = Mat44::sScale(soft.inverseScale) * Mat44::sRotation(soft.inverse) *
                     Mat44::sTranslation(-soft.origin) * Mat44(body.GetCenterOfMassTransform());
  uint32_t *out = state.data() + start + 2;
  bool finite = true;
  for (const SoftBodyVertex &v : vertices) {
    const Vec3 local = back * v.mPosition;
    const float xyz[3] = {local.GetX(), local.GetY(), local.GetZ()};
    finite = finite && std::isfinite(xyz[0]) && std::isfinite(xyz[1]) && std::isfinite(xyz[2]);
    std::memcpy(out, xyz, sizeof(xyz));
    out += 3;
  }
  return finite;
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
  // No bend stiffer than its solver resolves in a substep of the page's step (`SOFT_BEND_FLOOR`).
  floorBends(*shared, world.fixedStep / float(settings.mNumIterations));
  settings.mUserData = engine;
  settings.mFriction = f32(w + 12);
  settings.mRestitution = f32(w + 13);
  settings.mGravityFactor = f32(w + 14);
  settings.mLinearDamping = f32(w + 15);
  settings.mVertexRadius = SOFT_VERTEX_RADIUS;
  // Jolt holds its vertices turned by the rotation it was made with (`mMakeRotationIdentity`).
  const float rest = std::max(restBounds(*shared, settings.mRotation).GetSize().Length(), 1e-3f);
  BodyInterface &bodies = world.system->GetBodyInterfaceNoLock();
  Body *body = bodies.CreateSoftBody(settings);
  if (!body) return (world.error = BODY_LIMIT, false);
  // Jolt's pressure is n·R·T, the gauge pressure times the volume, which a gas at one temperature
  // keeps as it is squeezed: given at rest, the volume Jolt's own faces enclose (positive when they
  // face out).
  auto &motion = *static_cast<SoftBodyMotionProperties *>(body->GetMotionProperties());
  motion.SetPressure(f32(w + 18) * std::max(0.0f, motion.GetVolume()));
  bodies.AddBody(body->GetID(), EActivation::Activate);
  Slot &slot = world.slots[index];
  slot = {};
  slot.id = body->GetID();
  slot.engine = engine;
  slot.used = slot.soft = true;
  world.engineOf[body->GetID().GetIndex()] = engine;
  slot.softAt = uint32_t(softs.size());
  Soft &soft = softs.emplace_back();
  soft.index = index;
  soft.engine = engine;
  soft.origin = vec3(w + 2);
  soft.inverseScale = Vec3::sReplicate(1) / vec3(w + 9);
  soft.inverse = quat(w + 5).Conjugated();
  // Its size, pull and damping bound its speed (`hold`).
  soft.rest = rest;
  hold(soft, *body);
  return true;
}

void teleportSoft(const Slot &slot, Vec3 position, Quat rotation) {
  World &world = trillion::world();
  // Found by its slot, not by a scan (PHY-22): `addSoft` and `writeSoft` keep it in step.
  Soft &soft = softs[slot.softAt];
  // Jolt keeps the body at the centre of its vertices, not at the place it was made: the turn
  // from the old place to the new one carries the body, and its vertices with it.
  BodyInterface &bodies = world.system->GetBodyInterfaceNoLock();
  const Quat turn = rotation * soft.inverse;
  const Vec3 at = Vec3(bodies.GetPosition(slot.id));
  const RVec3 moved(position + turn * (at - soft.origin));
  bodies.SetPositionAndRotation(slot.id, moved, (turn * bodies.GetRotation(slot.id)).Normalized(), EActivation::Activate);
  const bool far = (position - soft.origin).Length() > SOFT_TELEPORT;
  soft.origin = position;
  soft.inverse = rotation.Conjugated();
  ++soft.placed;
  // Carried further than `SOFT_TELEPORT`, it starts again at rest in its rest shape where it is now.
  if (!far) return;
  BodyLockWrite lock(world.system->GetBodyLockInterfaceNoLock(), slot.id);
  if (lock.Succeeded()) bringBack(soft, lock.GetBody());
}

void holdSoft(const Slot &slot) {
  BodyLockWrite lock(world().system->GetBodyLockInterfaceNoLock(), slot.id);
  if (lock.Succeeded()) hold(softs[slot.softAt], lock.GetBody());
}

void holdSofts() {
  const World &world = trillion::world();
  for (const Soft &soft : softs) {
    const Slot &slot = world.slots[soft.index];
    // A body removed since the last step is dropped from the list at the next (`writeSoft`).
    if (slot.used && slot.soft && slot.engine == soft.engine) holdSoft(slot);
  }
}

bool hangsOn(const Body &softBody, const Body &other) {
  // Only what stands still holds a pin: a moving body is met wherever it goes.
  if (!other.IsStatic() || other.IsSensor()) return false;
  const World &world = trillion::world();
  const uint32_t engine = uint32_t(softBody.GetUserData());
  const Slot &slot = world.slots[engine & INDEX_MASK];
  if (!slot.used || !slot.soft || slot.engine != engine) return false;
  // Jolt collides each soft body on one thread at a time: its own entry is this thread's alone.
  Soft &soft = softs[slot.softAt];
  const uint32_t id = uint32_t(other.GetUserData());
  const RVec3 at = other.GetPosition();
  const Quat turn = other.GetRotation();
  const auto judge = [&] {
    return startsIn(soft, *static_cast<const SoftBodyMotionProperties *>(softBody.GetMotionProperties())->GetSettings(), other);
  };
  for (Support &s : soft.supports)
    if (s.engine == id) {
      if (s.placed != soft.placed || s.at != at || s.turn != turn) s = {id, judge(), at, turn, soft.placed};
      return s.holds;
    }
  soft.supports.push_back({id, judge(), at, turn, soft.placed});
  return soft.supports.back().holds;
}

void writeSoft() {
  World &world = trillion::world();
  const BodyLockInterfaceNoLock &locks = world.system->GetBodyLockInterfaceNoLock();
  state.clear();
  // Bodies removed since are dropped from the list; the others keep their order.
  size_t kept = 0;
  for (size_t at = 0; at < softs.size(); ++at) {
    {
      const Soft &next = softs[at];
      const Slot &slot = world.slots[next.index];
      if (!slot.used || !slot.soft || slot.engine != next.engine) continue;
    }
    if (kept != at) softs[kept] = std::move(softs[at]);
    Soft &soft = softs[kept++];
    Slot &slot = world.slots[soft.index];
    slot.softAt = uint32_t(kept - 1);
    // The supports judged before that have left (a tile streamed out) are forgotten.
    std::vector<Support> &supports = soft.supports;
    supports.erase(std::remove_if(supports.begin(), supports.end(),
                                  [&](const Support &s) {
                                    const Slot &other = world.slots[s.engine & INDEX_MASK];
                                    return !other.used || other.engine != s.engine;
                                  }),
                   supports.end());
    BodyLockWrite lock(locks, slot.id);
    if (!lock.Succeeded()) continue;
    Body &body = lock.GetBody();
    const bool hidden = (slot.flags & HIDDEN) != 0, active = body.IsActive();
    // Hidden by the page, it sends no vertex; shown again, it is written once, asleep or not.
    // Shown, it is written while it moves and once at rest (`Slot::rests`).
    if (hidden) slot.restWrites = 0;
    if (hidden || slot.rests(active, 1)) continue;
    const size_t start = state.size();
    // A diverged body sends no vertex: it leaves the simulation after the step (`jolt_step`).
    if (!written(soft, body, start)) {
      state.resize(start);
      world.diverged.push_back(soft.engine);
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
