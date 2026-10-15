// The contact impulse estimate (`contacts.h` `normalImpulse`, `manifoldImpulse`): what a touch
// pushes with, estimated before the solver runs, for the enter events.
#include "contacts.h"

using namespace JPH;

namespace trillion {

namespace {

/// Projected Gauss–Seidel sweeps over a manifold's points: the total settles to float precision.
constexpr uint32_t IMPULSE_SWEEPS = 32;

}  // namespace

float normalImpulse(uint32_t count, const float target[MANIFOLD_POINTS], const float k[MANIFOLD_POINTS][MANIFOLD_POINTS]) {
  float lambda[MANIFOLD_POINTS] = {};
  for (uint32_t sweep = 0; sweep < IMPULSE_SWEEPS; ++sweep)
    for (uint32_t i = 0; i < count; ++i) {
      if (k[i][i] <= 0) continue;
      float residual = target[i];
      for (uint32_t j = 0; j < count; ++j) residual -= k[i][j] * lambda[j];
      lambda[i] = std::max(0.0f, lambda[i] + residual / k[i][i]);
    }
  float total = 0;
  for (uint32_t i = 0; i < count; ++i) total += lambda[i];
  return total;
}

/// The normal impulse of every point of `manifold` (`normalImpulse`), each bounced back at the
/// pair's restitution past Jolt's restitution speed, with `K_ij = m_a⁻¹ + m_b⁻¹ + (r_ai × n)·I_a⁻¹
/// (r_aj × n) + (r_bi × n)·I_b⁻¹(r_bj × n)` Jolt's non-penetration constraint's
/// (`ContactConstraintManager.cpp`, `AxisConstraintPart.h`), each point midway between the two
/// surfaces: a body's mass times its approach when it lands flat, a quarter of that when a rod
/// lands on its tip.
float manifoldImpulse(const Body &a, const Body &b, const ContactManifold &manifold, const ContactSettings &settings) {
  const uint32_t count = std::min<uint32_t>(manifold.mRelativeContactPointsOn1.size(), MANIFOLD_POINTS);
  const Vec3 normal = manifold.mWorldSpaceNormal;
  const float inverse = settings.mInvMassScale1 * inverseMass(a) + settings.mInvMassScale2 * inverseMass(b);
  const Mat44 turnA = settings.mInvInertiaScale1 * inverseInertia(a), turnB = settings.mInvInertiaScale2 * inverseInertia(b);
  const float threshold = world().system->GetPhysicsSettings().mMinVelocityForRestitution;
  Vec3 armA[MANIFOLD_POINTS], armB[MANIFOLD_POINTS];
  float target[MANIFOLD_POINTS], k[MANIFOLD_POINTS][MANIFOLD_POINTS];
  for (uint32_t i = 0; i < count; ++i) {
    RVec3 point = Real(0.5) * (manifold.GetWorldSpaceContactPointOn1(i) + manifold.GetWorldSpaceContactPointOn2(i));
    Vec3 ra = Vec3(point - a.GetCenterOfMassPosition()), rb = Vec3(point - b.GetCenterOfMassPosition());
    float speed = (a.GetPointVelocity(point) - b.GetPointVelocity(point)).Dot(normal);
    target[i] = bounced(speed, settings.mCombinedRestitution, threshold);
    armA[i] = ra.Cross(normal), armB[i] = rb.Cross(normal);
  }
  for (uint32_t i = 0; i < count; ++i)
    for (uint32_t j = 0; j < count; ++j)
      k[i][j] = inverse + armA[i].Dot(turnA.Multiply3x3(armA[j])) + armB[i].Dot(turnB.Multiply3x3(armB[j]));
  return normalImpulse(count, target, k);
}

}  // namespace trillion
