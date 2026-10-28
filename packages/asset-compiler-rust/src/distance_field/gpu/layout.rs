//! The layout the CPU packs and the kernel reads, written once: every record's size in `vec4`
//! words, the scene's head, the walk's bounds. The kernel holds none of these numbers; it reads
//! them from the prelude generated here (`prelude`). What it lays out like the other programs —
//! the workgroup, the stack, the bindings — lives in `flatten/gpu/layout.rs`.
use crate::distance_field::scene::PULLBACK;
// A boxed node and a triangle are the shell queries' records; a triangle's first corner carries
// in its fourth word 1 when the triangle is two-sided. The bindings are theirs, a voxel a point.
pub(super) use crate::hlod::flatten::approximate::gpu::layout::{
    bindings, BOX_NODE_RECORDS, MAX_DEPTH, STACK, TRIANGLE_RECORDS,
};
use crate::hlod::flatten::gpu::layout::{wgsl_constants, NONE, WORKGROUP};
use trillion3d_page_codec::proxy::PROXY_CHILDREN;

/// The scene's head: two records. The first holds the tree's first node, its first triangle, its
/// node count and the fewest back faces that make a voxel inside; the second the rays' count, their
/// first record, the first record of the mips' volumes and the doubt in the scene's units.
pub(super) const HEAD_RECORDS: usize = 2;
/// The head's words.
pub(super) const HEAD_WORDS: usize = HEAD_RECORDS * 4;
/// A mip's volume: its low corner and the trace distance, then its high corner.
pub(super) const MIP_RECORDS: usize = 2;

/// The bit of a voxel's second word set when one of its steps came within the doubt of deciding
/// otherwise than double precision would (`field.wgsl`): the voxel is measured again on the CPU.
pub(super) const DOUBTFUL: u32 = 1 << 31;
/// Where the echo of the point a voxel's invocation read sits in its second word: above its count
/// of back faces, eight bits — fewer than 256 rays are cast (`gpu.rs` refuses more) —, under
/// `DOUBTFUL`.
pub(super) const ECHO_SHIFT: u32 = 8;
/// The echo's bits once shifted down.
pub(super) const ECHO_MASK: u32 = (DOUBTFUL >> ECHO_SHIFT) - 1;

/// The echo of the point `item` — its four floats' bits mixed —, as the kernel forms it from the
/// point it read (`field.wgsl`, `second`): the host compares it with the point it sent, so a value
/// measured at another point, or written at another voxel's place, is never taken.
pub(super) fn echo(item: [f32; 4]) -> u32 {
    let [x, y, z, w] = item.map(f32::to_bits);
    let mixed = x.wrapping_mul(0x9E37_79B1)
        ^ y.wrapping_mul(0x85EB_CA77)
        ^ z.wrapping_mul(0xC2B2_AE3D)
        ^ w.wrapping_mul(0x27D4_EB2F);
    (mixed ^ (mixed >> 15)) & ECHO_MASK
}

/// The doubt, as a share of the largest coordinate the kernel rounds about the scene's origin — a
/// triangle's corner or a mip's volume corner (`pack::doubt`): some thirty times the rounding of a
/// position in single precision and of the products the kernel forms of them, so a step that
/// single precision could decide otherwise is always doubtful.
pub(super) const DOUBT: f64 = 2.0e-6;

/// The constants above as WGSL, put before the shaders' own text.
pub(super) fn prelude() -> String {
    let constants = [
        ("NONE", NONE as usize),
        ("WORKGROUP", WORKGROUP),
        ("STACK", STACK),
        ("CHILDREN", PROXY_CHILDREN),
        ("MIP_RECORDS", MIP_RECORDS),
        ("BOX_NODE_RECORDS", BOX_NODE_RECORDS),
        ("TRIANGLE_RECORDS", TRIANGLE_RECORDS),
        ("DOUBTFUL", DOUBTFUL as usize),
        ("ECHO_SHIFT", ECHO_SHIFT as usize),
        ("ECHO_MASK", ECHO_MASK as usize),
    ];
    let mut out = wgsl_constants(&constants);
    out += &format!("const PULLBACK: f32 = {:?};\n", PULLBACK as f32);
    out
}
