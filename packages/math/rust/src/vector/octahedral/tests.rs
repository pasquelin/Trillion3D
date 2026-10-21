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
