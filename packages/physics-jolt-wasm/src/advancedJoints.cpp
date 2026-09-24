// The advanced joints: Jolt's own swing-twist, six-DOF, path, pulley, gear and rack-and-pinion
// constraints, built from the JOINT command's words and its kind's own (layout.ts JOINT), driven
// by their motors and weighed against their break force. `joints.cpp` makes, keeps and breaks them.
#include "joints.h"
#include "words.h"

#include <Jolt/Physics/Constraints/GearConstraint.h>
#include <Jolt/Physics/Constraints/PathConstraint.h>
#include <Jolt/Physics/Constraints/PathConstraintPathHermite.h>
#include <Jolt/Physics/Constraints/PulleyConstraint.h>
#include <Jolt/Physics/Constraints/RackAndPinionConstraint.h>
#include <Jolt/Physics/Constraints/SixDOFConstraint.h>
#include <Jolt/Physics/Constraints/SwingTwistConstraint.h>

#include <algorithm>
#include <cmath>

using namespace JPH;

namespace trillion {

namespace {

/// A six-DOF axis's limits: ±∞ as Jolt's free (±FLT_MAX), a turn's finite limits within ±π.
void limitAxis(SixDOFConstraintSettings &s, int axis, float min, float max) {
  min = Clamp(min, -FLT_MAX, FLT_MAX), max = Clamp(max, -FLT_MAX, FLT_MAX);
  bool free = min == -FLT_MAX && max == FLT_MAX;
  if (axis >= SixDOFConstraintSettings::RotationX && !free && min <= max)
    min = Clamp(min, -JPH_PI, JPH_PI), max = Clamp(max, min, JPH_PI);
  s.mLimitMin[axis] = min, s.mLimitMax[axis] = max;
}

/// A path from its words: `loop, follow, count`, then per point `position, tangent, normal` in
/// the first body's own frame; null under two points.
Ref<PathConstraintPathHermite> pathOf(const uint32_t *extra, uint32_t count) {
  uint32_t points = count >= 3 ? uint32_t(f32(extra + 2)) : 0;
  if (points < 2 || count < 3 + points * 9) return nullptr;
  Ref<PathConstraintPathHermite> path = new PathConstraintPathHermite;
  path->SetIsLooping(f32(extra) != 0);
  for (uint32_t i = 0; i < points; ++i) {
    const uint32_t *p = extra + 3 + i * 9;
    path->AddPoint(vec3(p), vec3(p + 3), vec3(p + 6));
  }
  return path;
}

}  // namespace

Ref<TwoBodyConstraintSettings> advancedSettings(uint32_t kind, const Frame &f1, const Frame &f2, const uint32_t *v,
                                                const uint32_t *extra, uint32_t count, Vec3 anchor1) {
  float min = f32(v), max = f32(v + 1);
  float ratio = count > 0 && std::isfinite(f32(extra)) ? f32(extra) : 1.0f;
  switch (kind) {
    case SWING_TWIST: {
      auto *s = new SwingTwistConstraintSettings;
      s->mSpace = EConstraintSpace::LocalToBodyCOM;
      s->mPosition1 = RVec3(f1.point), s->mPosition2 = RVec3(f2.point);
      s->mTwistAxis1 = f1.axis, s->mPlaneAxis1 = f1.normal, s->mTwistAxis2 = f2.axis, s->mPlaneAxis2 = f2.normal;
      s->mNormalHalfConeAngle = s->mPlaneHalfConeAngle = count > 0 ? Clamp(f32(extra), 0.0f, JPH_PI) : JPH_PI;
      s->mTwistMinAngle = Clamp(min, -JPH_PI, JPH_PI);
      s->mTwistMaxAngle = Clamp(max, s->mTwistMinAngle, JPH_PI);
      return s;
    }
    case SIX_DOF: {
      if (count < 12) return nullptr;
      auto *s = new SixDOFConstraintSettings;
      s->mSpace = EConstraintSpace::LocalToBodyCOM;
      s->mPosition1 = RVec3(f1.point), s->mPosition2 = RVec3(f2.point);
      s->mAxisX1 = f1.axis, s->mAxisY1 = f1.normal, s->mAxisX2 = f2.axis, s->mAxisY2 = f2.normal;
      s->mSwingType = ESwingType::Pyramid;
      for (int axis = 0; axis < SixDOFConstraintSettings::Num; ++axis)
        limitAxis(*s, axis, f32(extra + axis * 2), f32(extra + axis * 2 + 1));
      for (int axis = 0; axis < SixDOFConstraintSettings::NumTranslation; ++axis)
        s->mLimitsSpringSettings[axis] = SpringSettings(ESpringMode::FrequencyAndDamping, f32(v + 2), f32(v + 3));
      return s;
    }
    case PATH: {
      Ref<PathConstraintPathHermite> path = pathOf(extra, count);
      if (!path) return nullptr;
      auto *s = new PathConstraintSettings;
      s->mPath = path;
      s->mPathFraction = path->GetClosestPoint(anchor1, 0.0f);
      s->mRotationConstraintType =
          f32(extra + 1) != 0 ? EPathRotationConstraintType::ConstrainToPath : EPathRotationConstraintType::Free;
      return s;
    }
    case PULLEY: {
      if (count < 7) return nullptr;
      auto *s = new PulleyConstraintSettings;
      s->mSpace = EConstraintSpace::LocalToBodyCOM;
      // Jolt's first body is the page's `b`: its rope runs over the second wheel.
      s->mBodyPoint1 = RVec3(f1.point), s->mFixedPoint1 = RVec3(vec3(extra + 4));
      s->mBodyPoint2 = RVec3(f2.point), s->mFixedPoint2 = RVec3(vec3(extra + 1));
      s->mRatio = std::max(ratio, 1e-3f);
      s->mMinLength = Clamp(min, 0.0f, FLT_MAX);
      s->mMaxLength = Clamp(max, s->mMinLength, FLT_MAX);
      return s;
    }
    case GEAR: {
      auto *s = new GearConstraintSettings;
      s->mSpace = EConstraintSpace::LocalToBodyCOM;
      s->mHingeAxis1 = f1.axis, s->mHingeAxis2 = f2.axis;
      s->mRatio = ratio;
      return s;
    }
    default: {  // RACK_AND_PINION: made with the pinion, the page's `a`, as Jolt's first body.
      auto *s = new RackAndPinionConstraintSettings;
      s->mSpace = EConstraintSpace::LocalToBodyCOM;
      s->mHingeAxis = f2.axis, s->mSliderAxis = f1.axis;
      s->mRatio = ratio;
      return s;
    }
  }
}

bool driveAdvanced(Constraint *constraint, uint32_t kind, EMotorState state, float target, float limit,
                   uint32_t axis) {
  if (kind == SWING_TWIST) {
    auto *joint = static_cast<SwingTwistConstraint *>(constraint);
    joint->GetTwistMotorSettings().SetTorqueLimit(limit);
    joint->SetTwistMotorState(state);
    if (state == EMotorState::Velocity) joint->SetTargetAngularVelocityCS(Vec3(target, 0, 0));
    else if (state == EMotorState::Position) joint->SetTargetOrientationCS(Quat::sRotation(Vec3::sAxisX(), target));
    return true;
  }
  if (kind == SIX_DOF) {
    auto *joint = static_cast<SixDOFConstraint *>(constraint);
    auto driven = SixDOFConstraint::EAxis(std::min(axis, 5u));
    bool turn = driven >= SixDOFConstraint::EAxis::RotationX;
    // One motor at a time: the axis driven before stops.
    for (int other = 0; other < SixDOFConstraint::EAxis::Num; ++other)
      joint->SetMotorState(SixDOFConstraint::EAxis(other), EMotorState::Off);
    MotorSettings &motor = joint->GetMotorSettings(driven);
    turn ? motor.SetTorqueLimit(limit) : motor.SetForceLimit(limit);
    joint->SetMotorState(driven, state);
    Vec3 value = Vec3::sZero();
    value.SetComponent(driven % 3, target);
    if (state == EMotorState::Velocity) turn ? joint->SetTargetAngularVelocityCS(value) : joint->SetTargetVelocityCS(value);
    else if (state == EMotorState::Position && turn) {
      Vec3 about = Vec3::sZero();
      about.SetComponent(driven % 3, 1.0f);
      joint->SetTargetOrientationCS(Quat::sRotation(about, target));
    } else if (state == EMotorState::Position) joint->SetTargetPositionCS(value);
    return true;
  }
  if (kind == PATH) {
    auto *joint = static_cast<PathConstraint *>(constraint);
    joint->GetPositionMotorSettings().SetForceLimit(limit);
    joint->SetPositionMotorState(state);
    if (state == EMotorState::Velocity) joint->SetTargetVelocity(target);
    else if (state == EMotorState::Position) {
      const PathConstraintPath *path = joint->GetPath();
      float end = path->GetPathMaxFraction();
      joint->SetTargetPathFraction(path->IsLooping() ? target - end * std::floor(target / end) : Clamp(target, 0.0f, end));
    }
    return true;
  }
  return false;
}

float advancedPull(Constraint *constraint, uint32_t kind) {
  switch (kind) {
    case SWING_TWIST: return static_cast<SwingTwistConstraint *>(constraint)->GetTotalLambdaPosition().Length();
    case SIX_DOF: return static_cast<SixDOFConstraint *>(constraint)->GetTotalLambdaPosition().Length();
    case PATH: {
      auto *path = static_cast<PathConstraint *>(constraint);
      return path->GetTotalLambdaPosition().Length() + std::abs(path->GetTotalLambdaPositionLimits());
    }
    case PULLEY: return std::abs(static_cast<PulleyConstraint *>(constraint)->GetTotalLambdaPosition());
    case GEAR: return std::abs(static_cast<GearConstraint *>(constraint)->GetTotalLambda());
    default: return std::abs(static_cast<RackAndPinionConstraint *>(constraint)->GetTotalLambda());
  }
}

}  // namespace trillion
