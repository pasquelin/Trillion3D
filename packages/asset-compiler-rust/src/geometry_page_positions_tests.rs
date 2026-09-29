//! Equivalence harness of CMP-10 (#960, E0): a page that stores each position once decodes to
//! the very words develop's page decoded to. Develop's outcome of every case — the SHA-256 of the
//! decoded words, or the refusal — and its page bytes are frozen below, measured on develop
//! `a563999f0` with this same harness; the cases are flat-shaded and smooth random meshes, the
//! signed zeros, NaN and infinities, the empty page and the largest one.

use crate::geometry_page::{encode, Attribute, FLAG_COLOR, FLAG_NORMAL, FLAG_UV};
use crate::tests::random::Xorshift;
use sha2::{Digest, Sha256};

/// A mesh on its source vertices: positions, then optional attributes, then triangles.
struct Mesh {
    positions: Vec<f32>,
    attributes: Vec<Attribute>,
    indices: Vec<u32>,
}

/// A `side × side` height field of random heights; `flat` gives every triangle its own three
/// vertices under the face normal (a flat-shaded export), otherwise one vertex per grid point.
fn field(rng: &mut Xorshift, side: usize, flat: bool, flags: u32) -> Mesh {
    let step = 0.05 + rng.unit() * 2.0;
    let point = |x: usize, y: usize, h: f32| [x as f32 * step, h, y as f32 * step];
    let heights: Vec<f32> = (0..side * side).map(|_| rng.unit() * 3.0 - 1.5).collect();
    let mut grid = Vec::new();
    for y in 0..side - 1 {
        for x in 0..side - 1 {
            let a = y * side + x;
            grid.extend([a, a + side, a + 1, a + 1, a + side, a + side + 1]);
        }
    }
    let corner = |i: usize| point(i % side, i / side, heights[i]);
    let (mut positions, mut normals, mut indices) = (Vec::new(), Vec::new(), Vec::new());
    if flat {
        for t in grid.chunks(3) {
            let [a, b, c] = [corner(t[0]), corner(t[1]), corner(t[2])];
            let (u, v) = (
                [0, 1, 2].map(|k| b[k] - a[k]),
                [0, 1, 2].map(|k| c[k] - a[k]),
            );
            let n = [
                u[1] * v[2] - u[2] * v[1],
                u[2] * v[0] - u[0] * v[2],
                u[0] * v[1] - u[1] * v[0],
            ];
            for p in [a, b, c] {
                indices.push((positions.len() / 3) as u32);
                positions.extend(p);
                normals.extend(n);
            }
        }
    } else {
        for i in 0..side * side {
            positions.extend(corner(i));
            normals.extend([0.0, 1.0, 0.0]);
        }
        indices = grid.iter().map(|&i| i as u32).collect();
    }
    let count = positions.len() / 3;
    let mut attributes = vec![Attribute {
        flag: FLAG_NORMAL,
        width: 3,
        values: normals,
    }];
    for (flag, width) in [(FLAG_UV, 2), (FLAG_COLOR, 4)] {
        if flags & flag != 0 {
            let values = positions
                .chunks(3)
                .flat_map(|p| [p[0] * 0.1, p[2] * 0.1, p[1] * 0.2 + 0.5, 1.0])
                .take(count * 4)
                .enumerate()
                .filter(|(i, _)| i % 4 < width)
                .map(|(_, v)| v)
                .collect();
            attributes.push(Attribute {
                flag,
                width,
                values,
            });
        }
    }
    Mesh {
        positions,
        attributes,
        indices,
    }
}

/// What a mesh becomes: the digest of the decoded words and the page bytes, or the refusal code.
fn outcome(mesh: &Mesh, exponent: i32) -> (String, usize) {
    let carried: Vec<&Attribute> = mesh.attributes.iter().collect();
    match encode(&mesh.indices, &mesh.positions, &carried, exponent, -14) {
        Ok(page) => {
            let decoded = trillion3d_page_codec::decode(&page.bytes, 1 << 28).expect("decodes");
            let mut hash = Sha256::new();
            for word in &decoded.words {
                hash.update(word.to_le_bytes());
            }
            (
                format!("{:x}", hash.finalize())[..16].to_string(),
                page.bytes.len(),
            )
        }
        Err(error) => (error.code.to_string(), 0),
    }
}

/// Every case of the harness by name: random flat-shaded and smooth meshes, then the edges.
fn cases() -> Vec<(String, Mesh, i32)> {
    let mut rng = Xorshift::new(960);
    let mut out = Vec::new();
    for i in 0..60 {
        let flags = [0, FLAG_UV, FLAG_COLOR, FLAG_UV | FLAG_COLOR][rng.below(4)];
        let (side, flat) = (2 + rng.below(11), i % 3 != 2);
        let exponent = -12 + rng.below(8) as i32;
        out.push((
            format!("random {i}"),
            field(&mut rng, side, flat, flags),
            exponent,
        ));
    }
    // ±0: a flat-shaded page whose every other coordinate is a negative zero.
    let mut zeros = field(&mut rng, 5, true, 0);
    for (i, value) in zeros.positions.iter_mut().enumerate() {
        *value = if i % 2 == 0 { -0.0 } else { value.abs() * 0.0 };
    }
    out.push(("signed zeros".into(), zeros, -10));
    for (name, bad) in [
        ("NaN", f32::NAN),
        ("+Inf", f32::INFINITY),
        ("-Inf", -f32::INFINITY),
    ] {
        let mut mesh = field(&mut rng, 4, true, 2);
        mesh.positions[7] = bad;
        out.push((format!("{name} position"), mesh, -10));
        let mut mesh = field(&mut rng, 4, true, 2);
        mesh.attributes[0].values[4] = bad;
        out.push((format!("{name} normal"), mesh, -10));
    }
    let mut empty = field(&mut rng, 3, true, 0);
    empty.indices.clear();
    out.push(("empty".into(), empty, -10));
    // The largest page: 21,845 flat triangles, 65,535 vertices; then one triangle more.
    for (name, corners) in [("65,535 vertices", 65_535), ("65,538 vertices", 65_538)] {
        let mut mesh = field(&mut Xorshift::new(106), 106, true, FLAG_UV | FLAG_COLOR);
        mesh.indices.truncate(corners);
        out.push((name.into(), mesh, -10));
    }
    // A position range of 2^24 − 1 steps, the widest field, and one step more.
    for (name, span) in [
        ("widest range", 16_777_215.0),
        ("range past 24 bits", 16_777_216.0),
    ] {
        let mut mesh = field(&mut rng, 2, true, 0);
        mesh.positions.iter_mut().for_each(|v| *v = 0.0);
        mesh.positions[0] = span;
        out.push((name.into(), mesh, 0));
    }
    out
}

/// Develop's outcome of every case, in order: name, digest or refusal, page bytes.
const DEVELOP: &str = include_str!("geometry_page_positions_develop.tsv");

// Behaviour: every case decodes to the words develop decoded it to, or is refused alike, in no
// more page bytes; the flat-shaded pages, their positions stored once, in fewer.
#[test]
fn every_page_decodes_as_on_develop_and_flat_shaded_pages_weigh_less() {
    let develop: Vec<Vec<&str>> = DEVELOP.lines().map(|l| l.split('\t').collect()).collect();
    let all = cases();
    assert_eq!(all.len(), develop.len());
    let (mut before, mut after, mut flat_before, mut flat_after) = (0, 0, 0, 0);
    for ((name, mesh, exponent), row) in all.iter().zip(&develop) {
        let (digest, bytes) = outcome(mesh, *exponent);
        let was: usize = row[2].parse().expect("develop bytes");
        assert_eq!((name.as_str(), digest.as_str()), (row[0], row[1]));
        assert!(bytes <= was, "{name}: {bytes} > {was} bytes");
        (before, after) = (before + was, after + bytes);
        if mesh
            .indices
            .iter()
            .enumerate()
            .all(|(k, &i)| i as usize == k)
        {
            (flat_before, flat_after) = (flat_before + was, flat_after + bytes);
        }
    }
    println!("pages {before} -> {after} bytes; flat-shaded {flat_before} -> {flat_after}");
    assert!(flat_after < flat_before);
}
