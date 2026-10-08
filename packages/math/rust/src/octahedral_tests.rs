use super::*;

/// The cases of `section` in `packages/math/golden/oct.json`: inputs and outputs as raw bits.
fn golden(section: &str) -> Vec<(Vec<u32>, Vec<u32>)> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../golden/oct.json");
    let text = std::fs::read_to_string(path).expect("the golden file exists");
    let bits = |token: &&str| match token.split_once(':').expect("a typed value") {
        ("f32", hex) => u32::from_str_radix(hex, 16).expect("f32 bits"),
        ("u32", value) => value.parse().expect("an unsigned integer"),
        (kind, _) => panic!("unexpected kind {kind}"),
    };
    let mut current = "";
    let mut cases = Vec::new();
    for line in text.lines().map(str::trim) {
        let tokens: Vec<&str> = line.split('"').skip(1).step_by(2).collect();
        if line.ends_with(": {") {
            current = tokens[0];
        } else if current == section && line.starts_with("{\"in\":") {
            let out = tokens.iter().position(|&t| t == "out").expect("outputs");
            let inputs = tokens[1..out].iter().map(bits).collect();
            cases.push((inputs, tokens[out + 1..].iter().map(bits).collect()));
        }
    }
    assert!(!cases.is_empty(), "{section} has cases");
    cases
}

/// Two floats alike: the same bits, or both NaN.
fn same(a: f32, b: f32) -> bool {
    a.to_bits() == b.to_bits() || a.is_nan() && b.is_nan()
}

#[test]
fn oct_encode_gives_the_reference_bytes() {
    for (inputs, outputs) in golden("oct_encode") {
        let normal = [0, 1, 2].map(|c| f32::from_bits(inputs[c]));
        assert_eq!(oct_encode(normal), outputs[0], "{normal:?}");
    }
    assert_eq!(oct_encode([0.0; 3]), 128 | (128 << 8));
}

#[test]
fn oct_decode_gives_the_reference_normals() {
    for (inputs, outputs) in golden("oct_decode") {
        let decoded = oct_decode(inputs[0]);
        for c in 0..3 {
            assert!(same(decoded[c], f32::from_bits(outputs[c])), "{inputs:?}");
        }
    }
    let [x, y, z] = oct_decode(128 | (128 << 8));
    assert!(z > 0.99 && x.abs() < 0.01 && y.abs() < 0.01);
}

/// Unit directions spread over the sphere, the same on every run.
fn directions() -> Vec<[f64; 3]> {
    let mut state = crate::GOLDEN;
    let mut next = || crate::random::splitmix_draw(&mut state) * 2.0 - 1.0;
    (0..2000)
        .filter_map(|_| crate::vec3::unit([next(), next(), next()]))
        .collect()
}

#[test]
fn octahedral_decode_inverts_octahedral_encode_on_the_sphere() {
    for d in directions() {
        let uv = octahedral_encode(d, false);
        let back = octahedral_decode(uv.map(|x| x * 0.5 + 0.5), false);
        let error = crate::vec3::length(crate::vec3::sub(back, d));
        assert!(error < 1e-12, "{d:?} came back {back:?}");
    }
}

#[test]
fn octahedral_hemi_maps_the_upper_half_and_flattens_the_lower() {
    for d in directions().into_iter().filter(|d| d[1] >= 0.0) {
        let uv = octahedral_encode(d, true);
        let back = octahedral_decode(uv.map(|x| x * 0.5 + 0.5), true);
        assert!(crate::vec3::length(crate::vec3::sub(back, d)) < 1e-12);
    }
    assert_eq!(octahedral_encode([0.0, -1.0, 0.0], true), [0.0, 0.0]);
    let below = octahedral_encode([1.0, -5.0, 0.0], true);
    assert_eq!(below, octahedral_encode([1.0, 0.0, 0.0], true));
}

#[test]
fn octahedral_poles_and_folds_land_on_the_square() {
    assert_eq!(octahedral_encode([0.0, 1.0, 0.0], false), [0.0, 0.0]);
    assert_eq!(octahedral_encode([0.0, -1.0, 0.0], false), [1.0, 1.0]);
    assert_eq!(octahedral_encode([1.0, 0.0, 0.0], false), [1.0, 0.0]);
    assert_eq!(octahedral_decode([0.5, 0.5], false), [0.0, 1.0, 0.0]);
    assert_eq!(octahedral_decode([1.0, 1.0], false), [0.0, -1.0, 0.0]);
    assert_eq!(octahedral_decode([0.5, 0.5], true), [0.0, 1.0, 0.0]);
}
