//! A page's normals and stored tangents at the precisions its header names: a normal's two cells on
//! the octahedron of `bits` bits an axis and back (`normal_code`, `normal_decode`), a page's whole
//! normal stream decoded, four normals at a time on `simd128` lanes (`normal_decode_stream`); and
//! a stored tangent's code around its normal, both ways (`tangent_code`, `tangent_decode`).

use super::BitReader;
use core::f32::consts::{PI, TAU};
use trillion3d_math::vector::vec3::{cross, divide, unit_where_squared};
use trillion3d_math::vector::vecn::{add, dot, length, scale};

/// The squared length under which a vector carries no direction for the tangent code: a tangent
/// must exceed it, the axis of its plane reach it.
const UNIT_FLOOR: f32 = 1e-8;
/// The least squared length a tangent keeps once projected on its normal's plane: under it, the
/// tangent lies along the normal and names no angle.
const PLANE_FLOOR: f32 = 1e-4;

/// `v` with its `x` and `z` swapped when `swap`.
fn swapped([x, y, z]: [f32; 3], swap: bool) -> [f32; 3] {
    if swap {
        [z, y, x]
    } else {
        [x, y, z]
    }
}

/// The plane a tangent's angle is measured in around the unit normal `n`: whether `x` and `z` trade
/// places — so that the larger of the two sits in `x` and the axis below is never zero —, then
/// the axis `(−y, x, 0)` made unit and the normal crossed with it, in the swapped frame.
fn tangent_plane(n: [f32; 3]) -> (bool, [f32; 3], [f32; 3]) {
    let swap = n[2].abs() > n[0].abs();
    let z = swapped(n, swap);
    let axis = [-z[1], z[0], 0.0];
    let x = unit_where_squared(axis, |square| square >= UNIT_FLOOR).unwrap_or([0.0; 3]);
    (swap, x, cross(z, x))
}

/// The code a vertex's tangent stores (`FLAG_TANGENT`): `t`, any length, around the page's decoded
/// normal `n` — its direction's angle in the normal's plane (`tangent_plane`), a turn in `2^bits`
/// steps, rounded, and above it the bit of a negative bitangent `sign`. `None` when `t` is too
/// short to have a direction or lies along `n`: such a vertex repeats the code of the vertex
/// before it (`encode::cells`).
pub(crate) fn tangent_code(t: [f32; 3], sign: f32, n: [f32; 3], bits: u32) -> Option<u32> {
    let t = unit_where_squared(t, |square| square > UNIT_FLOOR)?;
    let (swap, axis_x, axis_y) = tangent_plane(n);
    let t = swapped(t, swap);
    let (x, y) = (dot(t, axis_x), dot(t, axis_y));
    if x * x + y * y < PLANE_FLOOR {
        return None;
    }
    // A turn past the half, which the mask brings back: the code of the angle modulo a turn.
    // fdlibm's arc tangent, the same bits on every host: the code a vertex stores never follows
    // the platform's C library.
    let mut angle = libm::atan2f(y, x);
    if angle < PI {
        angle += TAU;
    }
    let steps = (1u32 << bits) as f32;
    let code = ((angle / TAU) * steps + 0.5).floor() as i32 as u32 & ((1 << bits) - 1);
    Some(code | (u32::from(sign < 0.0) << bits))
}

/// The tangent and bitangent sign `code` names around the decoded normal `n` (`tangent_code`),
/// `bits` the page's tangent precision: four floats, the tangent then `±1`. The plane's axis
/// `(−y, x, 0)` is not made unit; its inverse length scales the cosine and the sine instead.
fn tangent_decode(code: u32, n: [f32; 3], bits: u32) -> [f32; 4] {
    let swap = n[2].abs() > n[0].abs();
    let z = swapped(n, swap);
    let axis_x = [-z[1], z[0], 0.0];
    let axis_y = cross(z, axis_x);
    let inverse = 1.0 / (axis_x[0] * axis_x[0] + axis_x[1] * axis_x[1]).sqrt();
    let angle = (code & ((1 << bits) - 1)) as f32 * ((2.0 * PI) / (1u32 << bits) as f32);
    let t = add(
        scale(axis_x, angle.cos() * inverse),
        scale(axis_y, angle.sin() * inverse),
    );
    let [x, y, z] = swapped(t, swap);
    let sign = if (code >> bits) & 1 != 0 { -1.0 } else { 1.0 };
    [x, y, z, sign]
}

/// A page's tangent stream (`FLAG_TANGENT`) decoded into `out`, four float words per vertex, each
/// around its vertex's decoded normal of `normals` (three float words each), `bits` the page's
/// tangent precision.
pub(crate) fn tangent_decode_stream(words: &[u32], bits: u32, normals: &[u32], out: &mut [u32]) {
    let mut stream = BitReader::at(words, 0);
    let normals = normals.as_chunks::<3>().0;
    for (tangent, normal) in out.as_chunks_mut::<4>().0.iter_mut().zip(normals) {
        let n = normal.map(f32::from_bits);
        *tangent = tangent_decode(stream.read(bits + 1), n, bits).map(f32::to_bits);
    }
}

/// The octahedral map's point of the normal `[x, y, z]`: its components over the sum of their
/// magnitudes, the lower half (`z < 0`) folded over the upper one.
fn project([x, y, z]: [f32; 3]) -> [f32; 2] {
    let sum = x.abs() + y.abs() + z.abs();
    let (x, y, z) = (x / sum, y / sum, z / sum);
    // Each axis `1 − |other|`, on its own side.
    let fold = |side: f32, other: f32| {
        if side >= 0.0 {
            1.0 - other.abs()
        } else {
            other.abs() - 1.0
        }
    };
    if z < 0.0 {
        [fold(x, y), fold(y, x)]
    } else {
        [x, y]
    }
}

/// A normal's two cells on the octahedron of `bits` bits an axis, `x` first: the projected point
/// scaled to the cells and cut to the one below it on each axis, then of the four cells around it —
/// that cell, the next in `x`, the next in `y`, both — the one whose decoded direction lies
/// closest to the normal — each dot's two low bits replaced by the cell's rank, so that near ties
/// go to the later cell —, the winner held within the grid. A zero or non-finite normal takes the
/// `+z` pole's cell.
pub(crate) fn normal_code(n: [f32; 3], bits: u32) -> [u32; 2] {
    let max = (1u32 << bits) - 1;
    let sum = n[0].abs() + n[1].abs() + n[2].abs();
    if !(sum > 0.0 && sum.is_finite()) {
        return [max.div_ceil(2); 2];
    }
    let half = 0.5 * max as f32;
    let step = 2.0 / max as f32;
    let [px, py] = project(n);
    let (x, y) = ((px * half + half) as i32, (py * half + half) as i32);
    let coordinate = |q: i32| q as f32 * step - 1.0;
    let sign = |v: f32| v.to_bits() & 0x8000_0000;
    let around = [(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)];
    let mut best = f32::NEG_INFINITY;
    for (lane, (qx, qy)) in around.into_iter().enumerate() {
        let (cx, cy) = (coordinate(qx), coordinate(qy));
        let cz = (1.0 - cx.abs()) - cy.abs();
        let lack = cz.min(0.0).to_bits();
        let ux = cx + f32::from_bits(lack ^ sign(cx));
        let uy = cy + f32::from_bits(lack ^ sign(cy));
        let dots = ux * n[0] + (uy * n[1] + cz * n[2]);
        let lengths = (ux * ux + (uy * uy + cz * cz)).sqrt();
        let rounded = (dots / lengths).to_bits() & !3;
        best = best.max(f32::from_bits(rounded | lane as u32));
    }
    let lane = (best.to_bits() & 3) as i32;
    [x + (lane & 1), y + ((lane >> 1) & 1)].map(|q| q.clamp(0, max as i32) as u32)
}

/// The unit normal two cells stand for on the octahedron of `bits` bits an axis (`normal_code`):
/// each cell times the grid's step less one, `z` one less their magnitudes, the lower half unfolded
/// by what `z` lacks of zero, the vector divided by its length.
pub(crate) fn normal_decode([cx, cy]: [u32; 2], bits: u32) -> [f32; 3] {
    let step = 2.0 / ((1u32 << bits) - 1) as f32;
    let (x, y) = (cx as f32 * step - 1.0, cy as f32 * step - 1.0);
    let z = (1.0 - x.abs()) - y.abs();
    let lack = if z < 0.0 { (-z).min(1.0) } else { 0.0 };
    let unfold = |v: f32| if v >= 0.0 { v - lack } else { v + lack };
    let v = [unfold(x), unfold(y), z];
    divide(v, length(v))
}

/// A page's normals decoded into `out`, three float words each: the cells of `bits` bits an axis,
/// the `x` stream at word `starts[0]` of `words` and the `y` stream at `starts[1]`, the first
/// `out.len() / 3` of each.
pub(crate) fn normal_decode_stream(words: &[u32], starts: [usize; 2], bits: u32, out: &mut [u32]) {
    let [mut xs, mut ys] = starts.map(|start| BitReader::at(words, start * 32));
    let (blocks, rest) = out.as_chunks_mut::<3>().0.as_chunks_mut::<4>();
    for block in blocks {
        let cells = core::array::from_fn(|_| [xs.read(bits), ys.read(bits)]);
        four(block, cells, bits);
    }
    for normal in rest {
        *normal = normal_decode([xs.read(bits), ys.read(bits)], bits).map(f32::to_bits);
    }
}

/// Four normals at a time on `simd128` lanes, each lane running `normal_decode`'s operations in
/// its order — conversion, product, difference, absolute values, the lack of `z` held within
/// [0, 1], the unfolding sum or difference, `(x² + y²) + z²`, square root, three quotients —, each
/// correctly rounded lane by lane (IEEE-754 binary32; WebAssembly fuses nothing): the same bits.
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
fn four(block: &mut [[u32; 3]; 4], cells: [[u32; 2]; 4], bits: u32) {
    use core::arch::wasm32::*;
    let (one, zero) = (f32x4_splat(1.0), f32x4_splat(0.0));
    let step = f32x4_splat(2.0 / ((1u32 << bits) - 1) as f32);
    let axis = |c: usize| {
        let codes = u32x4(cells[0][c], cells[1][c], cells[2][c], cells[3][c]);
        f32x4_sub(f32x4_mul(f32x4_convert_u32x4(codes), step), one)
    };
    let (x, y) = (axis(0), axis(1));
    let z = f32x4_sub(f32x4_sub(one, f32x4_abs(x)), f32x4_abs(y));
    let lack = v128_bitselect(f32x4_min(f32x4_neg(z), one), zero, f32x4_lt(z, zero));
    let unfold =
        |v: v128| v128_bitselect(f32x4_sub(v, lack), f32x4_add(v, lack), f32x4_ge(v, zero));
    let (x, y) = (unfold(x), unfold(y));
    let sum = f32x4_add(f32x4_add(f32x4_mul(x, x), f32x4_mul(y, y)), f32x4_mul(z, z));
    let length = f32x4_sqrt(sum);
    let n = [x, y, z].map(|v| f32x4_div(v, length));
    block[0] = n.map(|v| u32x4_extract_lane::<0>(v));
    block[1] = n.map(|v| u32x4_extract_lane::<1>(v));
    block[2] = n.map(|v| u32x4_extract_lane::<2>(v));
    block[3] = n.map(|v| u32x4_extract_lane::<3>(v));
}

/// Without `simd128`, every normal goes through `normal_decode` itself.
#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
fn four(block: &mut [[u32; 3]; 4], cells: [[u32; 2]; 4], bits: u32) {
    for (normal, cell) in block.iter_mut().zip(cells) {
        *normal = normal_decode(cell, bits).map(f32::to_bits);
    }
}
