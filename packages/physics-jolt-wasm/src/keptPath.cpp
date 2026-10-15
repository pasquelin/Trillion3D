// A path joint whose bend does no work. Jolt holds the body on its path by cutting, each step, the
// velocity across the tangent where the body stands; but a body leaves each step along the tangent
// of the point it started from, so on a bend the cut takes the share 1 − cos dθ of its speed,
// dθ = v·dt / R the step's turn: v²·dt / R² of its kinetic energy per second, 4 % a second at
// 20 m/s on a 13 m loop at 60 Hz. Here the path's own velocity setup turns the velocity it held
// along the last tangent onto the tangent where the body now stands, its speed kept, before the
// solver cuts anything: a frictionless bend turns the body and takes nothing from it. Jolt's
// `PathConstraint` (final) solves everything else; this constraint is the one the world holds.
#include "joints.h"

#include <Jolt/Physics/Body/Body.h>
#include <Jolt/Physics/Constraints/PathConstraint.h>

using namespace JPH;

namespace trillion {

namespace {

class KeptPath final : public TwoBodyConstraint {
public:
  KeptPath(PathConstraint *path, const TwoBodyConstraintSettings &settings)
      : TwoBodyConstraint(*path->GetBody1(), *path->GetBody2(), settings), path(path) {}

  EConstraintSubType GetSubType() const override { return EConstraintSubType::Path; }
  void NotifyShapeChanged(const BodyID &id, Vec3Arg delta) override { path->NotifyShapeChanged(id, delta); }
  void ResetWarmStart() override { path->ResetWarmStart(); }
  void SetupVelocityConstraint(float dt) override {
    path->SetupVelocityConstraint(dt);
    Vec3 tangent = tangentAt(path->GetPathFraction());
    Body &body = *mBody2;
    // A path on a moving body carries its body at their relative velocity: not turned here. Only a
    // velocity the path held, along the tangent it held it along (not a spinning body's centre
    // off its point on the path).
    Vec3 v = body.GetLinearVelocity();
    if (mBody1->IsStatic() && body.IsDynamic() && !held.IsNearZero() && !tangent.IsNearZero() &&
        (v - held * v.Dot(held)).LengthSq() <= 1e-6f * v.LengthSq())
      body.SetLinearVelocityClamped(Quat::sFromTo(held, tangent) * v);
    held = tangent;
  }
  void WarmStartVelocityConstraint(float ratio) override { path->WarmStartVelocityConstraint(ratio); }
  bool SolveVelocityConstraint(float dt) override { return path->SolveVelocityConstraint(dt); }
  bool SolvePositionConstraint(float dt, float baumgarte) override { return path->SolvePositionConstraint(dt, baumgarte); }
#ifdef JPH_DEBUG_RENDERER
  void DrawConstraint(DebugRenderer *renderer) const override { path->DrawConstraint(renderer); }
#endif
  void SaveState(StateRecorder &stream) const override {
    TwoBodyConstraint::SaveState(stream);
    path->SaveState(stream);
  }
  void RestoreState(StateRecorder &stream) override {
    TwoBodyConstraint::RestoreState(stream);
    path->RestoreState(stream);
  }
  Ref<ConstraintSettings> GetConstraintSettings() const override { return path->GetConstraintSettings(); }
  Mat44 GetConstraintToBody1Matrix() const override { return path->GetConstraintToBody1Matrix(); }
  Mat44 GetConstraintToBody2Matrix() const override { return path->GetConstraintToBody2Matrix(); }

  /// Jolt's path joint this one solves by.
  const Ref<PathConstraint> path;

private:
  /// The path's tangent at `fraction`, in the world.
  Vec3 tangentAt(float fraction) const {
    Vec3 point, tangent, normal, binormal;
    path->GetPath()->GetPointOnPath(fraction, point, tangent, normal, binormal);
    return (mBody1->GetRotation() * path->GetConstraintToBody1Matrix().Multiply3x3(tangent)).NormalizedOr(Vec3::sZero());
  }
  /// The tangent the last step held the body along.
  Vec3 held = Vec3::sZero();
};

}  // namespace

Ref<TwoBodyConstraint> keptPath(TwoBodyConstraint *made, const TwoBodyConstraintSettings &settings) {
  return new KeptPath(static_cast<PathConstraint *>(made), settings);
}

PathConstraint &pathOf(Constraint *constraint) { return *static_cast<KeptPath *>(constraint)->path; }

}  // namespace trillion
