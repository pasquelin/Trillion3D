//! Correctness of `scene-tables.json` beyond the fields the engine record reads: the lights the
//! nodes hang, a blended surface, and the physical extensions a surface declares, written under
//! the host's own parameter names so that nothing a surface declares is lost on the way (#272).
//!
//! Provenance of every case: the glTF the compilation itself publishes as `source.gltf`, built
//! here from the repository's own triangle fixture (`tests/base.rs`); each case names the glTF
//! field it comes from.
use super::*;

use super::scene_tables::published;

#[test]
fn the_lights_are_carried_as_the_document_declares_them() {
    let (_root, tables) = published(|gltf| {
        gltf["extensionsUsed"] = json!(["KHR_lights_punctual"]);
        gltf["extensions"] = json!({"KHR_lights_punctual":{"lights":[
            {"name":"lamp","type":"spot","color":[1.0,0.5,0.25],"intensity":3.0,"range":9.0,
                "spot":{"innerConeAngle":0.1,"outerConeAngle":0.5}},
            {"type":"directional"},
        ]}});
        gltf["nodes"] = json!([
            {"mesh":0,"children":[1,2]},
            {"extensions":{"KHR_lights_punctual":{"light":0}}},
            {"extensions":{"KHR_lights_punctual":{"light":1}}},
        ]);
    });
    assert_eq!(tables["nodes"][1]["light"], json!(0));
    assert_eq!(tables["nodes"][2]["light"], json!(1));
    assert_eq!(
        tables["lights"][0],
        json!({"name":"lamp","type":"spot","color":[1.0,0.5,0.25],"intensity":3.0,"range":9.0,
            "innerConeAngle":0.1,"outerConeAngle":0.5})
    );
    // Silent fields stay silent: the reader applies the specification's defaults, as the host does.
    assert_eq!(
        tables["lights"][1],
        json!({"name":"","type":"directional","color":null,"intensity":null,"range":null,
            "innerConeAngle":null,"outerConeAngle":null})
    );
}

#[test]
fn a_blended_surface_and_its_physical_extensions_are_carried() {
    let (_root, tables) = published(|gltf| {
        gltf["textures"] = json!([{"source":0,"name":"coat"}]);
        gltf["images"] = json!([{"uri":"coat.png"}]);
        gltf["materials"] = json!([{
            "pbrMetallicRoughness":{"baseColorFactor":[1.0,1.0,1.0,0.25]},
            "alphaMode":"BLEND",
            "extensions":{
                "KHR_materials_clearcoat":{"clearcoatFactor":0.5,"clearcoatTexture":{"index":0},
                    "clearcoatNormalTexture":{"index":0,"scale":2.0}},
                "KHR_materials_sheen":{"sheenColorFactor":[0.1,0.2,0.3]},
                "KHR_materials_specular":{"specularFactor":0.75},
            },
        }]);
        gltf["meshes"][0]["primitives"][0]["material"] = json!(0);
    });
    let m = &tables["materials"][0];
    assert_eq!(
        (
            m["kind"].clone(),
            m["alphaMode"].clone(),
            m["opacity"].clone()
        ),
        (json!("physical"), json!("BLEND"), json!(0.25))
    );
    assert_eq!(tables["textures"][0]["name"], json!("coat"));
    let slot = json!({"texture":0,"texCoord":0,"transform":null});
    assert_eq!(
        m["extensions"],
        json!({
            "clearcoat":0.5,"clearcoatMap":slot,"clearcoatNormalMap":slot,"clearcoatNormalScale":2.0,
            "sheen":1.0,"sheenColor":[0.1,0.2,0.3],"sheenRoughness":0.0,
            "specularIntensity":0.75,"specularColor":[1.0,1.0,1.0],
        }),
        "the host's names and defaults, and nothing the material does not declare"
    );
}
