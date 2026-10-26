//! The scene's height maps read from its images: a 16-bit one at its precision, one image shared by
//! every map that names it, the texels counted from the headers.
use crate::displace::{Bakes, DisplacementSettings, MapSpec};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::path::Path;

/// A PNG of 2 × 1 texels of the 16-bit grey `values`, as its bytes.
fn png16(values: [u16; 2]) -> Vec<u8> {
    let grey = image::ImageBuffer::<image::Luma<u16>, Vec<u16>>::from_raw(2, 1, values.to_vec());
    let image = image::DynamicImage::ImageLuma16(grey.expect("two texels"));
    let mut bytes = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut bytes, image::ImageFormat::Png)
        .expect("encoded");
    bytes.into_inner()
}

/// A scene of one texture over the image `png`, held in the binary.
fn scene(png: &[u8]) -> Value {
    json!({
        "textures": [{"source": 0}],
        "images": [{"bufferView": 0, "mimeType": "image/png"}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": png.len()}],
    })
}

/// A mesh's settings naming texture 0 once for each of `magnitudes`.
fn named(magnitudes: &[f32]) -> DisplacementSettings {
    DisplacementSettings {
        maps: (magnitudes.iter())
            .map(|&magnitude| MapSpec {
                texture: 0,
                magnitude,
                center: 0.0,
            })
            .collect(),
        ..DisplacementSettings::default()
    }
}

#[test]
fn a_16_bit_height_map_is_read_at_its_precision() {
    let png = png16([0, 25_800]);
    let g = scene(&png);
    let settings = named(&[1.0]);
    let bakes = Bakes::new([Some(&settings)], (&g, &png, Path::new(".")));
    let bake = bakes.of(0).expect("read").expect("bakes");
    // The centre of the second texel; a magnitude of a metre is a hundred centimetres. A byte
    // would hold 100/255 of it, a hundredth short.
    let height = bake.maps[0].sample([0.75, 0.5]);
    assert!(
        (height - 100.0 * 25_800.0 / 65_535.0).abs() < 1e-3,
        "{height}"
    );
}

#[test]
fn the_maps_that_name_a_texture_share_its_image_whatever_their_magnitude() {
    let png = png16([0, 65_535]);
    let g = scene(&png);
    let settings = named(&[1.0, 2.0]);
    let bakes = Bakes::new([Some(&settings)], (&g, &png, Path::new(".")));
    let first = bakes.of(0).expect("read").expect("bakes");
    let again = bakes.of(0).expect("read").expect("bakes");
    let [a, b] = [&first.maps[0], &first.maps[1]];
    assert!(a.shares(b) && a.shares(&again.maps[0]));
    let uv = [0.75, 0.5];
    assert!((2.0 * a.sample(uv) - b.sample(uv)).abs() < 1e-3);
}

#[test]
fn the_texels_a_scene_reads_are_counted_from_the_headers_once_each() {
    let png = png16([0, 0]);
    let g = scene(&png);
    let settings = named(&[1.0, 2.0]);
    let bakes = Bakes::new([None, Some(&settings)], (&g, &png, Path::new(".")));
    assert_eq!(bakes.texels().expect("headers"), BTreeMap::from([(0, 2)]));
    assert!(!bakes.names(0) && bakes.names(1));
    assert_eq!(bakes.textures(1), vec![0, 0]);
}

#[test]
fn a_texture_that_names_no_image_is_refused_by_name() {
    let png = png16([0, 0]);
    let mut g = scene(&png);
    g["textures"] = json!([{}]);
    let settings = named(&[1.0]);
    let bakes = Bakes::new([Some(&settings)], (&g, &png, Path::new(".")));
    let refusal = bakes.of(0).err().expect("refused").message;
    assert!(refusal.contains("texture 0 names no image"), "{refusal}");
}
