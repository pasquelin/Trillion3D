//! A page's whole normal stream through `oct_decode`, four normals at a time on `simd128` lanes.

use super::oct_decode;

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
        f32x4_splat(super::OCT_SCALE),
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
