//! Integer sequence encoding of ASTC for the two ranges the writers use: the
//! 192-level endpoint range — a trit and six bits per value — and the five-level
//! quint weights of the two-channel block. Five trits share one byte, three
//! quints seven bits, laid out between the bit fields of their values; neither
//! is a base-3 or base-5 number but the layout the specification decodes, so
//! each table is built by running that decode over every packed value and
//! keeping the first that yields each tuple. The value a level decodes to comes
//! from the same specification: `(trit · 5 + B(m)) ^ A(m)`, its top bit kept,
//! then over four.
use std::sync::OnceLock;

/// Levels of the endpoint range: trit × 64 bit values.
pub const LEVELS: usize = 192;

/// The five trits a packed byte carries — the decode the specification gives.
fn trits_of(byte: u8) -> [u8; 5] {
    let bit = |value: u8, at: u8| (value >> at) & 1;
    let (c, t3, t4) = if (byte >> 2) & 7 == 7 {
        ((byte >> 5) << 2 | (byte & 3), 2, 2)
    } else if (byte >> 5) & 3 == 3 {
        (byte & 0x1f, bit(byte, 7), 2)
    } else {
        (byte & 0x1f, (byte >> 5) & 3, bit(byte, 7))
    };
    let (t0, t1, t2) = if c & 3 == 3 {
        ((bit(c, 3) << 1) | (bit(c, 2) & !bit(c, 3)), bit(c, 4), 2)
    } else if (c >> 2) & 3 == 3 {
        (c & 3, 2, 2)
    } else {
        (
            (bit(c, 1) << 1) | (bit(c, 0) & !bit(c, 1)),
            (c >> 2) & 3,
            bit(c, 4),
        )
    };
    [t0, t1, t2, t3, t4]
}

/// Packed byte of five trits, by their base-3 rank.
fn packed_trits(trits: [u8; 5]) -> u8 {
    static TABLE: OnceLock<[u8; 243]> = OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut table = [u8::MAX; 243];
        for byte in (0..=255u8).rev() {
            let t = trits_of(byte);
            let rank = t.iter().rev().fold(0usize, |acc, &v| acc * 3 + v as usize);
            table[rank] = byte;
        }
        table
    });
    table[trits
        .iter()
        .rev()
        .fold(0usize, |acc, &v| acc * 3 + v as usize)]
}

/// The three quints a packed seven-bit value carries — the decode the specification gives.
fn quints_of(q: u8) -> [u8; 3] {
    let bits = |value: u8, lo: u8, width: u8| (value >> lo) & ((1 << width) - 1);
    if bits(q, 1, 2) == 3 && bits(q, 5, 2) == 0 {
        let q0 = bits(q, 0, 1);
        let q2 = (q0 << 2) | ((bits(q, 4, 1) & !q0) << 1) | (bits(q, 3, 1) & !q0);
        return [4, 4, q2];
    }
    let (q2, c) = if bits(q, 1, 2) == 3 {
        (
            4,
            (bits(q, 3, 2) << 3) | ((!bits(q, 5, 2) & 3) << 1) | bits(q, 0, 1),
        )
    } else {
        (bits(q, 5, 2), bits(q, 0, 5))
    };
    if bits(c, 0, 3) == 5 {
        [bits(c, 3, 2), 4, q2]
    } else {
        [bits(c, 0, 3), bits(c, 3, 2), q2]
    }
}

/// Packed seven bits of three quints, by their base-5 rank.
pub fn packed_quints(quints: [u8; 3]) -> u8 {
    static TABLE: OnceLock<[u8; 125]> = OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut table = [u8::MAX; 125];
        for packed in (0..128u8).rev() {
            let q = quints_of(packed);
            table[q.iter().rev().fold(0usize, |acc, &v| acc * 5 + v as usize)] = packed;
        }
        table
    });
    table[quints
        .iter()
        .rev()
        .fold(0usize, |acc, &v| acc * 5 + v as usize)]
}

/// The byte a level decodes to. `level` is `trit · 64 + m`.
pub fn unquantise(level: u8) -> u8 {
    let (trit, m) = (u32::from(level / 64), u32::from(level % 64));
    let a = if m & 1 == 1 { 0x1ff } else { 0 };
    let x = m >> 1;
    let b = (x << 4) | (x >> 4);
    ((a & 0x80) | (((trit * 5 + b) ^ a) >> 2)) as u8
}

/// Level whose decoded byte is nearest to `value`, lowest on a tie.
pub fn quantise(value: f32) -> u8 {
    static NEAREST: OnceLock<[u8; 256]> = OnceLock::new();
    let nearest = NEAREST.get_or_init(|| {
        let mut table = [0u8; 256];
        for (byte, slot) in table.iter_mut().enumerate() {
            let mut best = (u32::MAX, 0u8);
            for level in 0..LEVELS as u8 {
                let gap = u32::from(unquantise(level)).abs_diff(byte as u32);
                if gap < best.0 {
                    best = (gap, level);
                }
            }
            *slot = best.1;
        }
        table
    });
    nearest[value.round().clamp(0.0, 255.0) as usize]
}

/// Appends `values` — each `trit · 64 + m` — to `bits` from `at`, in groups of
/// five: the six bits of a value, then the two, two, one, two and one bits of
/// the packed trit byte between them, in the order the decoder reads. A last
/// group short of five values stops after its last value's trit bits, the
/// missing values counting as zero.
pub fn append(bits: &mut u128, at: &mut u32, values: &[u8]) {
    const TRIT_BITS: [(u32, u8); 5] = [(0, 2), (2, 2), (4, 1), (5, 2), (7, 1)];
    for group in values.chunks(5) {
        let mut trits = [0u8; 5];
        for (slot, value) in trits.iter_mut().zip(group) {
            *slot = value / 64;
        }
        let packed = packed_trits(trits);
        for (index, value) in group.iter().enumerate() {
            *bits |= u128::from(value % 64) << *at;
            *at += 6;
            let (shift, width) = TRIT_BITS[index];
            *bits |= u128::from((packed >> shift) & ((1 << width) - 1)) << *at;
            *at += u32::from(width);
        }
    }
}
