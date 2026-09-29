//! The albedo a world triangle carries; the tracer's geometry lives in `crate::tracer`.
use crate::tracer::World;

pub fn albedo_of(world: &World, triangle: usize) -> [f64; 3] {
    let packed = world.tags[triangle];
    [
        (packed & 255) as f64 / 255.0,
        ((packed >> 8) & 255) as f64 / 255.0,
        ((packed >> 16) & 255) as f64 / 255.0,
    ]
}
