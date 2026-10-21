//! The bytes of `animation-banks.bin`, laid out as the banks' module states it (`bank.rs`): the
//! header — magic, version, the bakes, the items and the pool's floats —, each bake's words, each
//! item's words, then the pool of every bake's floats, inverse binds before keys, each value a
//! little-endian 4-byte word. A count past 32 bits is refused rather than cut to fit.
use super::*;

/// `animation-banks.bin` of `bakes` and `items`, as the module lays it out.
pub(super) fn encode(bakes: &[Bake], items: &[Item]) -> Result<Vec<u8>> {
    let word = |count: usize| {
        u32::try_from(count)
            .map_err(|_| invalid(format!("animation banks: {count} does not fit 32 bits")))
    };
    let float = |value: f64| (value as f32).to_bits();
    let pool: usize = bakes.iter().map(|bake| bake.floats.len()).sum();
    let mut words = Vec::with_capacity(
        ANIMATION_BANKS_HEADER_WORDS
            + bakes.len() * ANIMATION_BANK_BAKE_WORDS
            + items.len() * ANIMATION_BANK_ITEM_WORDS
            + pool,
    );
    let (magic, version) = (ANIMATION_BANKS_MAGIC, ANIMATION_BANKS_VERSION);
    words.extend([
        magic,
        version,
        word(bakes.len())?,
        word(items.len())?,
        word(pool)?,
    ]);
    let mut at = 0;
    for bake in bakes {
        let keys = at + bake.joints * ANIMATION_BANK_INVERSE_FLOATS;
        words.extend([
            word(bake.joints)?,
            word(bake.frames)?,
            word(at)?,
            word(keys)?,
        ]);
        at += bake.floats.len();
    }
    for item in items {
        let flags = if item.looping {
            ANIMATION_BANK_LOOPING
        } else {
            0
        };
        let played = [item.position, item.play_rate, item.min_screen_size].map(float);
        words.extend([word(item.bake)?, flags]);
        words.extend(played);
        words.extend(item.bounds.map(float));
        words.push(word(item.mesh)?);
    }
    words.extend(
        bakes
            .iter()
            .flat_map(|bake| bake.floats.iter().map(|value| value.to_bits())),
    );
    Ok(words.iter().flat_map(|value| value.to_le_bytes()).collect())
}
