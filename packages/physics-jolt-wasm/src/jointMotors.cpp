// Every joint kind's motor and pull: a hinge, slider, swing-twist, six-DOF or path driven by its
// motor; a gear or rack linked to the hinges and sliders that keep its teeth in phase; and the
// impulse each kind gave its bodies, its break force's measure. `joints.cpp` makes, keeps and
// breaks the joints; `jointSettings.cpp` builds them.
#include "binding.h"
#include "joints.h"

#include <Jolt/Physics/Constraints/ConeConstraint.h>
#include <Jolt/Physics/Constraints/DistanceConstraint.h>
#include <Jolt/Physics/Constraints/FixedConstraint.h>
#include <Jolt/Physics/Constraints/GearConstraint.h>
#include <Jolt/Physics/Constraints/HingeConstraint.h>
#include <Jolt/Physics/Constraints/PathConstraint.h>
#include <Jolt/Physics/Constraints/PointConstraint.h>
#include <Jolt/Physics/Constraints/PulleyConstraint.h>
#include <Jolt/Physics/Constraints/RackAndPinionConstraint.h>
#include <Jolt/Physics/Constraints/SixDOFConstraint.h>
#include <Jolt/Physics/Constraints/SliderConstraint.h>
#include <Jolt/Physics/Constraints/SwingTwistConstraint.h>

#include <algorithm>
#include <cmath>

using namespace JPH;

namespace trillion {

namespace {

/// Drives a joint of `kind` by its motor in `state`; false for a kind without one.
bool driveMotor(Constraint *constraint, uint32_t kind, EMotorState state, float target, float limit, uint32_t axis) {
  switch (kind) {
    case HINGE: {
      auto *hinge = static_cast<HingeConstraint *>(constraint);
      hinge->GetMotorSettings().SetTorqueLimit(limit);
      hinge->SetMotorState(state);
      if (state == EMotorState::Velocity) hinge->SetTargetAngularVelocity(target);
      else if (state == EMotorState::Position) hinge->SetTargetAngle(target);
      return true;
    }
    case SLIDER: {
      auto *slider = static_cast<SliderConstraint *>(constraint);
      slider->GetMotorSettings().SetForceLimit(limit);
      slider->SetMotorState(state);
      if (state == EMotorState::Velocity) slider->SetTargetVelocity(target);
      else if (state == EMotorState::Position) slider->SetTargetPosition(target);
      return true;
    }
    case SWING_TWIST: {
      auto *joint = static_cast<SwingTwistConstraint *>(constraint);
      joint->GetTwistMotorSettings().SetTorqueLimit(limit);
      joint->SetTwistMotorState(state);
      if (state == EMotorState::Velocity) joint->SetTargetAngularVelocityCS(Vec3(target, 0, 0));
      else if (state == EMotorState::Position) joint->SetTargetOrientationCS(Quat::sRotation(Vec3::sAxisX(), target));
      return true;
    }
    case SIX_DOF: {
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
    case PATH: {
      PathConstraint *joint = &pathOf(constraint);
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
    default: return false;
  }
}

}  // namespace

void driveJoint(Constraint *constraint, uint32_t kind, uint32_t mode, float target, float maxForce, uint32_t axis) {
  float limit = maxForce > 0 && std::isfinite(maxForce) ? maxForce : FLT_MAX;
  EMotorState state = mode == MOTOR_VELOCITY ? EMotorState::Velocity : mode == MOTOR_POSITION ? EMotorState::Position : EMotorState::Off;
  if (driveMotor(constraint, kind, state, target, limit, axis))
    world().system->GetBodyInterfaceNoLock().ActivateConstraint(constraint);
}

void linkGear(Constraint *constraint, uint32_t kind, const Constraint *first, const Constraint *second) {
  if (kind == GEAR) static_cast<GearConstraint *>(constraint)->SetConstraints(first, second);
  else static_cast<RackAndPinionConstraint *>(constraint)->SetConstraints(first, second);
}

float jointPull(Constraint *c, uint32_t kind) {
  switch (kind) {
    case FIXED: return static_cast<FixedConstraint *>(c)->GetTotalLambdaPosition().Length();
    case POINT: return static_cast<PointConstraint *>(c)->GetTotalLambdaPosition().Length();
    case HINGE: return static_cast<HingeConstraint *>(c)->GetTotalLambdaPosition().Length();
    case SLIDER: {
      auto *slider = static_cast<SliderConstraint *>(c);
      return slider->GetTotalLambdaPosition().Length() + std::abs(slider->GetTotalLambdaPositionLimits());
    }
    case DISTANCE: return std::abs(static_cast<DistanceConstraint *>(c)->GetTotalLambdaPosition());
    case CONE: return static_cast<ConeConstraint *>(c)->GetTotalLambdaPosition().Length();
    case SWING_TWIST: return static_cast<SwingTwistConstraint *>(c)->GetTotalLambdaPosition().Length();
    case SIX_DOF: return static_cast<SixDOFConstraint *>(c)->GetTotalLambdaPosition().Length();
    case PATH: {
      PathConstraint *path = &pathOf(c);
      return path->GetTotalLambdaPosition().Length() + std::abs(path->GetTotalLambdaPositionLimits());
    }
    case PULLEY: return std::abs(static_cast<PulleyConstraint *>(c)->GetTotalLambdaPosition());
    case GEAR: return std::abs(static_cast<GearConstraint *>(c)->GetTotalLambda());
    default: return std::abs(static_cast<RackAndPinionConstraint *>(c)->GetTotalLambda());
  }
}

}  // namespace trillion
