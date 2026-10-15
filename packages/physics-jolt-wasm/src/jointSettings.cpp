// The settings of every joint kind — Jolt's own fixed, point, hinge, slider, distance, cone,
// swing-twist, six-DOF, path, pulley, gear and rack-and-pinion constraints — from the JOINT
// command's words and its kind's own (layout.ts JOINT). `joints.cpp` makes, keeps and breaks them;
// `jointMotors.cpp` drives and weighs them.
#include "joints.h"
#include "words.h"

#include <Jolt/Physics/Constraints/ConeConstraint.h>
#include <Jolt/Physics/Constraints/DistanceConstraint.h>
#include <Jolt/Physics/Constraints/FixedConstraint.h>
#include <Jolt/Physics/Constraints/GearConstraint.h>
#include <Jolt/Physics/Constraints/HingeConstraint.h>
#include <Jolt/Physics/Constraints/PathConstraint.h>
#include <Jolt/Physics/Constraints/PathConstraintPathHermite.h>
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

/// Whether `x` is a whole number of turns, not 0.
bool whole(float x) { return std::isfinite(x) && std::round(x) != 0 && std::abs(x - std::round(x)) < 1e-4f; }

/// A gear's or a pulley's ratio word, 1 when there is none.
float ratioOf(const uint32_t *extra, uint32_t count) {
  return count > 0 && std::isfinite(f32(extra)) ? f32(extra) : 1.0f;
}

}  // namespace

GearOrder gearOrder(uint32_t kind, const uint32_t *extra, uint32_t count) {
  if (kind == RACK_AND_PINION) return {true, true};
  if (kind != GEAR) return {};
  float ratio = ratioOf(extra, count);
  if (whole(ratio)) return {false, true};
  return whole(1 / ratio) ? GearOrder{true, true} : GearOrder{};
}

Ref<TwoBodyConstraintSettings> jointSettings(uint32_t kind, const Frame &f1, const Frame &f2, const uint32_t *v,
                                             const uint32_t *extra, uint32_t count, Vec3 anchor1, GearOrder order) {
  float min = f32(v), max = f32(v + 1), ratio = ratioOf(extra, count);
  SpringSettings spring(ESpringMode::FrequencyAndDamping, f32(v + 2), f32(v + 3));
  // Every kind's frames are in its bodies' centre-of-mass frames; most anchor a point on each.
  auto local = [](auto *s) {
    s->mSpace = EConstraintSpace::LocalToBodyCOM;
    return s;
  };
  auto place = [&](auto *s) {
    local(s)->mPoint1 = RVec3(f1.point), s->mPoint2 = RVec3(f2.point);
    return s;
  };
  switch (kind) {
    case FIXED: {
      auto *s = place(new FixedConstraintSettings);
      s->mAxisX1 = f1.axis, s->mAxisY1 = f1.normal, s->mAxisX2 = f2.axis, s->mAxisY2 = f2.normal;
      return s;
    }
    case POINT: return place(new PointConstraintSettings);
    case HINGE: {
      auto *s = place(new HingeConstraintSettings);
      s->mHingeAxis1 = f1.axis, s->mNormalAxis1 = f1.normal, s->mHingeAxis2 = f2.axis, s->mNormalAxis2 = f2.normal;
      s->mLimitsMin = Clamp(min, -JPH_PI, 0.0f), s->mLimitsMax = Clamp(max, 0.0f, JPH_PI);
      s->mLimitsSpringSettings = spring;
      return s;
    }
    case SLIDER: {
      auto *s = place(new SliderConstraintSettings);
      s->mSliderAxis1 = f1.axis, s->mNormalAxis1 = f1.normal, s->mSliderAxis2 = f2.axis, s->mNormalAxis2 = f2.normal;
      s->mLimitsMin = Clamp(min, -FLT_MAX, 0.0f), s->mLimitsMax = Clamp(max, 0.0f, FLT_MAX);
      s->mLimitsSpringSettings = spring;
      return s;
    }
    case DISTANCE: {
      auto *s = place(new DistanceConstraintSettings);
      s->mMinDistance = Clamp(min, 0.0f, FLT_MAX), s->mMaxDistance = Clamp(max, s->mMinDistance, FLT_MAX);
      s->mLimitsSpringSettings = spring;
      return s;
    }
    case CONE: {
      auto *s = place(new ConeConstraintSettings);
      s->mTwistAxis1 = f1.axis, s->mTwistAxis2 = f2.axis;
      s->mHalfConeAngle = Clamp(max, 0.0f, JPH_PI);
      return s;
    }
    case SWING_TWIST: {
      auto *s = local(new SwingTwistConstraintSettings);
      s->mPosition1 = RVec3(f1.point), s->mPosition2 = RVec3(f2.point);
      s->mTwistAxis1 = f1.axis, s->mPlaneAxis1 = f1.normal, s->mTwistAxis2 = f2.axis, s->mPlaneAxis2 = f2.normal;
      s->mNormalHalfConeAngle = s->mPlaneHalfConeAngle = count > 0 ? Clamp(f32(extra), 0.0f, JPH_PI) : JPH_PI;
      s->mTwistMinAngle = Clamp(min, -JPH_PI, JPH_PI), s->mTwistMaxAngle = Clamp(max, s->mTwistMinAngle, JPH_PI);
      return s;
    }
    case SIX_DOF: {
      if (count < 12) return nullptr;
      auto *s = local(new SixDOFConstraintSettings);
      s->mPosition1 = RVec3(f1.point), s->mPosition2 = RVec3(f2.point);
      s->mAxisX1 = f1.axis, s->mAxisY1 = f1.normal, s->mAxisX2 = f2.axis, s->mAxisY2 = f2.normal;
      s->mSwingType = ESwingType::Pyramid;
      for (int axis = 0; axis < SixDOFConstraintSettings::Num; ++axis)
        limitAxis(*s, axis, f32(extra + axis * 2), f32(extra + axis * 2 + 1));
      for (int axis = 0; axis < SixDOFConstraintSettings::NumTranslation; ++axis) s->mLimitsSpringSettings[axis] = spring;
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
      auto *s = local(new PulleyConstraintSettings);
      // Jolt's first body is the page's `b`: its rope runs over the second wheel.
      s->mBodyPoint1 = RVec3(f1.point), s->mFixedPoint1 = RVec3(vec3(extra + 4));
      s->mBodyPoint2 = RVec3(f2.point), s->mFixedPoint2 = RVec3(vec3(extra + 1));
      s->mRatio = std::max(ratio, 1e-3f);
      s->mMinLength = Clamp(min, 0.0f, FLT_MAX), s->mMaxLength = Clamp(max, s->mMinLength, FLT_MAX);
      return s;
    }
    case GEAR: {  // Jolt holds `first turn + ratio × second turn` at 0.
      auto *s = local(new GearConstraintSettings);
      s->mHingeAxis1 = order.aFirst ? f2.axis : f1.axis, s->mHingeAxis2 = order.aFirst ? f1.axis : f2.axis;
      s->mRatio = order.aFirst ? 1 / ratio : ratio;
      return s;
    }
    default: {  // RACK_AND_PINION: made with the pinion, the page's `a`, as Jolt's first body.
      auto *s = local(new RackAndPinionConstraintSettings);
      s->mHingeAxis = f2.axis, s->mSliderAxis = f1.axis;
      s->mRatio = ratio;
      return s;
    }
  }
}

}  // namespace trillion
