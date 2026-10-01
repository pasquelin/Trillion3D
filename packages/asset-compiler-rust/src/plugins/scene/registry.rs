use super::*;

/// The registry: one driver per format. Adding a format means a module and a line here.
pub static PLUGINS: &[&dyn ScenePlugin] = &[
    &gltf::GLTF,
    &fbx::FBX,
    &obj::OBJ,
    &unity::UNITY,
    &blend::BLEND,
    &zip::ZIP,
    &unitypackage::UNITYPACKAGE,
    &alembic::ALEMBIC,
    &usd::USD,
    &usdz::USDZ,
    &ma::MA,
    &ply::PLY,
    &stl::STL,
    &amf::AMF,
    &vox::VOX,
    &collada::COLLADA,
    &threemf::THREEMF,
    &threeds::THREEDS,
    &ldraw::LDRAW,
    &gcode::GCODE,
    &kmz::KMZ,
    &vrml::VRML,
    &ifc::IFC,
    &rhino::RHINO,
];
