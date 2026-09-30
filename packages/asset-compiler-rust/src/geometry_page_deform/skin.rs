use super::*;
use trillion3d_page_codec::bits::bits_for;
use trillion3d_page_codec::deform::MAX_JOINT_BITS;

pub(super) fn skin_fields(
    joints: &[u32],
    weights: &[f32],
    influences: usize,
    original: &[u32],
    fields: &mut [Vec<u32>],
) -> Result<Skin> {
    let at = |v: u32| v as usize * influences..(v as usize + 1) * influences;
    let used = original.iter().flat_map(|&v| joints[at(v)].iter().copied());
    let (base, top) = used.fold((u32::MAX, 0), |(lo, hi), j| (lo.min(j), hi.max(j)));
    let bits = bits_for(top - base);
    if bits > MAX_JOINT_BITS || top > 0xffff {
        return Err(CompilerError::new(
            "PAGE_JOINT_RANGE",
            "A page names a joint past 65,535",
        ));
    }
    // The reader bounds every field the width allows, `base + 2^bits - 1`, to 65,535: a base that
    // high comes down, the width unchanged since `top` stays within it.
    let base = base.min(0x1_0000 - (1u32 << bits));
    for (vertex, &v) in fields.iter_mut().zip(original) {
        vertex.extend(joints[at(v)].iter().map(|j| j - base));
        vertex.extend(weights[at(v)].iter().map(|w| w.to_bits()));
    }
    Ok(Skin {
        base,
        bits,
        influences,
    })
}
