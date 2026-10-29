//! The directions a voxel's rays take: the reference's 49 stratified samples of a hemisphere and
//! 49 of the other, drawn from its linear congruential stream seeded with 0 so a rebuild casts the
//! same rays.
use std::f64::consts::PI;
use trillion3d_math::sequence::random::lcg32_fraction;

/// The samples of one hemisphere a point query leaves to the rays: the sides of its stratified
/// square, squared.
const SAMPLES: usize = 49;

/// The point of the unit hemisphere (`+z`) a square's point `uniforms` in [0, 1]² maps to:
/// the concentric disk, lifted (Shirley and Chiu, 1997).
fn hemisphere_point(uniforms: [f64; 2]) -> [f32; 3] {
    let [x, y] = uniforms.map(|u| u * 2.0 - 1.0);
    if x == 0.0 && y == 0.0 {
        return [0.0; 3];
    }
    let (radius, angle): (f32, f32) = if x.abs() > y.abs() {
        (x as f32, (PI as f32 / 4.0) * (y / x) as f32)
    } else {
        (
            y as f32,
            PI as f32 / 2.0 - (PI as f32 / 4.0) * (x / y) as f32,
        )
    };
    let (u, v) = (
        (f64::from(radius) * f64::from(angle).cos()) as f32,
        (f64::from(radius) * f64::from(angle).sin()) as f32,
    );
    let r2 = radius * radius;
    let lift = (2.0 - r2).sqrt();
    [u * lift, v * lift, 1.0 - r2]
}

/// `count` points of the upper hemisphere, one in each cell of the largest stratified square that
/// holds no more than `count` of them, jittered.
fn stratified(stream: &mut u32, count: usize) -> Vec<[f32; 3]> {
    let side = (count as f32).sqrt().trunc() as usize;
    let mut samples = Vec::with_capacity(side * side);
    for x in 0..side {
        for y in 0..side {
            let (u1, u2) = (lcg32_fraction(stream), lcg32_fraction(stream));
            let at = [(x as f32 + u1) / side as f32, (y as f32 + u2) / side as f32];
            samples.push(hemisphere_point(at.map(f64::from)));
        }
    }
    samples
}

/// The directions of a voxel's rays: the upper hemisphere's samples, then the next samples of the
/// stream turned over onto the lower.
pub(super) fn directions() -> Vec<[f64; 3]> {
    let mut stream = 0;
    let upper = stratified(&mut stream, SAMPLES);
    let lower = stratified(&mut stream, SAMPLES)
        .into_iter()
        .map(|[x, y, z]| [x, y, -z]);
    upper
        .into_iter()
        .chain(lower)
        .map(|d| d.map(f64::from))
        .collect()
}

/// The directions of the rays a surface point casts over its upper hemisphere: the samples of
/// `count` points' largest stratified square (`stratified`), drawn from the stream seeded with 0.
pub(crate) fn hemisphere(count: usize) -> Vec<[f64; 3]> {
    let samples = stratified(&mut 0, count);
    samples.into_iter().map(|d| d.map(f64::from)).collect()
}
