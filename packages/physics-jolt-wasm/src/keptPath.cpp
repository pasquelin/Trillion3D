// A path joint whose bend does no work. Jolt holds the body on its path by cutting, each step, the
// velocity across the tangent where the body stands; but a body leaves each step along the tangent
// of the point it started from, so on a bend the cut takes the share 1 − cos dθ of its speed,
// dθ = v·dt / R the step's turn: v²·dt / R² of its kinetic energy per second, 4 % a second at
// 20 m/s on a 13 m loop at 60 Hz. Here the path's own warm start turns the velocity the body
// ended its last step with, held along the last tangent, onto the tangent where it now stands,
// its speed kept, before the solver cuts anything: a frictionless bend turns the body and takes
// nothing from it. What came since — this step's gravity, damping and forces, a velocity the page
// set — is added as it is: Jolt applies gravity before the solve, so the velocity the step starts
// from is no longer along any tangent. The warm start runs in the body's island, after gravity;
// the velocity setup would race gravity on another thread. Jolt's `PathConstraint` (final) solves
// everything else; this constraint is the one the world holds.
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
    next = tangentAt(path->GetPathFraction());
  }
  void WarmStartVelocityConstraint(float ratio) override {
    Body &body = *mBody2;
    // A path on a moving body carries its body at their relative velocity: not turned here. Only a
    // velocity the path held, along the tangent it held it along (not a spinning body's centre
    // off its point on the path).
    if (ended && mBody1->IsStatic() && body.IsDynamic() && !held.IsNearZero() && !next.IsNearZero() &&
        (end - held * end.Dot(held)).LengthSq() <= 1e-6f * end.LengthSq())
      body.SetLinearVelocityClamped(body.GetLinearVelocity() + Quat::sFromTo(held, next) * end - end);
    held = next;
    ended = false;
    path->WarmStartVelocityConstraint(ratio);
  }
  bool SolveVelocityConstraint(float dt) override { return path->SolveVelocityConstraint(dt); }
  bool SolvePositionConstraint(float dt, float baumgarte) override {
    // After the velocity solve: the velocity the body ends the step with.
    end = mBody2->GetLinearVelocity();
    ended = true;
    return path->SolvePositionConstraint(dt, baumgarte);
  }
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
  /// The tangent the last step held the body along, and the one this step holds it along.
  Vec3 held = Vec3::sZero(), next = Vec3::sZero();
  /// The velocity the body ended the last step with, and whether the last step solved its position
  /// since the last warm start (none with no position step): no turn without it.
  Vec3 end = Vec3::sZero();
  bool ended = false;
};

}  // namespace

Ref<TwoBodyConstraint> keptPath(TwoBodyConstraint *made, const TwoBodyConstraintSettings &settings) {
  return new KeptPath(static_cast<PathConstraint *>(made), settings);
}

PathConstraint &pathOf(Constraint *constraint) { return *static_cast<KeptPath *>(constraint)->path; }

}  // namespace trillion
