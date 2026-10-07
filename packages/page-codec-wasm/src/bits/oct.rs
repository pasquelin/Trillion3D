//! A normal on two octahedral bytes and back: `oct_encode` the compiler writes with, `oct_decode`
//! every reader decodes with, and a page's whole normal stream four normals at a time on `simd128`
//! lanes.

/// `2 / 255` as the nearest `f32`: an octahedral byte to `[-1, 1]`, the value
/// `packages/sdk-browser/src/cluster/format.ts` rounds the same way.
pub const OCT_SCALE: f32 = 2.0 / 255.0;

/// Octahedral encoding of a normal into two bytes, `x` low and `y` high. Of the four roundings
/// of the projected point, the one that decodes closest to the source is kept: the best of the four
/// neighbouring cells, not the plain rounding. A zero normal has no direction and takes `+z`.
pub fn oct_encode(normal: [f32; 3]) -> u32 {
    let [x, y, z] = normal;
    let sum = x.abs() + y.abs() + z.abs();
    if sum == 0.0 || !sum.is_finite() {
        return 128 | (128 << 8);
    }
    let (px, py) = (x / sum, y / sum);
    let (px, py) = if z < 0.0 {
        (
            (1.0 - py.abs()) * if px >= 0.0 { 1.0 } else { -1.0 },
            (1.0 - px.abs()) * if py >= 0.0 { 1.0 } else { -1.0 },
        )
    } else {
        (px, py)
    };
    let cell = |v: f32| ((v + 1.0) * 127.5).floor().clamp(0.0, 254.0) as u32;
    let (bx, by) = (cell(px), cell(py));
    let length = (x * x + y * y + z * z).sqrt();
    let unit = [x / length, y / length, z / length];
    let mut best = (f32::INFINITY, 0u32);
    for candidate in [bx, bx + 1]
        .into_iter()
        .flat_map(|qx| [qx | (by << 8), qx | ((by + 1) << 8)])
    {
        let [dx, dy, dz] = oct_decode(candidate);
        let dot = dx * unit[0] + dy * unit[1] + dz * unit[2];
        let error = 1.0 - dot;
        if error < best.0 {
            best = (error, candidate);
        }
    }
    best.1
}

/// Two octahedral bytes (`x` low, `y` high) back to a unit vector.
pub fn oct_decode(q: u32) -> [f32; 3] {
    let x = (q & 255) as f32 * OCT_SCALE - 1.0;
    let y = ((q >> 8) & 255) as f32 * OCT_SCALE - 1.0;
    let z = 1.0 - x.abs() - y.abs();
    let (x, y) = if z < 0.0 {
        (
            (1.0 - y.abs()) * if x >= 0.0 { 1.0 } else { -1.0 },
            (1.0 - x.abs()) * if y >= 0.0 { 1.0 } else { -1.0 },
        )
    } else {
        (x, y)
    };
    let length = (x * x + y * y + z * z).sqrt();
    [x / length, y / length, z / length]
}

/// `oct_decode` of the first `out.len() / 3` 16-bit codes of `words` (two per word, the low half
/// first, as `BitReader` reads them), three float words per normal.
pub(crate) fn oct_decode_stream(words: &[u32], out: &mut [u32]) {
    let normals = out.as_chunks_mut::<3>().0;
    let code = |i: usize| (words[i / 2] >> (16 * (i & 1))) & 0xffff;
    let done = lanes(normals, &code);
    for (i, normal) in normals.iter_mut().enumerate().skip(done) {
        *normal = oct_decode(code(i)).map(f32::to_bits);
    }
}

/// The leading normals four at a time; returns how many. Each lane runs `oct_decode`'s
/// operations in its order — conversion, product, difference, absolute values, the fold's
/// comparison and its `±1` product, `(x² + y²) + z²`, square root, three quotients —, each
/// correctly rounded lane by lane (IEEE-754 binary32; WebAssembly fuses nothing): the same bits.
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
fn lanes(normals: &mut [[u32; 3]], code: &impl Fn(usize) -> u32) -> usize {
    use core::arch::wasm32::*;
    let (scale, one, minus, zero) = (
        f32x4_splat(OCT_SCALE),
        f32x4_splat(1.0),
        f32x4_splat(-1.0),
        f32x4_splat(0.0),
    );
    let byte = u32x4_splat(255);
    let unit = |q: v128| {
        f32x4_sub(
            f32x4_mul(f32x4_convert_u32x4(v128_and(q, byte)), scale),
            one,
        )
    };
    let sign = |v: v128| v128_bitselect(one, minus, f32x4_ge(v, zero));
    let mut done = 0;
    for chunk in normals.as_chunks_mut::<4>().0 {
        let q = u32x4(code(done), code(done + 1), code(done + 2), code(done + 3));
        let (x, y) = (unit(q), unit(u32x4_shr(q, 8)));
        let (ax, ay) = (f32x4_abs(x), f32x4_abs(y));
        let z = f32x4_sub(f32x4_sub(one, ax), ay);
        let fold = f32x4_lt(z, zero);
        let x = v128_bitselect(f32x4_mul(f32x4_sub(one, ay), sign(x)), x, fold);
        let y = v128_bitselect(f32x4_mul(f32x4_sub(one, ax), sign(y)), y, fold);
        let sum = f32x4_add(f32x4_add(f32x4_mul(x, x), f32x4_mul(y, y)), f32x4_mul(z, z));
        let length = f32x4_sqrt(sum);
        let n = [x, y, z].map(|v| f32x4_div(v, length));
        chunk[0] = n.map(|v| u32x4_extract_lane::<0>(v));
        chunk[1] = n.map(|v| u32x4_extract_lane::<1>(v));
        chunk[2] = n.map(|v| u32x4_extract_lane::<2>(v));
        chunk[3] = n.map(|v| u32x4_extract_lane::<3>(v));
        done += 4;
    }
    done
}

/// Without `simd128`, every normal goes through `oct_decode` itself.
#[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
fn lanes(_: &mut [[u32; 3]], _: &impl Fn(usize) -> u32) -> usize {
    0
}
