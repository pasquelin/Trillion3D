// Soft bodies (SOFT, `packages/sdk-core/src/physics/softLayout.ts`): cloths, ropes and volumes on
// Jolt's soft bodies, made from the page's vertices or restored from the compiler's cook, and their
// vertices written back after each step in the frame of the geometry they came from. Each one
// collides a centimetre thick, bends no stiffer than its solver resolves, is held under the speed
// its size, pull and damping allow, is brought back to its last good state when it diverges and to
// its rest shape when carried further than `SOFT_TELEPORT`, and passes through the static bodies
// its pins hang inside.
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

/// Declared: a soft body's parts go apart no faster than a fall from this many times its own size
/// (the diagonal of its rest bounds) under its pull: 59 m/s for a 1.8 m flag, 84 for a 3.6 m one,
/// ten times the speed of its swing (`sqrt(2·g·size)`). Neither its weight nor what it meets drives
/// its parts so fast apart: only its solver gone wrong does.
constexpr float SOFT_FALL = 100;
/// Standard gravity, m/s²: the least pull a soft body's bounds are reckoned with, so that one made
/// afloat (or under a weaker pull) is still held to its size.
constexpr float STANDARD_GRAVITY = 9.81f;
/// The physics module's bound on a soft body's vertex speed, m/s (`SoftBodyCreationSettings::mMaxLinearVelocity`):
/// one that declares no damping falls freely under it.
constexpr float JOLT_FASTEST = 500;
/// Declared: a soft body's vertices keep this far from what they collide with, m (the module's
/// `mVertexRadius`): a centimetre of thickness, so a cloth laid on a surface rests on it, not in it.
constexpr float SOFT_VERTEX_RADIUS = 0.01f;
/// Declared: no dihedral bend is stiffer than Jolt's solver resolves: its compliance is at least this
/// share of the solver's own over the four vertices it bends at rest, `h²·Σ wᵢ|∇Cᵢ|²` for a substep
/// `h`, so it corrects at most five sixths of the angle it is off within a substep. A stiffer one
/// overshoots: under a load in the cloth's own plane its triangles fold through each other and its
/// bends throw them out of it every substep — the cooked flag's 0.001 rad/(N·m) on vertices of
/// 0.7 g flapped at 10 to 25 m/s, then ran away. Floored, that flag's bends give at least 1.5 to
/// 16 rad/(N·m) (squares of 6 cm, at 60 Hz) and it comes to rest; a cloth clamped along an edge and
/// bent stiff still stands out (its tip 0.28 m down over 0.8 m, 0.22 unfloored). A softer bend is
/// kept as declared.
constexpr float SOFT_BEND_FLOOR = 0.2f;
/// Declared: a soft body diverged when its vertices go apart at `SOFT_APART` times the speed of its
/// swing `SOFT_HELD` seconds without a break — the spread of their velocities: a body falling whole
/// is never one, nor one whose solver only jitters —, or when its bounds spread past `SOFT_SPREAD`
/// times their diagonal at rest while one of its edges is pulled past `SOFT_TORN` times its rest
/// length: a rope coiled at rest hangs out to its length with its edges whole, a body gone wrong
/// tears them (a rope stretched by its greatest give reaches 1.4, a volume at its most pressure
/// 1.03). It is brought back to its last good state (`recover`) and named (`jolt_recovered`).
constexpr float SOFT_HELD = 0.5f, SOFT_APART = 2, SOFT_SPREAD = 3, SOFT_TORN = 5;
/// Declared: a soft body's state is kept every `SOFT_KEPT` seconds while it is calm — its
/// velocities spread under half the speed it diverges at, and its edges under half the pull that
/// tears them once its bounds pass `SOFT_SPREAD` times their rest diagonal —; the older of the last
/// two, a quarter to half a second before it diverged, is the good state it is brought back to
/// (`recover`).
constexpr float SOFT_KEPT = 0.25f;
/// Declared: brought back, a soft body is calmed this many seconds — damped so that it falls no
/// faster than a quarter of its mean edge per step (`SOFT_CALM_EDGE`), 0.5 m/s for edges of 3.4 cm
/// at 60 Hz — where Jolt's collision planes, found once per step, still hold its vertices: a fine
/// cloth laid over an edge, which Jolt's solver throws apart, then settles instead of diverging
/// again from the same state.
constexpr float SOFT_CALM = 2, SOFT_CALM_EDGE = 0.25f;
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
  /** Written at the last step: once it rests, it is written one last time. */
  bool awake = true;
  /** The diagonal of its rest bounds in Jolt's frame of its vertices, m: its size, which its speed
   *  and its spread are held to (`SOFT_FALL`, `SOFT_SPREAD`). */
  float rest = 0;
  /** The mean rest length of its edges, m, its own damping, per second, and the seconds it is
   *  still calmed for since it was brought back (`SOFT_CALM`). */
  float edge = 0, damping = 0, calm = 0;
  /** Under its pull now (`hold`): the spread of its vertices' velocities past which they go apart,
   *  m/s (`SOFT_APART` times its swing). */
  float apart = 0;
  /** Seconds its vertices have gone apart at `apart` without a break. */
  float held = 0;
  /** Counts its placements: a support judged, or a state kept, at an older one is out of date. */
  uint32_t placed = 0;
  /** Its last two good states (`SOFT_KEPT`), the world places of its vertices, the older first;
   *  how many it kept since its placement `kept`, and the seconds since the newer. */
  std::vector<Float3> good[2];
  uint32_t goods = 0, kept = 0;
  float since = 0;
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

/// Floors each dihedral bend of `shared` at the stiffest Jolt's solver resolves over a substep of
/// `h` seconds (`SOFT_BEND_FLOOR`).
void floorBends(SoftBodySharedSettings &shared, float h) {
  for (SoftBodySharedSettings::DihedralBend &b : shared.mDihedralBendConstraints) {
    const auto at = [&](int k) { return Vec3(shared.mVertices[b.mVertex[k]].mPosition); };
    const Vec3 x0 = at(0), x1 = at(1), x2 = at(2), x3 = at(3), e = x1 - x0;
    const float length = e.Length();
    Vec3 n1 = (x2 - x0).Cross(x2 - x1), n2 = (x3 - x1).Cross(x3 - x0);
    if (length < 1e-6f || n1.LengthSq() * n2.LengthSq() < 1e-24f) continue;
    // Its gradient as Jolt takes it (`SoftBodyMotionProperties::ApplyDihedralBendConstraints`).
    n1 /= n1.LengthSq();
    n2 /= n2.LengthSq();
    const Vec3 d0 = ((x2 - x1).Dot(e) * n1 + (x3 - x1).Dot(e) * n2) / length, d2 = length * n1, d3 = length * n2;
    const Vec3 gradient[4] = {d0, -d0 - d2 - d3, d2, d3};
    float own = 0;
    for (int k = 0; k < 4; ++k) own += shared.mVertices[b.mVertex[k]].mInvMass * gradient[k].LengthSq();
    b.mCompliance = std::max(b.mCompliance, SOFT_BEND_FLOOR * own * h * h);
  }
}

/// The mean rest length of the edges of `shared`, m (0 with none).
float meanEdge(const SoftBodySharedSettings &shared) {
  float sum = 0;
  for (const SoftBodySharedSettings::Edge &e : shared.mEdgeConstraints) sum += e.mRestLength;
  return shared.mEdgeConstraints.empty() ? 0 : sum / float(shared.mEdgeConstraints.size());
}

/// The pull a soft body's bounds are reckoned with, m/s²: the gravity times its scale, never less
/// than Earth's.
float pullOf(const MotionProperties &motion) {
  return std::max(world().system->GetGravity().Length() * std::abs(motion.GetGravityFactor()), STANDARD_GRAVITY);
}

/// Holds `soft` to the pull it is under now: the spread of its velocities past which its vertices
/// go apart (`diverges`), and the speed Jolt holds each of its vertices under — the faster of its
/// swing (`SOFT_FALL`) and its fall through its own damping, `pull / damping` (Jolt's own bound
/// with none): neither a body falling whole nor its swing is ever held back.
void hold(Soft &soft, Body &body) {
  auto &motion = *static_cast<SoftBodyMotionProperties *>(body.GetMotionProperties());
  const float pull = pullOf(motion);
  const float swing = std::sqrt(2 * pull * SOFT_FALL * soft.rest);
  soft.apart = SOFT_APART * swing;
  const float damping = motion.GetLinearDamping();
  motion.SetMaxLinearVelocity(std::max(swing, damping > 0 ? pull / damping : JOLT_FASTEST));
}

/// Damps `soft` by its own damping, or, `calmed`, by at least the one that holds its fall to
/// `SOFT_CALM_EDGE` of its mean edge per step of the page (`World::fixedStep`); held again to its
/// pull (`hold`).
void calm(Soft &soft, Body &body, bool calmed) {
  auto &motion = *static_cast<SoftBodyMotionProperties *>(body.GetMotionProperties());
  const float settles = pullOf(motion) * world().fixedStep / (SOFT_CALM_EDGE * std::max(soft.edge, 1e-4f));
  motion.SetLinearDamping(calmed ? std::max(soft.damping, settles) : soft.damping);
  hold(soft, body);
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

/// Brings `soft` back to its rest shape, at rest: where its pins hold it, or, with none, around its
/// centre of mass, which no force within it moves however it diverged; `placed`, where the page
/// placed it. Jolt's bounds follow at the next step.
void bringBack(const Soft &soft, Body &body, bool placed = false) {
  auto &motion = *static_cast<SoftBodyMotionProperties *>(body.GetMotionProperties());
  const SoftBodySharedSettings &shared = *motion.GetSettings();
  Array<SoftBodyVertex> &vertices = motion.GetVertices();
  const Quat turn = soft.inverse.Conjugated();
  const RMat44 com = body.GetCenterOfMassTransform();
  // Where the rest shape goes: its pins' place, or its centre of mass on the one it has now.
  Vec3 from = soft.origin, now = Vec3::sZero(), rest = Vec3::sZero();
  float mass = 0;
  bool pinned = false;
  for (size_t i = 0; i < vertices.size() && !pinned; ++i) {
    pinned = vertices[i].mInvMass == 0;
    const float m = pinned ? 0 : 1 / vertices[i].mInvMass;
    now += m * vertices[i].mPosition;
    rest += m * (turn * Vec3(shared.mVertices[i].mPosition));
    mass += m;
  }
  if (!placed && !pinned && mass > 0) from = (Vec3(com * (now / mass)) - rest / mass);
  const RMat44 back = com.InversedRotationTranslation();
  for (size_t i = 0; i < vertices.size(); ++i) {
    SoftBodyVertex &v = vertices[i];
    v.mPreviousPosition = v.mPosition = Vec3(back * RVec3(from + turn * Vec3(shared.mVertices[i].mPosition)));
    v.mVelocity = Vec3::sZero();
  }
}

/// Brings `soft` back at rest to its last good state (`keep`), the older of the last two kept at
/// its placement, or, with none, to its rest shape (`bringBack`), and calms it `SOFT_CALM` seconds
/// (`calm`). Kept again from there.
void recover(Soft &soft, Body &body) {
  soft.since = 0;
  soft.calm = SOFT_CALM;
  calm(soft, body, true);
  if (soft.goods == 0 || soft.kept != soft.placed) return bringBack(soft, body);
  Array<SoftBodyVertex> &vertices = static_cast<SoftBodyMotionProperties *>(body.GetMotionProperties())->GetVertices();
  const RMat44 back = body.GetCenterOfMassTransform().InversedRotationTranslation();
  const std::vector<Float3> &good = soft.good[0];
  for (size_t i = 0; i < vertices.size(); ++i) {
    SoftBodyVertex &v = vertices[i];
    v.mPreviousPosition = v.mPosition = Vec3(back * RVec3(Vec3(good[i])));
    v.mVelocity = Vec3::sZero();
  }
  soft.good[1] = good;
}

/// Counts down the calm of `soft` (`recover`) over a step of `dt` seconds: once over, its own
/// damping again.
void settle(Soft &soft, Body &body, float dt) {
  if (soft.calm > 0 && (soft.calm -= dt) <= 0) calm(soft, body, false);
}

/// A soft body's step as its vertices measure it: the bounds of their velocities and of their
/// places.
struct Gauge {
  AABox speeds, spread;
  void add(const SoftBodyVertex &v) {
    speeds.Encapsulate(v.mVelocity);
    spread.Encapsulate(v.mPosition);
  }
  void measure(const Body &body) {
    for (const SoftBodyVertex &v : static_cast<const SoftBodyMotionProperties *>(body.GetMotionProperties())->GetVertices()) add(v);
  }
};

/// Whether one of the edges of `body`, a soft body, is pulled past `ratio` times its rest length.
bool stretched(const Body &body, float ratio) {
  const auto &motion = *static_cast<const SoftBodyMotionProperties *>(body.GetMotionProperties());
  const Array<SoftBodyVertex> &vertices = motion.GetVertices();
  for (const SoftBodySharedSettings::Edge &e : motion.GetSettings()->mEdgeConstraints) {
    const float most = ratio * e.mRestLength;
    if ((vertices[e.mVertex[0]].mPosition - vertices[e.mVertex[1]].mPosition).LengthSq() > most * most) return true;
  }
  return false;
}

/// Whether `soft`, its body `body`, spread out of its size by `gauge`: its bounds past
/// `SOFT_SPREAD` times their rest diagonal with an edge pulled past `ratio` times its rest length
/// (its edges measured only then).
bool spreads(const Soft &soft, const Body &body, const Gauge &gauge, float ratio) {
  return gauge.spread.GetSize().Length() > SOFT_SPREAD * soft.rest && stretched(body, ratio);
}

/// Whether `soft`, its body `body` measured by `gauge` after a step of `dt` seconds, diverged on
/// amplitude: its vertices going apart at `Soft::apart` `SOFT_HELD` seconds, or its bounds spread
/// out of its size with an edge torn (`SOFT_TORN`). Named so.
bool diverges(Soft &soft, const Body &body, const Gauge &gauge, float dt) {
  soft.held = gauge.speeds.GetSize().Length() >= soft.apart ? soft.held + dt : 0;
  if (soft.held < SOFT_HELD && !spreads(soft, body, gauge, SOFT_TORN)) return false;
  soft.held = 0;
  world().recovered.push_back(soft.engine);
  return true;
}

/// Keeps the state of `soft`, measured by `gauge` after a step of `dt` seconds, as its newer good
/// one when it is calm and its last is `SOFT_KEPT` old or kept at another placement.
void keep(Soft &soft, const Body &body, const Gauge &gauge, float dt) {
  soft.since += dt;
  if (soft.kept != soft.placed) soft.goods = 0;
  if (soft.goods > 0 && soft.since < SOFT_KEPT) return;
  if (!(gauge.speeds.GetSize().Length() < soft.apart / 2) || spreads(soft, body, gauge, SOFT_TORN / 2)) return;
  const auto &vertices = static_cast<const SoftBodyMotionProperties *>(body.GetMotionProperties())->GetVertices();
  std::swap(soft.good[0], soft.good[1]);
  std::vector<Float3> &good = soft.good[1];
  good.resize(vertices.size());
  const RMat44 com = body.GetCenterOfMassTransform();
  for (size_t i = 0; i < vertices.size(); ++i) Vec3(com * vertices[i].mPosition).StoreFloat3(&good[i]);
  if (soft.goods == 0) soft.good[0] = good;
  soft.goods = std::min(soft.goods + 1, 2u);
  soft.kept = soft.placed;
  soft.since = 0;
}

/// Writes the vertices of `soft` into `state` from word `start` (`SOFT_STATE_WORDS`), each in its
/// geometry's frame, measured into `gauge` when given; false when one is not finite.
bool written(const Soft &soft, const Body &body, size_t start, Gauge *gauge) {
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
    if (gauge) gauge->add(v);
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
  soft.edge = meanEdge(*shared);
  soft.damping = settings.mLinearDamping;
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
  soft.held = 0;
  BodyLockWrite lock(world.system->GetBodyLockInterfaceNoLock(), slot.id);
  if (lock.Succeeded()) bringBack(soft, lock.GetBody(), true);
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
    if (!active && (hidden || !soft.awake)) {
      soft.awake = soft.awake || hidden;
      continue;
    }
    Gauge gauge;
    settle(soft, body, world.dt);
    if (hidden) {
      soft.awake = true;
      gauge.measure(body);
      if (diverges(soft, body, gauge, world.dt)) recover(soft, body);
      else keep(soft, body, gauge, world.dt);
      continue;
    }
    soft.awake = active;
    const size_t start = state.size();
    bool finite = written(soft, body, start, active ? &gauge : nullptr);
    // Brought back to a good state, it is written where it now is.
    if (active && diverges(soft, body, gauge, world.dt)) {
      recover(soft, body);
      state.resize(start);
      finite = written(soft, body, start, nullptr);
    } else if (active && finite)
      keep(soft, body, gauge, world.dt);
    // A diverged body sends no vertex: it leaves the simulation after the step (`jolt_step`).
    if (!finite) {
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
