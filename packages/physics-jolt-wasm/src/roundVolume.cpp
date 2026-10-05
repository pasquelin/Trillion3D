// Jolt measures the water under a capsule, a cylinder or a tapered cylinder by the box of its
// bounds (`ConvexShape::GetSubmergedVolume`): a horizontal log a third under is 19 % too buoyant
// and rolls where it should not, a cone's box hangs below its tip. Here they are measured exactly,
// whole or a slice across their axis. Along the axis y each section is a disc of radius r(y); the
// water plane crosses it along a chord at a signed distance d(y) from its centre, and the wet part
// is the disc's segment: area r² g(u), u = d / r, g(u) = π − acos u + u √(1 − u²), and first
// moment across the chord −(2/3) (r² − d²)^(3/2). Volume, centre and the whole's volume are those
// sections summed along the axis, by Gauss–Legendre over each stretch where one formula holds and
// the plane cuts every section or none: its ends are where |d| = r, roots of a quadratic, r² and d
// being polynomials of y. In the variable y = a + (b − a)(1 − cos θ) / 2 the segment's
// (r − |d|)^(3/2) at those ends is smooth, and eight points give the volume to float precision.
#include "roundVolume.h"

#include <Jolt/Physics/Collision/Shape/CapsuleShape.h>
#include <Jolt/Physics/Collision/Shape/CylinderShape.h>
#include <Jolt/Physics/Collision/Shape/OffsetCenterOfMassShape.h>
#include <Jolt/Physics/Collision/Shape/TaperedCylinderShape.h>

#include <algorithm>
#include <cmath>

using namespace JPH;

namespace trillion {

namespace {

constexpr double PI = 3.14159265358979323846;
constexpr int NODES = 8;

/// The rule on [0, 1]: each node's place `(1 − cos θ) / 2` and weight `(π / 4) w sin θ` (summing to
/// 1), θ = π (1 + x) / 2 at the 8-point Gauss–Legendre nodes x and weights w.
struct Rule {
  double at[NODES], weight[NODES];
};
const Rule RULE = [] {
  const double x[4] = {0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363};
  const double w[4] = {0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763};
  Rule rule{};
  for (int i = 0; i < NODES; ++i) {
    int k = i < 4 ? 3 - i : i - 4;
    double theta = PI / 2 * (1 + (i < 4 ? -x[k] : x[k]));
    rule.at[i] = (1 - std::cos(theta)) / 2;
    rule.weight[i] = PI / 4 * w[k] * std::sin(theta);
  }
  return rule;
}();

/// A stretch of the axis where r² = a y² + b y + c: a hemisphere, or the side.
struct Stretch {
  double from, to, a, b, c;
};

/// The stretches of `round`, bottom to top; returns their count.
int stretchesOf(const Round &round, Stretch out[3]) {
  int count = 0;
  double bottom = round.bottom, top = round.top, cap = round.cap;
  if (cap > 0) out[count++] = {bottom - cap, bottom, -1, 2 * bottom, cap * cap - bottom * bottom};
  if (top > bottom) {
    double slope = (double(round.topRadius) - round.bottomRadius) / (top - bottom);
    double base = round.bottomRadius - slope * bottom;
    out[count++] = {bottom, top, slope * slope, 2 * base * slope, base * base};
  }
  if (cap > 0) out[count++] = {top, top + cap, -1, 2 * top, cap * cap - top * top};
  return count;
}

/// The water plane in a section's terms: its signed distance is `along y + at` at the centre of
/// the section at `y`, and grows by `across` (√(1 − along²)) per metre across the section along
/// the plane's normal.
struct Cut {
  double along, at, across;
};

/// The sums the sections add up to: the whole's volume, the wet volume, its moments along the axis
/// and across the chord.
struct Sums {
  double total, volume, axial, lateral;
};

/// Adds the sections of `stretch` from `lo` to `hi`, all cut by the plane or none.
void addPart(const Stretch &s, const Cut &cut, double lo, double hi, Sums &sums) {
  double length = hi - lo;
  for (int i = 0; i < NODES; ++i) {
    double y = lo + length * RULE.at[i], weight = length * RULE.weight[i];
    double r2 = std::max(0.0, (s.a * y + s.b) * y + s.c), whole = PI * r2;
    double distance = cut.along * y + cut.at, reach = cut.across * std::sqrt(r2);
    sums.total += weight * whole;
    if (distance >= reach) continue;
    if (distance <= -reach) {
      sums.volume += weight * whole;
      sums.axial += weight * y * whole;
      continue;
    }
    double u = -distance / reach, root = std::sqrt(1 - u * u), half = std::sqrt(r2) * root;
    double area = r2 * (PI - std::acos(u) + u * root);
    sums.volume += weight * area;
    sums.axial += weight * y * area;
    sums.lateral -= weight * 2.0 / 3.0 * half * half * half;
  }
}

/// Adds the sections of `stretch` from `lo` to `hi`, split where the plane starts or stops cutting
/// them: where `(along y + at)² = across² r²(y)`.
void addStretch(const Stretch &s, const Cut &cut, double lo, double hi, Sums &sums) {
  double across2 = cut.across * cut.across;
  double a = cut.along * cut.along - across2 * s.a, b = 2 * cut.along * cut.at - across2 * s.b,
         c = cut.at * cut.at - across2 * s.c;
  double ends[4] = {lo};
  int count = 1;
  auto keep = [&](double y) {
    if (y > lo && y < hi) ends[count++] = y;
  };
  if (a == 0) {
    if (b != 0) keep(-c / b);
  }
  else if (double discriminant = b * b - 4 * a * c; discriminant >= 0) {
    double q = -0.5 * (b + std::copysign(std::sqrt(discriminant), b));
    keep(q / a);
    if (q != 0) keep(c / q);
  }
  std::sort(ends + 1, ends + count);
  ends[count++] = hi;
  for (int i = 0; i + 1 < count; ++i)
    if (ends[i + 1] > ends[i]) addPart(s, cut, ends[i], ends[i + 1], sums);
}

}  // namespace

bool roundOf(const Shape &shape, Round &round, Vec3 &offset) {
  const Shape *inner = &shape;
  offset = Vec3::sZero();
  if (shape.GetSubType() == EShapeSubType::OffsetCenterOfMass) {
    const auto &moved = static_cast<const OffsetCenterOfMassShape &>(shape);
    inner = moved.GetInnerShape();
    offset = -moved.GetOffset();
  }
  switch (inner->GetSubType()) {
    case EShapeSubType::Capsule: {
      const auto &capsule = static_cast<const CapsuleShape &>(*inner);
      float half = capsule.GetHalfHeightOfCylinder(), radius = capsule.GetRadius();
      round = {-half, half, radius, radius, radius};
      return true;
    }
    case EShapeSubType::Cylinder: {
      const auto &cylinder = static_cast<const CylinderShape &>(*inner);
      float half = cylinder.GetHalfHeight(), radius = cylinder.GetRadius();
      round = {-half, half, radius, radius, 0};
      return true;
    }
    case EShapeSubType::TaperedCylinder: {
      // Its frame is its centre of mass, which sits `GetCenterOfMass` off its middle.
      const auto &tapered = static_cast<const TaperedCylinderShape &>(*inner);
      float half = tapered.GetHalfHeight(), middle = -tapered.GetCenterOfMass().GetY();
      round = {middle - half, middle + half, tapered.GetBottomRadius(), tapered.GetTopRadius(), 0};
      return true;
    }
    default:
      return false;
  }
}

AABox roundBounds(const Round &round, float from, float to) {
  // The radius rises to the side and falls past it: its largest is at an end or where the side
  // starts or stops.
  auto radius = [&](float y) {
    if (y < round.bottom) return std::sqrt(std::max(0.0f, Square(round.cap) - Square(y - round.bottom)));
    if (y > round.top) return std::sqrt(std::max(0.0f, Square(round.cap) - Square(y - round.top)));
    float t = round.top > round.bottom ? (y - round.bottom) / (round.top - round.bottom) : 0.0f;
    return round.bottomRadius + t * (round.topRadius - round.bottomRadius);
  };
  float widest = std::max({radius(from), radius(to), radius(Clamp(round.bottom, from, to)),
                           radius(Clamp(round.top, from, to))});
  return AABox(Vec3(-widest, from, -widest), Vec3(widest, to, widest));
}

void roundSubmerged(const Round &round, float from, float to, Mat44Arg transform, const Plane &surface,
                    float &total, float &submerged, Vec3 &centre) {
  // The plane in the round's own frame.
  Vec3 normal = transform.Multiply3x3Transposed(surface.GetNormal());
  Vec3 origin = transform.GetTranslation(), world = surface.GetNormal();
  double nx = normal.GetX(), nz = normal.GetZ();
  Cut cut{normal.GetY(),
          double(surface.GetConstant()) + double(world.GetX()) * origin.GetX() +
              double(world.GetY()) * origin.GetY() + double(world.GetZ()) * origin.GetZ(),
          std::sqrt(nx * nx + nz * nz)};
  Stretch stretches[3];
  Sums sums{};
  for (int i = 0, count = stretchesOf(round, stretches); i < count; ++i) {
    double lo = std::max<double>(from, stretches[i].from), hi = std::min<double>(to, stretches[i].to);
    if (hi > lo) addStretch(stretches[i], cut, lo, hi, sums);
  }
  total = float(sums.total);
  submerged = float(sums.volume);
  if (!(sums.volume > 0)) {
    submerged = 0;
    centre = Vec3::sZero();
    return;
  }
  // The chord's moment points against the plane's normal, across the axis.
  double lateral = cut.across > 0 ? sums.lateral / (sums.volume * cut.across) : 0;
  centre = transform * Vec3(float(lateral * nx), float(sums.axial / sums.volume), float(lateral * nz));
}

}  // namespace trillion
