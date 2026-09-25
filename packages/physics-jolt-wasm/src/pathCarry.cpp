// A frictionless path does no work on the body it carries. Jolt holds the body on its path by
// cutting, at each step, the velocity across the tangent where the body stands; but a body leaves
// each step along the tangent of the point it started from, so on a bend the cut takes the share
// 1 − cos dθ of its speed, dθ = v·dt / R the step's turn: v²·dt / R² of its kinetic energy per
// second, 4 % a second at 20 m/s on a 13 m loop at 60 Hz, and half as much at twice the rate.
// After each step, the body's velocity is turned from the tangent it was held along to the one
// where it now stands, its speed kept: the bend turns the body and takes nothing from it.
#include "joints.h"

#include <Jolt/Physics/Body/Body.h>
#include <Jolt/Physics/Constraints/PathConstraint.h>

using namespace JPH;

namespace trillion {

namespace {

/// The path's tangent at `fraction`, in the world.
Vec3 tangentAt(const PathConstraint &joint, float fraction) {
  Vec3 point, tangent, normal, binormal;
  joint.GetPath()->GetPointOnPath(fraction, point, tangent, normal, binormal);
  Vec3 local = joint.GetConstraintToBody1Matrix().Multiply3x3(tangent);
  return (joint.GetBody1()->GetRotation() * local).NormalizedOr(Vec3::sZero());
}

}  // namespace

float pathFraction(const Constraint *constraint) {
  auto *joint = static_cast<const PathConstraint *>(constraint);
  RMat44 path = joint->GetBody1()->GetCenterOfMassTransform() * joint->GetConstraintToBody1Matrix();
  RVec3 at = joint->GetBody2()->GetCenterOfMassTransform() * joint->GetConstraintToBody2Matrix().GetTranslation();
  return joint->GetPath()->GetClosestPoint(Vec3(path.InversedRotationTranslation() * at), joint->GetPathFraction());
}

void carryAlongPath(Constraint *constraint, float before) {
  auto *joint = static_cast<PathConstraint *>(constraint);
  Body &body = *joint->GetBody2();
  // A path on a moving body carries its body at their relative velocity: not turned here.
  if (!joint->GetBody1()->IsStatic() || !body.IsDynamic() || !body.IsActive()) return;
  Vec3 from = tangentAt(*joint, before), to = tangentAt(*joint, pathFraction(constraint));
  Vec3 v = body.GetLinearVelocity();
  if (to.IsNearZero()) return;
  // Only a velocity the path held, along the tangent it held it along (not a spinning body's
  // centre, off its point on the path).
  if ((v - from * v.Dot(from)).LengthSq() > 1e-6f * v.LengthSq()) return;
  body.SetLinearVelocityClamped(Quat::sFromTo(from, to) * v);
}

}  // namespace trillion
