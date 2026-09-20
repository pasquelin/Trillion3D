//! What a prim holds from its ancestors: the material `material:binding` binds
//! higher up, and the `doubleSided` geometry declares without any material bound.
//!
//! Textures have their own file, `usd_textures.rs`; invalid faces `usd_faces.rs`.
use super::*;
use usd_driver::{compile_layer, wrap};

/// Two named materials, enough to tell which one wins.
pub(super) const PAIR: &str = r#"
    def Material "M"
    {
        token outputs:surface.connect = </Root/M/S.outputs:surface>

        def Shader "S"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor = (1, 0, 0)
            token outputs:surface
        }
    }

    def Material "N"
    {
        token outputs:surface.connect = </Root/N/S.outputs:surface>

        def Shader "S"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor = (0, 1, 0)
            token outputs:surface
        }
    }
"#;

/// Material name of each primitive of the mesh of this rank, or `null` when it cites none.
pub(super) fn bound(gltf: &Value, mesh: usize) -> Vec<Value> {
    gltf["meshes"][mesh]["primitives"]
        .as_array()
        .expect("primitives")
        .iter()
        .map(|primitive| match primitive["material"].as_u64() {
            Some(rank) => gltf["materials"][rank as usize]["name"].clone(),
            None => Value::Null,
        })
        .collect()
}

/// A named two-face square mesh, which carries `extra` among its attributes.
pub(super) fn quad(name: &str, extra: &str) -> String {
    format!(
        r#"
    def Mesh "{name}"
    {{
        int[] faceVertexCounts = [4, 4]
        int[] faceVertexIndices = [0, 1, 2, 3, 3, 2, 4, 5]
        point3f[] points = [(0,0,0), (1,0,0), (1,1,0), (0,1,0), (1,2,0), (0,2,0)]
        uniform token subdivisionScheme = "none"
{extra}    }}
"#
    )
}

// Behaviour 50: `material:binding` resolves by walking up ancestors — the closest
// binding wins, a `GeomSubset` without a binding takes that of its mesh, and a
// binding declared `strongerThanDescendants` wins over those of its descendants.
#[test]
fn a_material_bound_on_an_ancestor_reaches_the_prims_that_do_not_bind_one() {
    let body = format!(
        "    rel material:binding = </Root/M>\n{}{PAIR}",
        quad("Quad", "")
    );
    let (_, gltf) = compile_layer("heritage", &wrap("", &body)).prepared("usd");
    assert_eq!(
        bound(&gltf, 0),
        ["M"],
        "the ancestor's binding reaches the mesh"
    );

    let subset = r#"
        def GeomSubset "Haut"
        {
            uniform token elementType = "face"
            uniform token familyName = "materialBind"
            int[] indices = [1]
        }
"#;
    let body = format!(
        "    rel material:binding = </Root/M>\n{}{PAIR}",
        quad("Quad", subset)
    );
    let (_, gltf) = compile_layer("heritage-subset", &wrap("", &body)).prepared("usd");
    assert_eq!(
        bound(&gltf, 0),
        ["M", "M"],
        "the subset without a binding takes that of its mesh"
    );

    let strong = "    rel material:binding = </Root/M> (\n        bindMaterialAs = \"strongerThanDescendants\"\n    )\n";
    let body = format!(
        "{strong}{}{PAIR}",
        quad("Quad", "        rel material:binding = </Root/N>\n")
    );
    let (_, gltf) = compile_layer("heritage-fort", &wrap("", &body)).prepared("usd");
    assert_eq!(
        bound(&gltf, 0),
        ["M"],
        "the binding stronger than its descendants wins"
    );
}

// Behaviour 51: `doubleSided` is a geometry property in USD and a material one
// in glTF. A double-sided mesh without a bound material receives one, shared by
// all in its case; a bound mesh gets a double-sided variant of its material,
// never a mutation of the one other meshes cite.
#[test]
fn a_double_sided_mesh_without_a_binding_still_carries_its_two_faces() {
    let body = quad("Quad", "        uniform bool doubleSided = 1\n");
    let (_, gltf) = compile_layer("double-seul", &wrap("", &body)).prepared("usd");
    let materials = gltf["materials"].as_array().expect("materials").clone();
    assert_eq!(materials.len(), 1, "only one default material");
    assert_eq!(
        materials[0]["doubleSided"],
        json!(true),
        "the mesh's double-sidedness reaches the material"
    );
    assert_eq!(bound(&gltf, 0), [materials[0]["name"].clone()]);

    let body = format!(
        "    rel material:binding = </Root/M>\n{}{}{PAIR}",
        quad("Simple", ""),
        quad("Face", "        uniform bool doubleSided = 1\n")
    );
    let (_, gltf) = compile_layer("double-variante", &wrap("", &body)).prepared("usd");
    let sides: Vec<Value> = gltf["materials"]
        .as_array()
        .expect("materials")
        .iter()
        .map(|material| material["doubleSided"].clone())
        .collect();
    assert_eq!(
        sides,
        [Value::Null, json!(true)],
        "the shared material stays single-sided, its variant carries both"
    );
    assert_eq!(
        bound(&gltf, 0),
        ["M"],
        "the single-sided mesh keeps its own"
    );
}
