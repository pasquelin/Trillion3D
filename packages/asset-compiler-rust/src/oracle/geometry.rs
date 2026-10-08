//! The albedo a world triangle carries; the tracer's geometry lives in `crate::proxy::tracer`.
use crate::proxy::tracer::World;
use trillion3d_math::scalar::byte_to_unit;

pub fn albedo_of(world: &World, triangle: usize) -> [f64; 3] {
    let packed = world.tags[triangle];
    [
        byte_to_unit((packed & 255) as u8),
        byte_to_unit(((packed >> 8) & 255) as u8),
        byte_to_unit(((packed >> 16) & 255) as u8),
    ]
}
