//! What every texel of a shell triangle shares, as the compute pass reads it (`scene.wgsl`'s
//! `frame_of`), and the pass's constant tables: the byte curves.
use super::super::tree::triangle_of;
use super::super::Flat;
use super::layout::FRAME_RECORDS;
use crate::hlod::flatten::gpu::pack::{float, local};

/// The tables the materials carry after their head (`layout::TABLE_RECORDS`): the 256 sRGB bytes
/// in linear and the 256 bytes on the unit interval — the curves every chain decodes through
/// (`texture::srgb_table`, `texture::linear_table`).
pub(super) fn tables() -> impl Iterator<Item = u32> {
    let curves = (crate::texture::srgb_table().iter()).chain(crate::texture::linear_table());
    curves.map(|x| x.to_bits())
}

/// Each triangle of the shell `flat` appended to `out` as the pass reads it
/// (`layout::FRAME_RECORDS`): its corners about `origin`, its corner normals, and its corner
/// tangents, each with its bitangent's sign.
pub(super) fn pack_frames(out: &mut Vec<u32>, flat: &Flat, origin: [f64; 3]) {
    let count = flat.indices.len() / 3;
    out.reserve(count * FRAME_RECORDS * 4);
    for t in 0..count {
        for corner in triangle_of(&flat.positions, &flat.indices, t) {
            out.extend(local(corner, origin).map(f32::to_bits));
            out.push(0);
        }
        for normal in flat.normals(t) {
            out.extend(normal.map(float));
            out.push(0);
        }
        for k in 0..3 {
            let v = flat.corner(t, k);
            out.extend(flat.tangents[v * 4..v * 4 + 4].iter().map(|x| x.to_bits()));
        }
    }
}
