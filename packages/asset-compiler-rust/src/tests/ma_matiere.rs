//! Maya shader parameters around images: scalar weight of color,
//! `bump2d` mode, and `place2dTexture` placement.
use super::*;
use ma_driver::{compile_ma, shaded};

/// Scene `file` node and `place2dTexture` giving coordinates.
fn image(place: &str) -> String {
    format!(
        "createNode file -n \"Image\";\n\
         \tsetAttr \".ftn\" -type \"string\" \"textures/checker.png\";\n\
         createNode place2dTexture -n \"Placage\";\n{place}\
         connectAttr \"Placage.o\" \"Image.uv\";\n"
    )
}

/// glTF material of this name in intermediate scene.
fn material<'a>(gltf: &'a Value, name: &str) -> &'a Value {
    gltf["materials"]
        .as_array()
        .expect("materials")
        .iter()
        .find(|material| material["name"] == json!(name))
        .unwrap_or_else(|| panic!("no material named {name}"))
}

// Finding 19: image plugged into color does not hide multiplying scalar weight.
// `.dc` of lambert and `.e` of `standardSurface` gave white factors (2x bright);
// now passed to factor, texture remaining in place.
#[test]
fn the_scalar_weight_of_a_textured_colour_reaches_the_gltf_factor() {
    let body = format!(
        "createNode lambert -n \"Mat\";\n\
         \tsetAttr \".dc\" 0.5;\n\
         createNode standardSurface -n \"Lueur\";\n\
         \tsetAttr \".e\" 0.25;\n{}{}{}\
         connectAttr \"Image.oc\" \"Mat.c\";\n\
         connectAttr \"Image.oc\" \"Lueur.ec\";\n",
        image(""),
        shaded("Plaque", "Mat"),
        shaded("Lampe", "Lueur"),
    );
    let (_, gltf) = compile_ma("ma-poids-texture", &body).prepared("ma");
    let diffuse = material(&gltf, "Mat");
    assert_eq!(
        diffuse["pbrMetallicRoughness"]["baseColorFactor"],
        json!([0.5, 0.5, 0.5, 1.0]),
        "le poids diffus multiplie la texture : {diffuse}"
    );
    assert!(
        diffuse["pbrMetallicRoughness"]["baseColorTexture"]["index"].is_number(),
        "the texture stays attached: {diffuse}"
    );
    let lit = material(&gltf, "Lueur");
    assert_eq!(
        lit["emissiveFactor"],
        json!([0.25, 0.25, 0.25]),
        "the emission weight multiplies the texture: {lit}"
    );
    assert!(lit["emissiveTexture"]["index"].is_number(), "{lit}");
}

// Finding 20: `bump2d` is normal map only when `bumpInterp` says so. Taken
// as-is, height bump output as `normalTexture`, lighting surface
// with non-orientation image. Only tangent mode passes, `bumpDepth` carrying
// scale; other two counted by name.
#[test]
fn only_a_tangent_space_bump_becomes_a_normal_texture() {
    let bump = |name: &str, interp: &str| {
        format!(
            "createNode bump2d -n \"{name}Bosse\";\n{interp}\
             createNode lambert -n \"{name}\";\n\
             connectAttr \"Image.oc\" \"{name}Bosse.bv\";\n\
             connectAttr \"{name}Bosse.o\" \"{name}.n\";\n"
        )
    };
    let body = format!(
        "{}{}{}{}{}{}{}",
        image(""),
        bump("Hauteur", ""),
        bump("Tangente", "\tsetAttr \".bi\" 1;\n\tsetAttr \".bd\" 0.4;\n"),
        bump("Objet", "\tsetAttr \".bi\" 2;\n"),
        shaded("A", "Hauteur"),
        shaded("B", "Tangente"),
        shaded("C", "Objet"),
    );
    let (manifest, gltf) = compile_ma("ma-bump", &body).prepared("ma");
    assert!(
        material(&gltf, "Hauteur").get("normalTexture").is_none(),
        "un relief en hauteur n'est pas une carte de normales"
    );
    assert!(material(&gltf, "Objet").get("normalTexture").is_none());
    let tangent = &material(&gltf, "Tangente")["normalTexture"];
    assert!(tangent["index"].is_number(), "{tangent}");
    assert_eq!(
        tangent["scale"],
        json!(0.4),
        "`bumpDepth` carries the scale"
    );
    assert_eq!(manifest["unsupported"]["ma-bump-height-unsupported"], 1);
    assert_eq!(
        manifest["unsupported"]["ma-bump-object-space-unsupported"],
        1
    );
}

// Finding 21: `wrapU` and `wrapV` two attributes, glTF sampler two axes. Only
// `wrapU` read, `wrapV` followed: texture repeated on one axis clamped
// output clamped on both.
#[test]
fn wrap_u_and_wrap_v_reach_the_two_axes_of_the_sampler() {
    let body = format!(
        "createNode lambert -n \"Mat\";\n{}{}connectAttr \"Image.oc\" \"Mat.c\";\n",
        image("\tsetAttr \".wu\" no;\n"),
        shaded("Plaque", "Mat"),
    );
    let (_, gltf) = compile_ma("ma-wrap", &body).prepared("ma");
    let sampler = &gltf["samplers"][0];
    assert_eq!(sampler["wrapS"], json!(33071), "`wrapU` borne l'axe S");
    assert_eq!(
        sampler["wrapT"],
        json!(10497),
        "missing `wrapV` repeats the T axis: {sampler}"
    );
}

// Finding 21, other end: `place2dTexture` placement — repeat, offset, rotation,
// mirror — not supported in glTF without `KHR_texture_transform`.
// Unsupported items counted by name instead of silent loss.
#[test]
fn a_place2d_texture_placement_is_counted_rather_than_silently_dropped() {
    let body = format!(
        "createNode lambert -n \"Mat\";\n{}{}connectAttr \"Image.oc\" \"Mat.c\";\n",
        image("\tsetAttr \".re\" -type \"double2\" 2 3;\n\tsetAttr \".of\" -type \"double2\" 0.5 0;\n\tsetAttr \".ro\" 30;\n\tsetAttr \".mu\" yes;\n"),
        shaded("Plaque", "Mat"),
    );
    let (manifest, _) = compile_ma("ma-placage", &body).prepared("ma");
    assert_eq!(
        manifest["unsupported"]["ma-texture-transform-unsupported"], 1,
        "{}",
        manifest["unsupported"]
    );
    assert_eq!(manifest["unsupported"]["ma-texture-mirror-unsupported"], 1);
}
