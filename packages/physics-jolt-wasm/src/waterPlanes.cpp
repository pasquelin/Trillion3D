// The water planes of a step's pieces (`jolt_water_query`), from the wave model the page draws
// (`packages/sdk-core/src/fluids/surface.ts`, `waves.ts`): each piece gets the exact height of the
// surface above its centre and the slope of the four surface points its rest square is carried
// to. The same double-precision operations in the same order as the TypeScript model, so the
// planes, rounded to the BUOYANCY command's floats, are the ones it gave (`waterPlanes.test.ts`).
#include "words.h"

#include <cmath>
#include <vector>

using trillion::f32;
using trillion::PIECE_WORDS;
using trillion::PLANE_WORDS;

namespace {

/// Doubles of one wave, as `jolt_wave_buffer` takes them: direction x, z, wave number, amplitude,
/// lateral amplitude, phase at the step's time.
constexpr uint32_t WAVE_DOUBLES = 6;
/// Newton iterations of the rest point (`surface.ts` HEIGHT_ITERATIONS).
constexpr int HEIGHT_ITERATIONS = 3;

struct Wave {
  double dx, dz, k, amplitude, lateral, phase;
};

std::vector<Wave> waves;
std::vector<uint32_t> planes;

/// `surface.ts` `waveRest`: the rest point the waves carry to the world position `(x, z)`.
void restPoint(uint32_t count, double x, double z, double &px, double &pz) {
  px = x;
  pz = z;
  for (int n = 0; n < HEIGHT_ITERATIONS; n++) {
    double fx = px - x, fz = pz - z, sxx = 0, sxz = 0, szz = 0;
    for (uint32_t i = 0; i < count; i++) {
      const Wave &w = waves[i];
      double f = w.k * (w.dx * px + w.dz * pz) - w.phase;
      double c = std::cos(f), qs = w.lateral * w.k * std::sin(f);
      fx += w.lateral * w.dx * c;
      fz += w.lateral * w.dz * c;
      sxx += qs * w.dx * w.dx;
      sxz += qs * w.dx * w.dz;
      szz += qs * w.dz * w.dz;
    }
    double a = 1 - sxx, d = 1 - szz, det = a * d - sxz * sxz;
    if (!(det > 1e-6)) {
      px -= fx;
      pz -= fz;
      continue;
    }
    px -= (d * fx + sxz * fz) / det;
    pz -= (sxz * fx + a * fz) / det;
  }
}

/// `surface.ts` `wavePatch`: the points the rest square `(px ± hx, pz ± hz)` is carried to, into
/// `corners` ((−,−), (+,−), (−,+), (+,+)), and the height of its centre, returned.
double patch(uint32_t count, double px, double pz, double hx, double hz, double corners[12]) {
  double y = 0;
  for (int k = 0; k < 12; k++) corners[k] = 0;
  for (uint32_t i = 0; i < count; i++) {
    const Wave &w = waves[i];
    double f = w.k * (w.dx * px + w.dz * pz) - w.phase;
    double s = std::sin(f), c = std::cos(f);
    double sa = std::sin(w.k * w.dx * hx), ca = std::cos(w.k * w.dx * hx);
    double sb = std::sin(w.k * w.dz * hz), cb = std::cos(w.k * w.dz * hz);
    y += w.amplitude * s;
    for (int corner = 0; corner < 4; corner++) {
      double sx = corner & 1 ? 1 : -1, sz = corner & 2 ? 1 : -1;
      double sinD = sx * sa * cb + sz * ca * sb, cosD = ca * cb - sx * sz * sa * sb;
      double cosF = c * cosD - s * sinD;
      corners[corner * 3] += w.lateral * w.dx * cosF;
      corners[corner * 3 + 1] += w.amplitude * (s * cosD + c * sinD);
      corners[corner * 3 + 2] += w.lateral * w.dz * cosF;
    }
  }
  for (int corner = 0; corner < 4; corner++) {
    corners[corner * 3] += px + (corner & 1 ? hx : -hx);
    corners[corner * 3 + 2] += pz + (corner & 2 ? hz : -hz);
  }
  return y;
}

/// `Math.hypot` of three numbers as JavaScript computes it: scaled by the largest, the squares
/// summed with Kahan's compensation.
double hypot3(double x, double y, double z) {
  double values[3] = {std::fabs(x), std::fabs(y), std::fabs(z)}, max = 0;
  bool nan = false;
  for (double v : values) {
    if (std::isnan(v)) nan = true;
    else if (v > max) max = v;
  }
  if (max == INFINITY) return INFINITY;
  if (nan) return NAN;
  if (max == 0) return 0;
  double sum = 0, compensation = 0;
  for (double v : values) {
    double n = v / max, summand = n * n - compensation, preliminary = sum + summand;
    compensation = (preliminary - sum) - summand;
    sum = preliminary;
  }
  return std::sqrt(sum) * max;
}

/// `Math.max(value, floor)`: a NaN value stays NaN.
double atLeast(double value, double floor) { return std::isnan(value) || value > floor ? value : floor; }

}  // namespace

extern "C" {

/// Room for `count` waves (`WAVE_DOUBLES` each), written by the worker before `jolt_water_planes`.
double *jolt_wave_buffer(uint32_t count) {
  waves.resize(count);
  return reinterpret_cast<double *>(waves.data());
}

/// The planes (`PLANE_WORDS` each, BUOYANCY's layout) of `count` pieces (`jolt_water_query`'s
/// words), on the waves of `jolt_wave_buffer` over water at `level`, each piece's square at least
/// `sample` wide; valid until the next call.
uint32_t *jolt_water_planes(const uint32_t *pieces, uint32_t count, double level, double sample) {
  static_assert(sizeof(Wave) == WAVE_DOUBLES * sizeof(double), "a wave is its doubles");
  const uint32_t waveCount = uint32_t(waves.size());
  planes.resize(size_t(count) * PLANE_WORDS);
  double corner[12];
  for (uint32_t i = 0; i < count; i++) {
    const uint32_t *from = pieces + i * PIECE_WORDS;
    uint32_t *to = planes.data() + i * PLANE_WORDS;
    double x = f32(from + 2), z = f32(from + 3);
    double hx = atLeast(f32(from + 4), sample), hz = atLeast(f32(from + 5), sample);
    double px, pz;
    restPoint(waveCount, x, z, px, pz);
    double y = patch(waveCount, px, pz, hx, hz, corner);
    // (P₂ − P₁) × (P₃ − P₀): upwards for the square (−,−), (+,−), (−,+), (+,+).
    double ax = corner[6] - corner[3], ay = corner[7] - corner[4], az = corner[8] - corner[5];
    double bx = corner[9] - corner[0], by = corner[10] - corner[1], bz = corner[11] - corner[2];
    double nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    double length = hypot3(nx, ny, nz);
    to[0] = from[0];
    to[1] = from[1];
    trillion::putF32(to + 2, float(x));
    trillion::putF32(to + 3, float(level + y));
    trillion::putF32(to + 4, float(z));
    trillion::putF32(to + 5, float(nx / length));
    trillion::putF32(to + 6, float(ny / length));
    trillion::putF32(to + 7, float(nz / length));
  }
  return planes.data();
}

}  // extern "C"
