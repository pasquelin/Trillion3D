// Where a soft body's vertices stand against its geometry and the world: the frame its vertices are
// written back in (`toGeometry`), what carries them into a body made again at another scale
// (`carryVertices`), and whether its pins start inside a static body (`startsIn`).
#pragma once

#include <Jolt/Jolt.h>

#include <Jolt/Physics/Body/Body.h>
#include <Jolt/Physics/Collision/CollidePointResult.h>
#include <Jolt/Physics/Collision/CollisionCollectorImpl.h>
#include <Jolt/Physics/SoftBody/SoftBodyMotionProperties.h>

namespace trillion {

/// World, from `body`'s centre of mass, to the geometry frame of a soft body placed at `origin`,
/// turned by `inverse⁻¹`, scaled by `inverseScale⁻¹`: scale⁻¹ · rotation⁻¹ · translation(−origin) ·
/// centre of mass.
inline JPH::Mat44 toGeometry(JPH::Vec3 inverseScale, JPH::Quat inverse, JPH::Vec3 origin, const JPH::Body &body) {
  using namespace JPH;
  return Mat44::sScale(inverseScale) * Mat44::sRotation(inverse) * Mat44::sTranslation(-origin) *
         Mat44(body.GetCenterOfMassTransform());
}

/// Carries the vertices of the soft body `from` into `to`, made from the same vertices at another
/// scale: each place and velocity taken into the old body's geometry frame (`fromGeometry`), and
/// out of it into the new one's (`toGeometry⁻¹`), so the old shape and motion go on, scaled — the
/// simulation kept across a rescale. Nothing is carried between bodies of different vertices.
inline void carryVertices(const JPH::Body &from, JPH::Mat44Arg fromGeometry, JPH::Body &to, JPH::Mat44Arg toGeometry) {
  using namespace JPH;
  const auto &was = static_cast<const SoftBodyMotionProperties *>(from.GetMotionProperties())->GetVertices();
  auto &now = static_cast<SoftBodyMotionProperties *>(to.GetMotionProperties())->GetVertices();
  if (was.size() != now.size()) return;
  const Mat44 carry = toGeometry.Inversed() * fromGeometry;
  for (size_t i = 0; i < now.size(); ++i) {
    now[i].mPreviousPosition = now[i].mPosition = carry * was[i].mPosition;
    now[i].mVelocity = carry.Multiply3x3(was[i].mVelocity);
  }
}

/// Whether `point` lies inside `shape` with a margin: it and the six points `EMBEDDED` from it
/// along the axes are all in it (Jolt's point query; a mesh by the parity of a ray). A point on a
/// surface is not: a cloth laid on a table is not inside it.
inline bool deepIn(const JPH::TransformedShape &shape, JPH::Vec3 point) {
  using namespace JPH;
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

/// Whether the cloth near a pin of a soft body placed at `origin`, turned by `turn`, starts inside `other`: the middle of an edge from a pin,
/// at rest where the soft body is placed, lies a millimetre deep in its shape (`deepIn`). Its pins
/// then hang inside that body, which would push the cloth they hold out against them at every step.
inline bool startsIn(JPH::Vec3 origin, JPH::Quat turn, const JPH::SoftBodySharedSettings &shared, const JPH::Body &other) {
  using namespace JPH;
  const TransformedShape shape = other.GetTransformedShape();
  for (const SoftBodySharedSettings::Edge &e : shared.mEdgeConstraints) {
    const SoftBodySharedSettings::Vertex &a = shared.mVertices[e.mVertex[0]], &b = shared.mVertices[e.mVertex[1]];
    if ((a.mInvMass == 0) == (b.mInvMass == 0)) continue;
    if (deepIn(shape, origin + turn * (0.5f * (Vec3(a.mPosition) + Vec3(b.mPosition))))) return true;
  }
  return false;
}

}  // namespace trillion
