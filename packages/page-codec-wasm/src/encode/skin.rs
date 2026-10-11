use super::{EncodeError, Result};
use crate::bits::bits_for;
use crate::deform::{Skin, MAX_JOINT_BITS};

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
        return Err(EncodeError::new(
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

#[cfg(test)]
mod tests {
    use super::skin_fields;

    #[test]
    fn a_joint_base_near_the_top_stays_within_what_the_reader_admits() {
        let joints = vec![65000, 65535, 65000, 65000];
        let mut fields = vec![Vec::new()];
        let skin = skin_fields(&joints, &[1.0, 0.0, 0.0, 0.0], 4, &[0], &mut fields).unwrap();
        assert_eq!(skin.bits, 10);
        assert!(u64::from(skin.base) + (1u64 << skin.bits) - 1 <= 0xffff);
        assert_eq!(fields[0][1] + skin.base, 65535);
    }
}
