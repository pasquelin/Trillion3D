// Buoyancy, batched: `jolt_water_query` lists the pieces of the awake bodies that reach the water,
// the module fits each piece its own water plane from the waves (`waterPlanes.cpp`), and one BUOYANCY command
// pushes every body at its pieces' centre of buoyancy, each piece measured exactly (`submerged.h`).
// A piece is a compound's sub-shape, a slice of a single shape longer than the slice length, or
// the whole body. Word layouts:
// `packages/sdk-core/src/physics/layout.ts` (WATER_PIECE_WORDS, BUOYANCY_WORDS, PLANE_WORDS).
#include "binding.h"
#include "submerged.h"
#include "words.h"

#include <Jolt/Physics/Body/Body.h>
#include <Jolt/Physics/Body/BodyLock.h>
#include <Jolt/Physics/Collision/Shape/CompoundShape.h>

#include <algorithm>
#include <cmath>

using namespace JPH;

namespace trillion {

namespace {

constexpr uint32_t MAX_SLICES = 4;

/** A piece of a body's shape, from its centre of mass: sub-shape `index` of the compound it is
 *  (under its decorators), else slice `index` of `count` across the longest side of its bounds —
 *  the shape whole, cut by its two `slab` sides —; its placement, its scale, its bounds. */
struct Piece {
  const Shape *shape;
  Mat44 place;
  Vec3 scale;
  Cut slab[2];
  uint32_t cuts;
  AABox bounds;
};

std::vector<uint32_t> pieces;
BodyIDVector awake;

/** Piece `index` of `count` of a body's `shape`. */
Piece pieceOf(const Shape &shape, uint32_t index, uint32_t count) {
  Mat44 place = Mat44::sIdentity();
  Vec3 scale = Vec3::sOne();
  if (const Shape *compound = compoundOf(shape, place, scale)) {
    const CompoundShape::SubShape &sub = static_cast<const CompoundShape *>(compound)->GetSubShape(index);
    Mat44 at = place * sub.GetLocalTransformNoScale(scale);
    Vec3 size = sub.TransformScale(scale);
    return {sub.mShape.GetPtr(), at, size, {}, 0, sub.mShape->GetLocalBounds().Scaled(size).Transformed(at)};
  }
  AABox bounds = shape.GetLocalBounds();
  Piece piece{&shape, Mat44::sIdentity(), Vec3::sOne(), {}, 0, bounds};
  if (count == 1) return piece;
  int k = bounds.GetSize().GetHighestComponentIndex();
  float lo = bounds.mMin[k], step = bounds.GetSize()[k] / float(count);
  float from = lo + step * float(index), to = index + 1 == count ? bounds.mMax[k] : lo + step * float(index + 1);
  Vec3 axis = Vec3::sZero();
  axis.SetComponent(k, 1.0f);
  piece.slab[0] = {-axis, from}, piece.slab[1] = {axis, -to}, piece.cuts = 2;
  piece.bounds.mMin.SetComponent(k, from), piece.bounds.mMax.SetComponent(k, to);
  return piece;
}

/** The pieces of a body's `shape`: a compound's sub-shapes, else slices `sliceLength` long at most
 *  (`MAX_SLICES` of them) across the longest side of its bounds, when it can be cut so. */
uint32_t countOf(const Shape &shape, float sliceLength) {
  Mat44 place = Mat44::sIdentity();
  Vec3 scale = Vec3::sOne();
  if (const Shape *compound = compoundOf(shape, place, scale))
    return static_cast<const CompoundShape *>(compound)->GetNumSubShapes();
  Vec3 size = shape.GetLocalBounds().GetSize(), axis = Vec3::sZero();
  axis.SetComponent(size.GetHighestComponentIndex(), 1.0f);
  if (sliceLength <= 0 || !sliceable(shape, axis)) return 1;
  return std::clamp(uint32_t(std::ceil(size.ReduceMax() / sliceLength)), 1u, MAX_SLICES);
}

/** The engine slot of an engine id, when that id is still the slot's body. */
const Slot *slotOf(uint32_t engine) {
  World &world = trillion::world();
  uint32_t index = engine & INDEX_MASK;
  if (index >= world.slots.size()) return nullptr;
  const Slot &slot = world.slots[index];
  return slot.used && slot.engine == engine && !(slot.flags & SENSOR) ? &slot : nullptr;
}

}  // namespace

uint32_t runBuoyancy(const uint32_t *w) {
  World &world = trillion::world();
  uint32_t count = w[1];
  float density = f32(w + 2), linearDrag = f32(w + 3), angularDrag = f32(w + 4);
  Vec3 current = vec3(w + 5), gravity = world.system->GetGravity();
  const BodyLockInterfaceNoLock &locks = world.system->GetBodyLockInterfaceNoLock();
  const uint32_t *plane = w + BUOYANCY_WORDS, *end = plane + count * PLANE_WORDS;
  // A body's records are consecutive: its pieces' volumes are summed, and since every push is
  // along gravity, their sum at the volume-weighted centre is each piece pushed at its own.
  while (plane < end) {
    uint32_t engine = plane[0];
    const Slot *slot = slotOf(engine);
    Body *body = slot && world.stepping ? locks.TryGetBody(slot->id) : nullptr;
    Submerged sums;
    for (; plane < end && plane[0] == engine; plane += PLANE_WORDS) {
      if (!body || !body->IsDynamic()) continue;
      const Shape *shape = body->GetShape();
      uint32_t index = plane[1] & 0xFFFFu, pieces = plane[1] >> 16;
      // A stale record (the body's shape changed since the query) names no piece of it.
      Mat44 place = Mat44::sIdentity();
      Vec3 scale = Vec3::sOne();
      const Shape *compound = compoundOf(*shape, place, scale);
      uint32_t limit = compound ? countOf(*shape, 0) : MAX_SLICES;
      if (index >= pieces || pieces > limit) continue;
      Piece piece = pieceOf(*shape, index, pieces);
      // The water's space: the body's centre of mass at its origin, the world's axes.
      Quat turn = body->GetRotation();
      Vec3 up = vec3(plane + 5).NormalizedOr(Vec3::sAxisY());
      Cut water{up, -up.Dot(Vec3(vec3(plane + 2) - body->GetCenterOfMassPosition()))};
      Cut slab[2] = {{turn * piece.slab[0].normal, piece.slab[0].constant}, {turn * piece.slab[1].normal, piece.slab[1].constant}};
      trillion::submerged(*piece.shape, Mat44::sRotation(turn) * piece.place, piece.scale, water, slab, piece.cuts, sums);
    }
    if (!body || sums.volume <= 0 || sums.total <= 0) continue;
    // Every piece measured exactly (`submerged.h`): their volumes are the body's.
    Vec3 centre = sums.moment / sums.volume;
    // Jolt's buoyancy factor is the fluid's density over the body's: `density` is the water's.
    float factor = density * sums.total * body->GetMotionProperties()->GetInverseMass();
    body->ApplyBuoyancyImpulse(sums.total, sums.volume, centre, factor, linearDrag, angularDrag, current,
                               gravity, world.fixedStep);
  }
  return BUOYANCY_WORDS + count * PLANE_WORDS;
}

}  // namespace trillion

using trillion::world;

extern "C" {

/// Lists, in engine-slot order, the pieces of the awake dynamic bodies whose bounds reach below
/// `top` (the water's highest crest): per piece `engine id, index | count << 16, x, z, half x, half
/// z` (its centre and its horizontal half extents, world space). Returns the piece count; the
/// words are read at `jolt_water_pieces` until the next query.
uint32_t jolt_water_query(float top, float sliceLength) {
  trillion::World &w = world();
  w.system->GetActiveBodies(EBodyType::RigidBody, trillion::awake);
  std::sort(trillion::awake.begin(), trillion::awake.end(),
            [&](BodyID a, BodyID b) { return w.engineOf[a.GetIndex()] < w.engineOf[b.GetIndex()]; });
  trillion::pieces.clear();
  const BodyLockInterfaceNoLock &locks = w.system->GetBodyLockInterfaceNoLock();
  for (BodyID id : trillion::awake) {
    const Body *body = locks.TryGetBody(id);
    uint32_t engine = w.engineOf[id.GetIndex()];
    if (!body || !body->IsDynamic() || !trillion::slotOf(engine) ||
        body->GetWorldSpaceBounds().mMin.GetY() >= top)
      continue;
    const Shape &shape = *body->GetShape();
    uint32_t count = trillion::countOf(shape, sliceLength);
    Mat44 com = body->GetCenterOfMassTransform();
    for (uint32_t i = 0; i < count; ++i) {
      AABox box = trillion::pieceOf(shape, i, count).bounds.Transformed(com);
      Vec3 centre = box.GetCenter(), half = box.GetExtent();
      float floats[4] = {centre.GetX(), centre.GetZ(), half.GetX(), half.GetZ()};
      uint32_t words[trillion::WATER_PIECE_WORDS] = {engine, i | count << 16};
      std::memcpy(words + 2, floats, sizeof(floats));
      trillion::pieces.insert(trillion::pieces.end(), words, words + trillion::WATER_PIECE_WORDS);
    }
  }
  return uint32_t(trillion::pieces.size() / trillion::WATER_PIECE_WORDS);
}

uint32_t *jolt_water_pieces() { return trillion::pieces.data(); }

}  // extern "C"
