//! Shared decoder golden test: what `geometry_page::encode` writes, `web_geometry_page_codec`
//! re-reads — same indices, same floats bit for bit, same refusals.

use crate::geometry_page::{encode, localise, Attribute, STRIDE};
use web_geometry_page_codec as codec;

/// Five optional page attributes, with offsets set by `compiler_primitive.rs`.
const PLAN: [(usize, usize, usize, u32); 5] = [
    (12, 3, 3, 1),
    (24, 2, 2, 2),
    (32, 4, 4, 4),
    (48, 2, 2, 8),
    (56, 4, 3, 16),
];

fn xorshift(etat: &mut u32) -> u32 {
    *etat ^= *etat << 13;
    *etat ^= *etat >> 17;
    *etat ^= *etat << 5;
    *etat
}

/// Hostile but finite floats: encoder refuses NaN and Infinity, rest passes.
/// Negative zero, denormals, extremes, bit patterns retained as is.
fn hostile(etat: &mut u32) -> f32 {
    let brut = xorshift(etat);
    match brut % 8 {
        0 => 0.0,
        1 => -0.0,
        2 => f32::MIN_POSITIVE,
        3 => -f32::MIN_POSITIVE / 3.0,
        4 => f32::MAX,
        5 => -f32::MAX,
        _ => {
            let value = f32::from_bits(brut);
            if value.is_finite() {
                value
            } else {
                brut as f32 / 7.0 - 1.5
            }
        }
    }
}

fn attributs(count: usize, etat: &mut u32) -> Vec<Attribute> {
    PLAN.iter()
        .map(|&(offset, width, source_width, flag)| Attribute {
            offset,
            width,
            source_width,
            flag,
            values: (0..count * source_width).map(|_| hostile(etat)).collect(),
        })
        .collect()
}

/// Mesh with every vertex touched, repeated triangles and shared vertices.
fn maillage(vertices: usize, etat: &mut u32) -> (Vec<u32>, Vec<f32>) {
    let positions = (0..vertices * 3).map(|_| hostile(etat)).collect();
    let mut indices = Vec::with_capacity(vertices * 3);
    for i in 0..vertices {
        indices.push(i as u32);
        indices.push(((i + 1) % vertices) as u32);
        indices.push((xorshift(etat) as usize % vertices) as u32);
    }
    (indices, positions)
}

/// Each float of decoded page, compared bit for bit to source value. Attribute wider
/// than source carries 1.0 in last position, as encoder writes.
fn verifie(page: &codec::DecodedPage, original: &[u32], positions: &[f32], attrs: &[Attribute]) {
    for (i, &source) in original.iter().enumerate() {
        let source = source as usize;
        for c in 0..3 {
            assert_eq!(
                page.position[i * 3 + c].to_bits(),
                positions[source * 3 + c].to_bits(),
                "position {i} {c}"
            );
        }
        for (rang, attribute) in attrs.iter().enumerate() {
            let sortie = page.optional[rang].as_ref().expect("decoded attribute");
            for c in 0..attribute.width {
                let attendu = if c < attribute.source_width {
                    attribute.values[source * attribute.source_width + c]
                } else {
                    1.0
                };
                assert_eq!(
                    sortie[i * attribute.width + c].to_bits(),
                    attendu.to_bits(),
                    "attribut {rang} sommet {i} voie {c}"
                );
            }
        }
    }
}

/// Meshopt index codec preserves triangles and order, but chooses own
/// rotation for each: format property, not decoder, JavaScript decoder
/// yields exact same indices. Test requires triangle-by-triangle rotation,
/// same vertices, same traversal direction, same rank.
fn memes_triangles(local: &[u32], decodes: &[u32]) {
    assert_eq!(local.len(), decodes.len());
    for (t, triangle) in local.chunks(3).enumerate() {
        let obtenu = &decodes[t * 3..t * 3 + 3];
        let rotations = [
            [triangle[0], triangle[1], triangle[2]],
            [triangle[1], triangle[2], triangle[0]],
            [triangle[2], triangle[0], triangle[1]],
        ];
        assert!(
            rotations.iter().any(|r| r == obtenu),
            "triangle {t} : {obtenu:?} n'est pas une rotation de {triangle:?}"
        );
    }
}

fn aller_retour(vertices: usize, graine: u32) {
    let mut etat = graine;
    let (indices, positions) = maillage(vertices, &mut etat);
    let attrs = attributs(vertices, &mut etat);
    let (bytes, flags, vertex_count) = encode(&indices, &positions, &attrs).expect("encode");
    let (original, local) = localise(&indices, vertices).expect("localise");
    let page = codec::decode(&bytes, 64 << 20).expect("decode");
    assert_eq!(page.flags, flags);
    assert_eq!(page.vertex_count, vertex_count);
    assert_eq!(
        page.decoded_bytes,
        vertex_count * STRIDE + indices.len() * 2
    );
    memes_triangles(&local, &page.indices);
    verifie(&page, &original, &positions, &attrs);
}

#[test]
fn page_doree_relue_au_bit_pres() {
    for (vertices, graine) in [(3usize, 1u32), (17, 7), (1024, 99), (65_535, 424_242)] {
        aller_retour(vertices, graine);
    }
}

#[test]
fn sans_attribut_facultatif_la_page_ne_porte_que_ses_positions() {
    let positions = [0f32, 0., 0., 1., 0., 0., 0., 1., 0.];
    let (bytes, _, _) = encode(&[0, 1, 2], &positions, &[]).expect("encode");
    let page = codec::decode(&bytes, 1 << 20).expect("decode");
    assert_eq!(page.flags, 0);
    assert!(page.optional.iter().all(Option::is_none));
    for (c, value) in positions.iter().enumerate() {
        assert_eq!(page.position[c].to_bits(), value.to_bits());
    }
}
