// The world's joints: Jolt's own two-body constraints — fixed, point, hinge, slider, distance and
// cone — between two bodies or a body and the world, with their limits, limit springs and motors.
// A joint past its break force is taken out after the step and reported. Word layouts: layout.ts
// (JOINT, UNJOINT, MOTOR).
#include "binding.h"
#include "words.h"

#include <Jolt/Physics/Constraints/ConeConstraint.h>
#include <Jolt/Physics/Constraints/DistanceConstraint.h>
#include <Jolt/Physics/Constraints/FixedConstraint.h>
#include <Jolt/Physics/Constraints/HingeConstraint.h>
#include <Jolt/Physics/Constraints/PointConstraint.h>
#include <Jolt/Physics/Constraints/SliderConstraint.h>

#include <cmath>

using namespace JPH;

namespace trillion {

namespace {

enum Kind : uint32_t { FIXED, POINT, HINGE, SLIDER, DISTANCE, CONE };
enum Motor : uint32_t { OFF, VELOCITY, POSITION };
/// The engine id that names the world rather than a body (layout.ts MISS).
constexpr uint32_t WORLD_BODY = 0xFFFFFFFFu;

struct Joint {
  Ref<TwoBodyConstraint> constraint;
  /** The page's joint id (slot and generation), and the body slots it connects. */
  uint32_t id = 0, a = WORLD_BODY, b = WORLD_BODY, kind = 0;
  /** Newtons of pull past which it breaks; 0 never. */
  float breakForce = 0;
};

std::vector<Joint> joints;
/** This step's broken joints, by id. */
std::vector<uint32_t> broken;

/// A body's frame from the words (`point, axis, normal` in its own frame), its point moved from
/// the body's origin to its centre of mass (Jolt's `LocalToBodyCOM`); the world's frame as given.
struct Frame {
  Vec3 point, axis, normal;
};
Frame frameOf(const uint32_t *w, uint32_t engine) {
  Vec3 point = vec3(w);
  if (engine != WORLD_BODY) {
    const Slot &slot = world().slots[engine & INDEX_MASK];
    point -= world().system->GetBodyInterfaceNoLock().GetShape(slot.id)->GetCenterOfMass();
  }
  return {point, vec3(w + 3).NormalizedOr(Vec3::sAxisY()), vec3(w + 6).NormalizedOr(Vec3::sAxisX())};
}

/// The body a joint end names, or the world when it names none (`BodyID()`); false when the slot
/// holds no body (refused, or removed since): the joint is not made.
bool bodyOf(uint32_t engine, BodyID &id) {
  if (engine == WORLD_BODY) return (id = BodyID(), true);
  uint32_t index = engine & INDEX_MASK;
  const std::vector<Slot> &slots = world().slots;
  if (index >= slots.size() || !slots[index].used || slots[index].engine != engine) return false;
  return (id = slots[index].id, true);
}

/// The settings of a joint kind between two frames; `v` is `min, max, frequency, damping`.
Ref<TwoBodyConstraintSettings> settingsOf(uint32_t kind, const Frame &f1, const Frame &f2, const uint32_t *v) {
  float min = f32(v), max = f32(v + 1);
  SpringSettings spring(ESpringMode::FrequencyAndDamping, f32(v + 2), f32(v + 3));
  auto place = [&](auto *s) {
    s->mSpace = EConstraintSpace::LocalToBodyCOM;
    s->mPoint1 = RVec3(f1.point);
    s->mPoint2 = RVec3(f2.point);
    return s;
  };
  switch (kind) {
    case FIXED: {
      auto *s = place(new FixedConstraintSettings);
      s->mAxisX1 = f1.axis, s->mAxisY1 = f1.normal, s->mAxisX2 = f2.axis, s->mAxisY2 = f2.normal;
      return s;
    }
    case POINT:
      return place(new PointConstraintSettings);
    case HINGE: {
      auto *s = place(new HingeConstraintSettings);
      s->mHingeAxis1 = f1.axis, s->mNormalAxis1 = f1.normal, s->mHingeAxis2 = f2.axis, s->mNormalAxis2 = f2.normal;
      s->mLimitsMin = Clamp(min, -JPH_PI, 0.0f);
      s->mLimitsMax = Clamp(max, 0.0f, JPH_PI);
      s->mLimitsSpringSettings = spring;
      return s;
    }
    case SLIDER: {
      auto *s = place(new SliderConstraintSettings);
      s->mSliderAxis1 = f1.axis, s->mNormalAxis1 = f1.normal, s->mSliderAxis2 = f2.axis, s->mNormalAxis2 = f2.normal;
      s->mLimitsMin = Clamp(min, -FLT_MAX, 0.0f);
      s->mLimitsMax = Clamp(max, 0.0f, FLT_MAX);
      s->mLimitsSpringSettings = spring;
      return s;
    }
    case DISTANCE: {
      auto *s = place(new DistanceConstraintSettings);
      s->mMinDistance = Clamp(min, 0.0f, FLT_MAX);
      s->mMaxDistance = Clamp(max, s->mMinDistance, FLT_MAX);
      s->mLimitsSpringSettings = spring;
      return s;
    }
    default: {  // CONE
      auto *s = place(new ConeConstraintSettings);
      s->mTwistAxis1 = f1.axis, s->mTwistAxis2 = f2.axis;
      s->mHalfConeAngle = Clamp(max, 0.0f, JPH_PI);
      return s;
    }
  }
}

/// Drives a hinge (radians) or a slider (metres) by its motor: off, to a velocity or to a position,
/// with at most `maxForce` (N·m or N; 0 is no bound). Other kinds have no motor.
void drive(Joint &joint, uint32_t mode, float target, float maxForce) {
  float limit = maxForce > 0 && std::isfinite(maxForce) ? maxForce : FLT_MAX;
  EMotorState state = mode == VELOCITY ? EMotorState::Velocity : mode == POSITION ? EMotorState::Position : EMotorState::Off;
  if (joint.kind == HINGE) {
    auto *hinge = static_cast<HingeConstraint *>(joint.constraint.GetPtr());
    hinge->GetMotorSettings().SetTorqueLimit(limit);
    hinge->SetMotorState(state);
    if (mode == VELOCITY) hinge->SetTargetAngularVelocity(target);
    else if (mode == POSITION) hinge->SetTargetAngle(target);
  } else if (joint.kind == SLIDER) {
    auto *slider = static_cast<SliderConstraint *>(joint.constraint.GetPtr());
    slider->GetMotorSettings().SetForceLimit(limit);
    slider->SetMotorState(state);
    if (mode == VELOCITY) slider->SetTargetVelocity(target);
    else if (mode == POSITION) slider->SetTargetPosition(target);
  } else return;
  world().system->GetBodyInterfaceNoLock().ActivateConstraint(joint.constraint);
}

/// The linear impulse the joint gave its bodies in the last step (N·s): what holds them together.
float pull(const Joint &joint) {
  Constraint *c = joint.constraint.GetPtr();
  switch (joint.kind) {
    case FIXED: return static_cast<FixedConstraint *>(c)->GetTotalLambdaPosition().Length();
    case POINT: return static_cast<PointConstraint *>(c)->GetTotalLambdaPosition().Length();
    case HINGE: return static_cast<HingeConstraint *>(c)->GetTotalLambdaPosition().Length();
    case SLIDER: {
      auto *slider = static_cast<SliderConstraint *>(c);
      return slider->GetTotalLambdaPosition().Length() + std::abs(slider->GetTotalLambdaPositionLimits());
    }
    case DISTANCE: return std::abs(static_cast<DistanceConstraint *>(c)->GetTotalLambdaPosition());
    default: return static_cast<ConeConstraint *>(c)->GetTotalLambdaPosition().Length();
  }
}

void remove(Joint &joint) {
  if (joint.constraint) world().system->RemoveConstraint(joint.constraint);
  joint = Joint();
}

void add(const uint32_t *w) {
  uint32_t id = w[1], index = id & INDEX_MASK, kind = w[2];
  if (index >= joints.size()) joints.resize(index + 1);
  remove(joints[index]);
  BodyID a, b;
  // A body refused or gone since the page wrote the joint: the page removes the joint in turn.
  if (kind > CONE || !bodyOf(w[3], a) || !bodyOf(w[4], b) || a == b) return;
  // `b` is Jolt's first body, `a` its second: a motor, a limit and a slide measure `a` from `b`
  // (from the world when `b` names none), and Jolt solves the turn from the steadier side.
  Ref<TwoBodyConstraintSettings> settings = settingsOf(kind, frameOf(w + 14, w[4]), frameOf(w + 5, w[3]), w + 23);
  BodyInterface &bodies = world().system->GetBodyInterfaceNoLock();
  Joint &joint = joints[index];
  joint.constraint = bodies.CreateConstraint(settings, b, a);
  joint.id = id, joint.kind = kind, joint.breakForce = f32(w + 30);
  joint.a = w[3] == WORLD_BODY ? WORLD_BODY : w[3] & INDEX_MASK;
  joint.b = w[4] == WORLD_BODY ? WORLD_BODY : w[4] & INDEX_MASK;
  world().system->AddConstraint(joint.constraint);
  bodies.ActivateConstraint(joint.constraint);
  drive(joint, w[27], f32(w + 28), f32(w + 29));
}

}  // namespace

uint32_t jointCommand(const uint32_t *w) {
  uint32_t index = w[1] & INDEX_MASK;
  // A command naming a joint that broke, or never was made, is dropped.
  Joint *joint = index < joints.size() && joints[index].constraint && joints[index].id == w[1] ? &joints[index] : nullptr;
  if (w[0] == JOINT) {
    add(w);
    return JOINT_WORDS;
  }
  if (w[0] == UNJOINT) {
    if (joint) remove(*joint);
    return UNJOINT_WORDS;
  }
  if (joint) drive(*joint, w[2], f32(w + 3), f32(w + 4));
  return MOTOR_WORDS;
}

void dropJoints(uint32_t index) {
  for (Joint &joint : joints)
    if (joint.constraint && (joint.a == index || joint.b == index)) remove(joint);
}

void breakJoints(float dt) {
  broken.clear();
  if (dt <= 0) return;
  for (Joint &joint : joints)
    if (joint.constraint && joint.breakForce > 0 && pull(joint) > joint.breakForce * dt) {
      broken.push_back(joint.id);
      remove(joint);
    }
}

}  // namespace trillion

extern "C" {

/// The joints the last step broke: their count, then each joint id.
uint32_t jolt_broken_count() { return uint32_t(trillion::broken.size()); }
uint32_t jolt_broken(uint32_t i) { return trillion::broken[i]; }

}  // extern "C"
