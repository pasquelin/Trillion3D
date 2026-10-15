// The polyhedral leaves of the one submerged-volume integrator (`submerged.h`): a box, a hull — and
// any other leaf by the box of its bounds, which no body the engine makes is — clipped by the
// cuts face by face, each cut closed by its cap, and measured by the tetrahedra its faces make with
// an inner point: exact for a polyhedron, the clipped solid being one.
#include "submerged.h"

#include <Jolt/Physics/Collision/Shape/BoxShape.h>
#include <Jolt/Physics/Collision/Shape/ConvexHullShape.h>

#include <algorithm>
#include <cmath>
#include <vector>

using namespace JPH;

namespace trillion {

namespace {

using Face = std::vector<Vec3>;

/// The faces of the leaf `shape`, in its own frame, into `faces`.
void facesOf(const Shape &shape, std::vector<Face> &faces) {
  faces.clear();
  if (shape.GetSubType() == EShapeSubType::ConvexHull) {
    const auto &hull = static_cast<const ConvexHullShape &>(shape);
    uint indices[256];
    for (uint f = 0; f < hull.GetNumFaces(); ++f) {
      uint count = std::min<uint>(hull.GetFaceVertices(f, 256, indices), 256);
      Face &face = faces.emplace_back();
      for (uint i = 0; i < count; ++i) face.push_back(hull.GetPoint(indices[i]));
    }
    return;
  }
  AABox box = shape.GetSubType() == EShapeSubType::Box
                  ? AABox(-static_cast<const BoxShape &>(shape).GetHalfExtent(), static_cast<const BoxShape &>(shape).GetHalfExtent())
                  : shape.GetLocalBounds();
  auto corner = [&](int i) { return Vec3(i & 1 ? box.mMax.GetX() : box.mMin.GetX(), i & 2 ? box.mMax.GetY() : box.mMin.GetY(), i & 4 ? box.mMax.GetZ() : box.mMin.GetZ()); };
  // Its six faces by their corners (bit 0: x, 1: y, 2: z at its max).
  static constexpr int QUADS[6][4] = {{0, 2, 6, 4}, {1, 5, 7, 3}, {0, 4, 5, 1}, {2, 3, 7, 6}, {0, 1, 3, 2}, {4, 6, 7, 5}};
  for (const auto &q : QUADS) faces.push_back({corner(q[0]), corner(q[1]), corner(q[2]), corner(q[3])});
}

/// `faces` cut by `cut`: each face clipped to its side, the cut closed by the polygon of the
/// points the clipping left on it, ordered around their middle.
void clip(std::vector<Face> &faces, const Cut &cut, std::vector<Face> &out) {
  out.clear();
  Face cap;
  for (const Face &face : faces) {
    Face kept;
    for (size_t i = 0, n = face.size(); i < n; ++i) {
      Vec3 a = face[i], b = face[(i + 1) % n];
      float da = cut.normal.Dot(a) + cut.constant, db = cut.normal.Dot(b) + cut.constant;
      if (da <= 0) kept.push_back(a);
      if (da == 0) cap.push_back(a);
      if ((da < 0) != (db < 0) && da != db) {
        Vec3 on = a + (b - a) * (da / (da - db));
        kept.push_back(on);
        cap.push_back(on);
      }
    }
    if (kept.size() >= 3) out.push_back(std::move(kept));
  }
  if (cap.size() >= 3) {
    Vec3 middle = Vec3::sZero();
    for (Vec3 p : cap) middle += p;
    middle /= float(cap.size());
    Vec3 u = cut.normal.GetNormalizedPerpendicular(), v = cut.normal.Cross(u);
    std::sort(cap.begin(), cap.end(), [&](Vec3 a, Vec3 b) {
      return std::atan2((a - middle).Dot(v), (a - middle).Dot(u)) < std::atan2((b - middle).Dot(v), (b - middle).Dot(u));
    });
    out.push_back(std::move(cap));
  }
  faces.swap(out);
}

}  // namespace

float polyhedronVolume(const Shape &shape, const Cut *cuts, uint32_t count, Vec3 &centre) {
  static std::vector<Face> faces, scratch;
  facesOf(shape, faces);
  for (uint32_t i = 0; i < count && !faces.empty(); ++i) clip(faces, cuts[i], scratch);
  // The tetrahedra of each face's fan with a point inside (the mean of its vertices).
  Vec3 inner = Vec3::sZero();
  float points = 0;
  for (const Face &face : faces)
    for (Vec3 p : face) inner += p, points += 1;
  centre = Vec3::sZero();
  if (points == 0) return 0;
  inner /= points;
  float volume = 0;
  for (const Face &face : faces)
    for (size_t i = 1; i + 1 < face.size(); ++i) {
      Vec3 a = face[0] - inner, b = face[i] - inner, c = face[i + 1] - inner;
      float v = std::abs(a.Dot(b.Cross(c))) / 6;
      volume += v;
      centre += v * (inner + (face[0] + face[i] + face[i + 1] - 3 * inner) / 4);
    }
  if (!(volume > 0)) return (centre = Vec3::sZero(), 0.0f);
  centre /= volume;
  return volume;
}

}  // namespace trillion
