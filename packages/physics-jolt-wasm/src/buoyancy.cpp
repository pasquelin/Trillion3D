// Buoyancy, batched: `jolt_water_query` lists the pieces of the awake bodies that reach the water,
// the worker gives each piece its own water plane from the wave model, and one BUOYANCY command
// pushes every body at its pieces' centre of buoyancy. A piece is a compound's sub-shape, a slice
// of a single primitive longer than the slice length, or the whole body. Word layouts:
// `packages/sdk-core/src/physics/layout.ts` (WATER_PIECE_WORDS, BUOYANCY_WORDS, PLANE_WORDS).
#include "binding.h"
#include "words.h"

#include <Jolt/Physics/Body/Body.h>
#include <Jolt/Physics/Body/BodyLock.h>
#include <Jolt/Physics/Collision/Shape/CompoundShape.h>

#include <algorithm>
#include <cmath>

using namespace JPH;

namespace trillion {

namespace {

constexpr uint32_t PIECE_WORDS = 6, HEADER_WORDS = 8, PLANE_WORDS = 8, MAX_SLICES = 4;

/** A piece of a body: its shape, its transform from the body's centre of mass, its scale. */
struct Piece {
  const Shape *shape;
  Mat44 local;
  Vec3 scale;
};

std::vector<uint32_t> pieces;
BodyIDVector awake;

/** Slices of a single shape: only a primitive's volume is its local box (Jolt's ConvexShape), so
 *  a slice of it is that box scaled along its longest axis; a hull cannot be cut through Jolt. */
uint32_t slicesOf(const Shape *shape, float sliceLength) {
  if (shape->GetType() != EShapeType::Convex || shape->GetSubType() == EShapeSubType::ConvexHull ||
      sliceLength <= 0)
    return 1;
  float length = shape->GetLocalBounds().GetSize().ReduceMax();
  return std::clamp(uint32_t(std::ceil(length / sliceLength)), 1u, MAX_SLICES);
}

/** Piece `index` of `count` of a body's shape. */
Piece pieceOf(const Shape *shape, uint32_t index, uint32_t count) {
  if (shape->GetType() == EShapeType::Compound) {
    const CompoundShape::SubShape &sub = static_cast<const CompoundShape *>(shape)->GetSubShape(index);
    return {sub.mShape.GetPtr(), sub.GetLocalTransformNoScale(Vec3::sOne()), Vec3::sOne()};
  }
  if (count == 1) return {shape, Mat44::sIdentity(), Vec3::sOne()};
  AABox bounds = shape->GetLocalBounds();
  Vec3 size = bounds.GetSize(), scale = Vec3::sOne(), at = bounds.GetCenter();
  int axis = size.GetHighestComponentIndex();
  scale.SetComponent(axis, 1.0f / float(count));
  at.SetComponent(axis, bounds.mMin[axis] + (float(index) + 0.5f) * size[axis] / float(count));
  return {shape, Mat44::sTranslation(at), scale};
}

uint32_t countOf(const Shape *shape, float sliceLength) {
  return shape->GetType() == EShapeType::Compound
             ? static_cast<const CompoundShape *>(shape)->GetNumSubShapes()
             : slicesOf(shape, sliceLength);
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
  const uint32_t *plane = w + HEADER_WORDS, *end = plane + count * PLANE_WORDS;
  // A body's records are consecutive: its pieces' volumes are summed, and since every push is
  // along gravity, their sum at the volume-weighted centre is each piece pushed at its own.
  while (plane < end) {
    uint32_t engine = plane[0];
    const Slot *slot = slotOf(engine);
    Body *body = slot && world.dt > 0 ? locks.TryGetBody(slot->id) : nullptr;
    float total = 0, submerged = 0;
    Vec3 centre = Vec3::sZero();
    for (; plane < end && plane[0] == engine; plane += PLANE_WORDS) {
      if (!body || !body->IsDynamic()) continue;
      const Shape *shape = body->GetShape();
      uint32_t index = plane[1] & 0xFFFFu, pieces = plane[1] >> 16;
      bool compound = shape->GetType() == EShapeType::Compound;
      if (index >= pieces || pieces != (compound ? countOf(shape, 0) : std::min(pieces, MAX_SLICES)))
        continue;
      Piece piece = pieceOf(shape, index, pieces);
      Plane surface = Plane::sFromPointAndNormal(Vec3(vec3(plane + 2) - body->GetCenterOfMassPosition()),
                                                 vec3(plane + 5).NormalizedOr(Vec3::sAxisY()));
      float pieceTotal, pieceSubmerged;
      Vec3 pieceCentre;
      piece.shape->GetSubmergedVolume(Mat44::sRotation(body->GetRotation()) * piece.local, piece.scale,
                                      surface, pieceTotal, pieceSubmerged, pieceCentre
                                      JPH_IF_DEBUG_RENDERER(, body->GetCenterOfMassPosition()));
      total += pieceTotal;
      submerged += pieceSubmerged;
      centre += pieceSubmerged * pieceCentre;
    }
    if (!body || submerged <= 0 || total <= 0) continue;
    centre /= submerged;
    // Jolt measures a sphere, capsule or cylinder by its box: brought back to the shape's volume.
    float volume = body->GetShape()->GetVolume();
    submerged *= volume / total;
    // Jolt's buoyancy factor is the fluid's density over the body's: `density` is the water's.
    float factor = density * volume * body->GetMotionProperties()->GetInverseMass();
    body->ApplyBuoyancyImpulse(volume, submerged, centre, factor, linearDrag, angularDrag, current,
                               gravity, world.dt);
  }
  return HEADER_WORDS + count * PLANE_WORDS;
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
    const Shape *shape = body->GetShape();
    uint32_t count = trillion::countOf(shape, sliceLength);
    Mat44 com = body->GetCenterOfMassTransform();
    for (uint32_t i = 0; i < count; ++i) {
      trillion::Piece piece = trillion::pieceOf(shape, i, count);
      AABox box = piece.shape->GetLocalBounds().Scaled(piece.scale).Transformed(com * piece.local);
      Vec3 centre = box.GetCenter(), half = box.GetExtent();
      float floats[4] = {centre.GetX(), centre.GetZ(), half.GetX(), half.GetZ()};
      uint32_t words[trillion::PIECE_WORDS] = {engine, i | count << 16};
      std::memcpy(words + 2, floats, sizeof(floats));
      trillion::pieces.insert(trillion::pieces.end(), words, words + trillion::PIECE_WORDS);
    }
  }
  return uint32_t(trillion::pieces.size() / trillion::PIECE_WORDS);
}

uint32_t *jolt_water_pieces() { return trillion::pieces.data(); }

}  // extern "C"
