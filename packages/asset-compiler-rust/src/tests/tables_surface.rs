//! Correctness of `scene-tables.json`, the material and texture tables: every field the engine
//! reads of a surface, and the sampler state behind it (#287).
//!
//! Provenance of every case: the glTF the compilation itself publishes as `source.gltf`, built
//! here from the repository's own triangle fixture (`tests/base.rs`) — no asset is read from
//! outside this crate. Each case names the glTF field it comes from, so what the table claims can
//! be traced back to the specification it is read from.
use super::*;

use super::tables_scene::published;

#[test]
fn the_material_table_carries_every_field_the_engine_reads() {
    let (_root, tables) = published(|gltf| {
        gltf["samplers"] = json!([{"wrapS":33071,"wrapT":33648,"magFilter":9728,"minFilter":9985}]);
        gltf["images"] = json!([{"uri":"albedo.png"}]);
        gltf["textures"] = json!([{"source":0,"sampler":0}]);
        gltf["materials"] = json!([{
            "name":"surface",
            "pbrMetallicRoughness":{
                "baseColorFactor":[0.25,0.5,0.75,1.0],
                "metallicFactor":0.125,
                "roughnessFactor":0.375,
                "baseColorTexture":{"index":0,"texCoord":1},
                "metallicRoughnessTexture":{"index":0},
            },
            "normalTexture":{"index":0,"scale":0.5},
            "occlusionTexture":{"index":0,"strength":0.25},
            "emissiveTexture":{"index":0},
            "emissiveFactor":[0.1,0.2,0.3],
            "doubleSided":true,
            "alphaMode":"MASK",
            "alphaCutoff":0.4,
            "extensions":{
                "KHR_materials_emissive_strength":{"emissiveStrength":2.0},
                "KHR_materials_transmission":{"transmissionFactor":0.6},
                "KHR_materials_ior":{"ior":1.7},
                "KHR_materials_volume":{"thicknessFactor":0.8,"attenuationDistance":3.0,
                    "attenuationColor":[0.9,0.8,0.7]},
            },
        }]);
        gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    });
    let m = &tables["materials"][0];
    assert_eq!(m["lit"], json!(true));
    assert_eq!(
        m["baseColor"],
        json!([0.25, 0.5, 0.75]),
        "alpha is not a colour"
    );
    assert_eq!(
        (m["metalness"].clone(), m["roughness"].clone()),
        (json!(0.125), json!(0.375))
    );
    assert_eq!(m["doubleSided"], json!(true));
    assert_eq!(m["backSide"], json!(false));
    assert_eq!(
        m["alphaTest"],
        json!(0.4),
        "the cutoff of a masked material"
    );
    assert_eq!(
        m["map"],
        json!({"texture":0,"texCoord":1,"transform":[1.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,1.0]})
    );
    assert_eq!(m["metalnessMap"]["texture"], json!(0));
    assert_eq!(
        m["roughnessMap"]["texture"],
        json!(0),
        "one glTF texture feeds both"
    );
    // No tangent on the primitive: the host rebuilds the frame from derivatives and flips the
    // second factor, and the table says the surface the host will hold.
    assert_eq!(
        (m["normalScale"].clone(), m["normalScaleY"].clone()),
        (json!(0.5), json!(-0.5))
    );
    assert_eq!(
        m["derivativeTangents"],
        json!(true),
        "the variant the entry is written for"
    );
    assert_eq!(m["aoIntensity"], json!(0.25));
    assert_eq!(
        m["emissive"],
        json!([0.2, 0.4, 0.6]),
        "factor times strength"
    );
    assert_eq!(m["transmission"], json!(0.6));
    assert_eq!(m["ior"], json!(1.7));
    assert_eq!(m["thickness"], json!(0.8));
    assert_eq!(m["attenuationDistance"], json!(3.0));
    assert_eq!(m["attenuationColor"], json!([0.9, 0.8, 0.7]));
    // Sampler state travels with the texture, at the texture's own rank.
    assert_eq!(
        tables["textures"][0],
        json!({"image":0,"wrapS":"clamp","wrapT":"mirror","magFilter":"nearest",
            "minFilter":"linear-mip-nearest"})
    );
    assert_eq!(tables["nodes"][0]["material"], json!(0));
    assert_eq!(
        tables["materials"].as_array().expect("materials").len(),
        1,
        "one surface worn"
    );
}

#[test]
fn an_unlit_material_answers_no_light() {
    let (_root, tables) = published(|gltf| {
        gltf["textures"] = json!([{"source":0}]);
        gltf["images"] = json!([{"uri":"albedo.png"}]);
        gltf["materials"] = json!([{
            "pbrMetallicRoughness":{"metallicFactor":1.0,"baseColorTexture":{"index":0}},
            "normalTexture":{"index":0},
            "emissiveFactor":[1.0,1.0,1.0],
            "extensions":{"KHR_materials_unlit":{}},
        }]);
        gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    });
    let m = &tables["materials"][0];
    assert_eq!(m["lit"], json!(false));
    assert_eq!(
        m["metalness"],
        json!(0.0),
        "the engine reads none on an unlit surface"
    );
    assert_eq!(m["roughness"], json!(1.0));
    assert_eq!(m["map"]["texture"], json!(0), "the colour map stays");
    assert_eq!(m["normalMap"], Value::Null);
    assert_eq!(m["emissive"], json!([0.0, 0.0, 0.0]));
    // A texture without a sampler takes the specification's defaults.
    assert_eq!(tables["textures"][0]["wrapS"], json!("repeat"));
    assert_eq!(
        tables["textures"][0]["minFilter"],
        json!("linear-mip-linear")
    );
}

#[test]
fn a_texture_transform_is_composed_as_the_loader_composes_it() {
    let (_root, tables) = published(|gltf| {
        gltf["textures"] = json!([{"source":0}]);
        gltf["images"] = json!([{"uri":"albedo.png"}]);
        gltf["materials"] = json!([{"pbrMetallicRoughness":{"baseColorTexture":{"index":0,
            "extensions":{"KHR_texture_transform":{"offset":[0.25,0.5],"scale":[2.0,4.0],
                "texCoord":1}}}}}]);
        gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    });
    assert_eq!(
        tables["materials"][0]["map"],
        json!({"texture":0,"texCoord":1,
            "transform":[2.0,0.0,0.0,0.0,4.0,0.0,0.25,0.5,1.0]}),
        "scale on the diagonal, offset in the last column, as the host holds it"
    );
}
