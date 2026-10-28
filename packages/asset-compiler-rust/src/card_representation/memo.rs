//! A mesh's cards kept by what they were built from (`support::derived`): the key hashes the
//! mesh's triangles as the build reads them, the materials that change them (two-sidedness and
//! blending), the box the cards are fitted in, the build's settings and the compiler's
//! implementation, so that a mesh met again — as another instance, or in another compilation —
//! has its cards read, byte for byte what building them again gives.
use super::build::MeshCards;
use super::cards::Card;
use super::CardSettings;
use crate::compiler::cache::digest::hash;
use crate::compiler::primitive::triangles::mesh_primitives;
use crate::trace::surface::Traceable;
use crate::Result;
use serde_json::Value;

type Vec3 = [f64; 3];

/// What the derived results of the cards are filed under.
pub(super) const KIND: &str = "cards";
/// The numbers a stored card holds: its origin, its extent and its three axes.
const CARD_NUMBERS: usize = 15;
/// The bytes of a stored card: those numbers, then its direction.
const CARD_BYTES: usize = CARD_NUMBERS * 8 + 4;
/// The bytes that lead a stored mesh: its box, whether it is mostly two-sided, its card count.
const HEAD_BYTES: usize = 6 * 8 + 1 + 4;
/// Which build made the bytes: the cards are cast on the CPU, in double precision.
const BUILD_PATH: &str = "cpu-f64";

/// The key of the cards of mesh `mesh` of the scene `read`, fitted in `bounds` as `settings` say,
/// every triangle two-sided when `as_if_two_sided`; `bounds` none when they are the triangles' own.
pub(super) fn key(
    (g, bin): (&Value, &[u8]),
    mesh: usize,
    (settings, as_if_two_sided, bounds): (&CardSettings, bool, Option<(Vec3, Vec3)>),
) -> Result<String> {
    let traceable = Traceable::read(g, bin, mesh, &[])?;
    let mut bytes = Vec::new();
    for text in [BUILD_PATH, crate::implementation_hash()] {
        bytes.extend((text.len() as u64).to_le_bytes());
        bytes.extend(text.as_bytes());
    }
    let (low, high) = bounds.unzip();
    let numbers = [settings.min_density, settings.normal_threshold]
        .into_iter()
        .chain(low.into_iter().flatten())
        .chain(high.into_iter().flatten());
    bytes.extend(settings.max_cards.to_le_bytes());
    bytes.extend(numbers.flat_map(|v| v.to_bits().to_le_bytes()));
    bytes.extend([u8::from(as_if_two_sided), u8::from(bounds.is_some())]);
    for (index, primitive) in mesh_primitives(g, mesh)? {
        let range = traceable.primitives.iter().find(|(i, _)| *i == index);
        let (start, end) = range.map_or((0, 0), |(_, r)| (r.start, r.end));
        let material = primitive.get("material").and_then(Value::as_u64);
        let named = material.and_then(|id| g.pointer(&format!("/materials/{id}")));
        bytes.extend((start as u64).to_le_bytes());
        bytes.extend((end as u64).to_le_bytes());
        bytes.extend(serde_json::to_vec(&named)?);
    }
    let triangles = &traceable.world.triangles;
    bytes.extend(triangles.iter().flat_map(|v| v.to_bits().to_le_bytes()));
    bytes.extend((0..triangles.len() / 9).map(|t| u8::from(traceable.surface(t).blend)));
    Ok(hash(&bytes))
}

/// The bytes of `cards`: every number as it is held.
pub(super) fn encode(cards: &MeshCards) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(HEAD_BYTES + cards.cards.len() * CARD_BYTES);
    let numbers = |bytes: &mut Vec<u8>, values: &[f64]| {
        bytes.extend(values.iter().flat_map(|v| v.to_bits().to_le_bytes()));
    };
    numbers(&mut bytes, &cards.low);
    numbers(&mut bytes, &cards.high);
    bytes.push(u8::from(cards.mostly_two_sided));
    bytes.extend((cards.cards.len() as u32).to_le_bytes());
    for card in &cards.cards {
        numbers(&mut bytes, &card.origin);
        numbers(&mut bytes, &card.extent);
        card.axes.iter().for_each(|axis| numbers(&mut bytes, axis));
        bytes.extend((card.direction as u32).to_le_bytes());
    }
    bytes
}

/// The cards `bytes` hold, none when they are not what `encode` writes.
pub(super) fn decode(bytes: &[u8]) -> Option<MeshCards> {
    let count =
        u32::from_le_bytes(bytes.get(HEAD_BYTES - 4..HEAD_BYTES)?.try_into().ok()?) as usize;
    if bytes.len() != HEAD_BYTES + count * CARD_BYTES {
        return None;
    }
    let number =
        |at: usize| f64::from_bits(u64::from_le_bytes(bytes[at..at + 8].try_into().unwrap()));
    let vec3 = |at: usize| [0, 1, 2].map(|k| number(at + k * 8));
    let cards = (0..count)
        .map(|c| {
            let at = HEAD_BYTES + c * CARD_BYTES;
            let direction = u32::from_le_bytes(
                bytes[at + CARD_NUMBERS * 8..at + CARD_BYTES]
                    .try_into()
                    .unwrap(),
            );
            Card {
                origin: vec3(at),
                extent: vec3(at + 24),
                axes: [0, 1, 2].map(|k| vec3(at + 48 + k * 24)),
                direction: direction as usize,
            }
        })
        .collect();
    Some(MeshCards {
        low: vec3(0),
        high: vec3(24),
        mostly_two_sided: bytes[48] != 0,
        cards,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Behaviour: cards read back are the cards stored, to the bit, and bytes that are not a
    // stored mesh are refused so that they are built again.
    #[test]
    fn stored_cards_read_back_whole() {
        let card = |k: f64, direction| Card {
            origin: [k, -k, 0.1 * k],
            extent: [1.0 / 3.0, k, f64::MIN_POSITIVE],
            axes: [[1.0, 0.0, 0.0], [0.0, -1.0, 0.0], [0.0, 0.0, 0.5 + k]],
            direction,
        };
        let cards = MeshCards {
            low: [-1.5, 0.25, 3.0],
            high: [2.0, 9.0, 3.5],
            mostly_two_sided: true,
            cards: vec![card(1.0, 0), card(2.5, 5)],
        };
        let bytes = encode(&cards);
        let back = decode(&bytes).expect("whole");
        assert_eq!(encode(&back), bytes);
        assert_eq!(back.cards.len(), 2);
        assert_eq!(back.cards[1].direction, 5);
        assert!(back.mostly_two_sided);
        assert!(decode(&bytes[..bytes.len() - 1]).is_none());
        assert!(decode(&[]).is_none());
    }
}
