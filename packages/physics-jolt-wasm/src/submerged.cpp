// The one submerged-volume integrator (`submerged.h`): the decorators and compounds walked down to
// their leaves, each leaf measured in its own frame — the planes pulled back into it, its volumes
// pushed out by the determinant of its placement, its centre by the placement itself.
#include "submerged.h"
#include "roundVolume.h"

#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/CompoundShape.h>
#include <Jolt/Physics/Collision/Shape/ConvexHullShape.h>
#include <Jolt/Physics/Collision/Shape/OffsetCenterOfMassShape.h>
#include <Jolt/Physics/Collision/Shape/RotatedTranslatedShape.h>
#include <Jolt/Physics/Collision/Shape/ScaledShape.h>

#include <cmath>
#include <vector>

using namespace JPH;

namespace trillion {

/// A polyhedral leaf clipped by cuts (`polyVolume.cpp`): its volume and its centre, in its frame.
float polyhedronVolume(const Shape &shape, const Cut *cuts, uint32_t count, Vec3 &centre);

namespace {

/// Walks `shape`'s single-child decorators as Jolt places them (its `GetSubmergedVolume`), down to
/// the first shape that is none, `transform` and `scale` brought along.
const Shape *undecorated(const Shape &shape, Mat44 &transform, Vec3 &scale) {
  const Shape *at = &shape;
  for (;;) switch (at->GetSubType()) {
      case EShapeSubType::Scaled: {
        const auto &scaled = static_cast<const ScaledShape &>(*at);
        scale = scale * scaled.GetScale(), at = scaled.GetInnerShape();
        break;
      }
      case EShapeSubType::RotatedTranslated: {
        const auto &turned = static_cast<const RotatedTranslatedShape &>(*at);
        transform = transform * Mat44::sRotation(turned.GetRotation());
        scale = turned.TransformScale(scale), at = turned.GetInnerShape();
        break;
      }
      case EShapeSubType::OffsetCenterOfMass: {
        const auto &moved = static_cast<const OffsetCenterOfMassShape &>(*at);
        transform = transform.PreTranslated(-scale * moved.GetOffset()), at = moved.GetInnerShape();
        break;
      }
      default:
        return at;
    }
}

/// `cut` taken from the water's space into the frame `place` maps from (`x' = place · x`).
Cut pulledBack(const Cut &cut, Mat44Arg place) {
  return {place.Multiply3x3Transposed(cut.normal), cut.constant + cut.normal.Dot(place.GetTranslation())};
}

/// The leaf `shape`, placed by `place` (rotation, translation and scale): within the cuts, and of
/// that under `water`, added to `out`.
void leaf(const Shape &shape, Mat44Arg place, const Cut &water, const Cut *slab, uint32_t slabCount, Submerged &out) {
  const float stretch = std::abs(place.GetDeterminant3x3());
  Cut cuts[3];
  for (uint32_t i = 0; i < slabCount; ++i) cuts[i] = pulledBack(slab[i], place);
  cuts[slabCount] = pulledBack(water, place);
  float total, volume;
  Vec3 centre;
  Round round;
  if (roundOf(shape, round)) {
    // A slab across its axis is a span of it: `from` and `to` (`sliceable` makes it so).
    float from = round.start(), to = round.start() + round.length();
    for (uint32_t i = 0; i < slabCount; ++i) {
      float along = cuts[i].normal.GetY(), at = -cuts[i].constant / along;
      along > 0 ? to = std::min(to, at) : from = std::max(from, at);
    }
    float length = cuts[slabCount].normal.Length();
    roundSubmerged(round, from, to, cuts[slabCount].normal / length, cuts[slabCount].constant / length, total,
                   volume, centre);
  } else {
    Vec3 middle;
    total = polyhedronVolume(shape, cuts, slabCount, middle);
    volume = polyhedronVolume(shape, cuts, slabCount + 1, centre);
  }
  out.total += stretch * total;
  out.volume += stretch * volume;
  out.moment += (stretch * volume) * (place * centre);
}

}  // namespace

const Shape *compoundOf(const Shape &shape, Mat44 &transform, Vec3 &scale) {
  const Shape *at = undecorated(shape, transform, scale);
  return at->GetType() == EShapeType::Compound ? at : nullptr;
}

void submerged(const Shape &shape, Mat44Arg transform, Vec3Arg scale, const Cut &water, const Cut *slab,
               uint32_t slabCount, Submerged &out) {
  Mat44 place = transform;
  Vec3 size = scale;
  const Shape *at = undecorated(shape, place, size);
  if (at->GetType() != EShapeType::Compound) return leaf(*at, place * Mat44::sScale(size), water, slab, slabCount, out);
  for (const CompoundShape::SubShape &sub : static_cast<const CompoundShape *>(at)->GetSubShapes())
    submerged(*sub.mShape, place * sub.GetLocalTransformNoScale(size), sub.TransformScale(size), water, slab, slabCount, out);
}

bool sliceable(const Shape &shape, Vec3Arg axis) {
  Mat44 place = Mat44::sIdentity();
  Vec3 size = Vec3::sOne();
  const Shape *at = undecorated(shape, place, size);
  Round round;
  if (at->GetType() == EShapeType::Compound) return false;
  if (!roundOf(*at, round)) return true;
  Vec3 across = (place * Mat44::sScale(size)).Multiply3x3Transposed(axis);
  return std::abs(across.GetX()) + std::abs(across.GetZ()) <= 1e-6f * std::abs(across.GetY());
}

}  // namespace trillion
