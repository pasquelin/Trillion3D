//! FBX / OBJ import. A ufbx scene becomes a plain glTF 2.0 pair (`model.gltf` + `model.bin`) plus a
//! source manifest inside the cache, so `compile` consumes it exactly like a hand-made glTF source.
//! Textures are referenced relative to the source directory (served under `resourceBaseUrl`) or
//! embedded as buffer views when the file carries their bytes. Nothing is written next to the source.
use std::{collections::{BTreeMap,HashMap},fs,path::{Path,PathBuf},sync::atomic::{AtomicBool,Ordering}};
use serde_json::{Value,json};
use crate::{CompilerError,Result,hash,atomic,runtime_manifest};

/// Bumping this invalidates cached imports (they are keyed by source hashes + importer version).
pub const IMPORTER_VERSION:&str="ufbx-0.11.3-gltf-1";
const PROGRESS_INTERVAL_BYTES:u64=8*1024*1024;
const IMAGE_EXTENSIONS:[(&str,&str);3]=[("png","image/png"),("jpg","image/jpeg"),("jpeg","image/jpeg")];

pub fn is_import_source(name:&str)->bool{let lower=name.to_ascii_lowercase();lower.ends_with(".fbx")||lower.ends_with(".obj")}
fn import_error(error:&ufbx::Error)->CompilerError{
 if error.type_==ufbx::ErrorType::Cancelled{return CompilerError::new("CANCELLED","Import cancelled");}
 let code=match error.type_{ufbx::ErrorType::UnsupportedVersion=>"IMPORT_UNSUPPORTED_VERSION",ufbx::ErrorType::OutOfMemory|ufbx::ErrorType::MemoryLimit=>"IMPORT_OUT_OF_MEMORY",ufbx::ErrorType::Io|ufbx::ErrorType::FileNotFound=>"IMPORT_IO_ERROR",_=>"IMPORT_ERROR"};
 CompilerError::new(code,format!("{} {}",&*error.description,error.info()).trim().to_string())
}


/// Multiplicative hash for the (position, normal, uv, colour) corner keys: SipHash dominated mesh conversion.
#[derive(Default,Clone,Copy)] struct CornerHasher(u64);
impl std::hash::Hasher for CornerHasher{fn finish(&self)->u64{self.0}fn write(&mut self,bytes:&[u8]){for b in bytes{self.0=(self.0.rotate_left(5)^(*b as u64)).wrapping_mul(0x517cc1b727220a95);}}fn write_u32(&mut self,v:u32){self.0=(self.0.rotate_left(5)^(v as u64)).wrapping_mul(0x517cc1b727220a95);}}
type CornerMap=HashMap<(u32,u32,u32,u32),u32,std::hash::BuildHasherDefault<CornerHasher>>;
struct Bin{bytes:Vec<u8>,views:Vec<Value>}
impl Bin{
 fn view(&mut self,data:&[u8],target:Option<u32>)->usize{let pad=(4-self.bytes.len()%4)%4;self.bytes.extend(std::iter::repeat(0u8).take(pad));let offset=self.bytes.len();self.bytes.extend_from_slice(data);let mut view=json!({"buffer":0,"byteOffset":offset,"byteLength":data.len()});if let Some(t)=target{view["target"]=json!(t);}self.views.push(view);self.views.len()-1}
}
fn f32_bytes(values:&[f32])->Vec<u8>{let mut out=Vec::with_capacity(values.len()*4);for v in values{out.extend_from_slice(&v.to_le_bytes());}out}

#[derive(Default)]
struct Report{unsupported:BTreeMap<String,usize>,notes:Vec<String>}
impl Report{fn add(&mut self,kind:&str){self.add_count(kind,1);}fn add_count(&mut self,kind:&str,count:usize){if count>0{*self.unsupported.entry(kind.to_string()).or_insert(0)+=count;}}}

/// Absolute, lexically normalised path (no `.`/`..`), symlinks untouched so linked source folders keep working.
fn normalise(path:&Path)->PathBuf{
 let absolute=if path.is_absolute(){path.to_path_buf()}else{std::env::current_dir().map(|c|c.join(path)).unwrap_or_else(|_|path.to_path_buf())};
 let mut out=PathBuf::new();
 for component in absolute.components(){match component{std::path::Component::CurDir=>{},std::path::Component::ParentDir=>{out.pop();},other=>out.push(other.as_os_str())}}
 out
}
/// Per-file view over the shared image/sampler/texture tables; indices it hands out are final.
struct TextureTable<'a>{source_dir:&'a Path,canonical_dir:PathBuf,bin:&'a mut Bin,images:&'a mut Vec<Value>,samplers:&'a mut Vec<Value>,textures:&'a mut Vec<Value>,sampler_ids:&'a mut HashMap<(u32,u32),usize>,report:&'a mut Report,by_element:HashMap<u32,Option<usize>>}
impl<'a> TextureTable<'a>{
 fn wrap(mode:ufbx::WrapMode)->u32{match mode{ufbx::WrapMode::Clamp=>33071,_=>10497}}
 fn sampler(&mut self,texture:&ufbx::Texture)->usize{let key=(Self::wrap(texture.wrap_u),Self::wrap(texture.wrap_v));if let Some(id)=self.sampler_ids.get(&key){return *id;}self.samplers.push(json!({"magFilter":9729,"minFilter":9987,"wrapS":key.0,"wrapT":key.1}));let id=self.samplers.len()-1;self.sampler_ids.insert(key,id);id}
 fn mime(path:&Path)->Option<&'static str>{let ext=path.extension()?.to_str()?.to_ascii_lowercase();IMAGE_EXTENSIONS.iter().find(|(e,_)|*e==ext).map(|(_,mime)|*mime)}
 /// Finds a decodable image for a texture: embedded bytes first, then the declared paths inside the
 /// source directory, then a sibling PNG/JPEG next to a GPU-only format (DDS, TGA...).
 fn resolve(&mut self,texture:&ufbx::Texture)->Option<Value>{
  let name=Path::new(&*texture.filename).file_name().and_then(|s|s.to_str()).filter(|s|!s.is_empty()).or_else(||Path::new(&*texture.relative_filename).file_name().and_then(|s|s.to_str())).unwrap_or("texture").to_string();
  if !texture.content.is_empty(){
   let Some(mime)=Self::mime(Path::new(&name)) else {self.report.add("texture-embedded-format");return None};
   let view=self.bin.view(&texture.content,None);
   return Some(json!({"name":name,"mimeType":mime,"bufferView":view}));
  }
  let mut candidates:Vec<PathBuf>=Vec::new();
  for declared in [&*texture.absolute_filename,&*texture.relative_filename,&*texture.filename]{if declared.is_empty(){continue;}let path=Path::new(declared);candidates.push(if path.is_absolute(){path.to_path_buf()}else{self.source_dir.join(path)});}
  candidates.push(self.source_dir.join(&name));candidates.push(self.source_dir.join("textures").join(&name));
  let mut siblings=Vec::new();
  for candidate in &candidates{for (ext,_) in IMAGE_EXTENSIONS{siblings.push(candidate.with_extension(ext));}}
  let mut outside=false;
  for candidate in candidates.iter().chain(siblings.iter()){
   if !candidate.is_file(){continue;}
   let Some(mime)=Self::mime(candidate) else {continue};
   let Ok(relative)=normalise(candidate).strip_prefix(&self.canonical_dir).map(Path::to_path_buf) else {outside=true;continue};
   let uri=relative.components().map(|c|c.as_os_str().to_string_lossy().to_string()).collect::<Vec<_>>().join("/");
   return Some(json!({"name":name,"mimeType":mime,"uri":uri}));
  }
  self.report.add(if outside{"texture-outside-source"}else if Self::mime(Path::new(&name)).is_some(){"texture-missing"}else{"texture-format"});
  None
 }
 fn texture(&mut self,texture:&ufbx::Texture)->Option<usize>{
  let id=texture.element.element_id;
  if let Some(known)=self.by_element.get(&id){return *known;}
  let file:Option<&ufbx::Texture>=if texture.type_==ufbx::TextureType::File{Some(texture)}else{texture.file_textures.iter().next().map(|t|&**t)};
  let result=match file{
   Some(file)=>match self.resolve(file){Some(image)=>{if texture.has_uv_transform{self.report.add("texture-uv-transform");}self.images.push(image);let sampler=self.sampler(file);self.textures.push(json!({"source":self.images.len()-1,"sampler":sampler}));Some(self.textures.len()-1)},None=>None},
   None=>{self.report.add("texture-procedural");None}
  };
  self.by_element.insert(id,result);
  result
 }
}

fn map_value(map:&ufbx::MaterialMap,default:f64)->f64{if map.has_value{map.value_vec4.x}else{default}}
fn map_texture(map:&ufbx::MaterialMap,textures:&mut TextureTable)->Option<usize>{map.texture.as_ref().filter(|_|map.texture_enabled).and_then(|t|textures.texture(t))}
fn texture_id(map:&ufbx::MaterialMap)->Option<u32>{map.texture.as_ref().map(|t|t.element.element_id)}
fn material_json(material:&ufbx::Material,textures:&mut TextureTable)->Value{
 let pbr=&material.pbr;
 let base_factor=map_value(&pbr.base_factor,1.0);
 let base=if pbr.base_color.has_value{pbr.base_color.value_vec4}else{ufbx::Vec4{x:1.0,y:1.0,z:1.0,w:1.0}};
 let alpha=map_value(&pbr.opacity,1.0).clamp(0.0,1.0);
 let metallic=map_value(&pbr.metalness,0.0).clamp(0.0,1.0);
 let roughness=if pbr.roughness.has_value{let r=pbr.roughness.value_vec4.x;if material.features.roughness_as_glossiness.enabled{1.0-r}else{r}}else{0.6}.clamp(0.0,1.0);
 let emission_factor=map_value(&pbr.emission_factor,1.0);
 let emissive=if pbr.emission_color.has_value{let c=pbr.emission_color.value_vec4;[c.x*emission_factor,c.y*emission_factor,c.z*emission_factor]}else{[0.0,0.0,0.0]};
 let mut pbr_json=json!({"baseColorFactor":[(base.x*base_factor).clamp(0.0,1.0),(base.y*base_factor).clamp(0.0,1.0),(base.z*base_factor).clamp(0.0,1.0),alpha],"metallicFactor":metallic,"roughnessFactor":roughness});
 // A bound texture replaces the colour property in FBX; glTF multiplies, so the factor becomes white.
 if let Some(t)=map_texture(&pbr.base_color,textures){pbr_json["baseColorTexture"]=json!({"index":t});pbr_json["baseColorFactor"]=json!([1.0,1.0,1.0,alpha]);}
 let (rough_texture,metal_texture)=(texture_id(&pbr.roughness),texture_id(&pbr.metalness));
 if rough_texture.is_some()&&rough_texture==metal_texture{if let Some(t)=map_texture(&pbr.roughness,textures){pbr_json["metallicRoughnessTexture"]=json!({"index":t});}}
 else if rough_texture.is_some()||metal_texture.is_some(){textures.report.add("material-split-metal-roughness");}
 let mut out=json!({"name":&*material.element.name,"pbrMetallicRoughness":pbr_json,"emissiveFactor":[emissive[0].clamp(0.0,1.0),emissive[1].clamp(0.0,1.0),emissive[2].clamp(0.0,1.0)]});
 if let Some(t)=map_texture(&pbr.normal_map,textures){out["normalTexture"]=json!({"index":t});}
 if let Some(t)=map_texture(&pbr.emission_color,textures){out["emissiveTexture"]=json!({"index":t});out["emissiveFactor"]=json!([1.0,1.0,1.0]);}
 if let Some(t)=map_texture(&pbr.ambient_occlusion,textures){out["occlusionTexture"]=json!({"index":t});}
 if material.features.double_sided.enabled{out["doubleSided"]=json!(true);}
 if alpha<1.0{out["alphaMode"]=json!("BLEND");}
 else if pbr.opacity.texture.is_some(){out["alphaMode"]=json!("MASK");out["alphaCutoff"]=json!(0.5);if texture_id(&pbr.opacity)!=texture_id(&pbr.base_color){textures.report.add("material-separate-opacity-texture");}}
 out
}

struct MeshOut{mesh:Value,triangles:usize}
/// One glTF mesh per (ufbx mesh, resolved material list): instances sharing both share the mesh.
fn mesh_json(mesh:&ufbx::Mesh,materials:&[Option<usize>],bin:&mut Bin,accessors:&mut Vec<Value>,report:&mut Report)->Option<MeshOut>{
 let mut primitives=Vec::new();let mut triangles=0usize;let mut scratch:Vec<u32>=Vec::new();
 let whole:Vec<u32>;
 let parts:Vec<(usize,&[u32])>=if mesh.material_parts.is_empty(){whole=(0..mesh.num_faces as u32).collect();vec![(0,&whole[..])]}else{mesh.material_parts.iter().map(|p|(p.index as usize,p.face_indices.as_ref())).collect()};
 let has_normal=mesh.vertex_normal.exists;let has_uv=mesh.vertex_uv.exists;let has_color=mesh.vertex_color.exists;
 report.add_count("mesh-skinning",usize::from(!mesh.skin_deformers.is_empty()));
 report.add_count("mesh-blend-shapes",usize::from(!mesh.blend_deformers.is_empty()));
 for (material_slot,faces) in parts{
  let mut positions:Vec<f32>=Vec::new();let mut normals:Vec<f32>=Vec::new();let mut uvs:Vec<f32>=Vec::new();let mut colors:Vec<f32>=Vec::new();let mut indices:Vec<u32>=Vec::new();
  let mut unique:CornerMap=CornerMap::default();
  let mut min=[f32::MAX;3];let mut max=[f32::MIN;3];
  for &face_index in faces{
   let face=mesh.faces[face_index as usize];
   if face.num_indices<3{continue;}
   let count=ufbx::triangulate_face_vec(&mut scratch,mesh,face) as usize*3;
   for &corner in &scratch[..count]{
    let c=corner as usize;
    let key=(mesh.vertex_position.indices[c],if has_normal{mesh.vertex_normal.indices[c]}else{0},if has_uv{mesh.vertex_uv.indices[c]}else{0},if has_color{mesh.vertex_color.indices[c]}else{0});
    let next=unique.len() as u32;
    let id=*unique.entry(key).or_insert_with(||{
     let p=mesh.vertex_position.values[key.0 as usize];let v=[p.x as f32,p.y as f32,p.z as f32];for a in 0..3{min[a]=min[a].min(v[a]);max[a]=max[a].max(v[a]);}positions.extend_from_slice(&v);
     if has_normal{let n=mesh.vertex_normal.values[key.1 as usize];let len=(n.x*n.x+n.y*n.y+n.z*n.z).sqrt();let (x,y,z)=if len>1e-12{(n.x/len,n.y/len,n.z/len)}else{(0.0,1.0,0.0)};normals.extend_from_slice(&[x as f32,y as f32,z as f32]);}
     if has_uv{let t=mesh.vertex_uv.values[key.2 as usize];uvs.extend_from_slice(&[t.x as f32,(1.0-t.y) as f32]);}
     if has_color{let c=mesh.vertex_color.values[key.3 as usize];colors.extend_from_slice(&[c.x as f32,c.y as f32,c.z as f32,c.w as f32]);}
     next});
    indices.push(id);
   }
  }
  if indices.is_empty(){continue;}
  let vertex_count=unique.len();
  let mut attributes=json!({});
  let view=bin.view(&f32_bytes(&positions),Some(34962));accessors.push(json!({"bufferView":view,"componentType":5126,"count":vertex_count,"type":"VEC3","min":min,"max":max}));attributes["POSITION"]=json!(accessors.len()-1);
  if has_normal{let view=bin.view(&f32_bytes(&normals),Some(34962));accessors.push(json!({"bufferView":view,"componentType":5126,"count":vertex_count,"type":"VEC3"}));attributes["NORMAL"]=json!(accessors.len()-1);}
  if has_uv{let view=bin.view(&f32_bytes(&uvs),Some(34962));accessors.push(json!({"bufferView":view,"componentType":5126,"count":vertex_count,"type":"VEC2"}));attributes["TEXCOORD_0"]=json!(accessors.len()-1);}
  if has_color{let view=bin.view(&f32_bytes(&colors),Some(34962));accessors.push(json!({"bufferView":view,"componentType":5126,"count":vertex_count,"type":"VEC4"}));attributes["COLOR_0"]=json!(accessors.len()-1);}
  let (index_bytes,component)=if vertex_count<=u16::MAX as usize{(indices.iter().flat_map(|i|(*i as u16).to_le_bytes()).collect::<Vec<u8>>(),5123)}else{(indices.iter().flat_map(|i|i.to_le_bytes()).collect::<Vec<u8>>(),5125)};
  let view=bin.view(&index_bytes,Some(34963));accessors.push(json!({"bufferView":view,"componentType":component,"count":indices.len(),"type":"SCALAR"}));
  let mut primitive=json!({"attributes":attributes,"indices":accessors.len()-1,"mode":4});
  if let Some(Some(material))=materials.get(material_slot){primitive["material"]=json!(material);}
  triangles+=indices.len()/3;
  primitives.push(primitive);
 }
 if primitives.is_empty(){return None;}
 Some(MeshOut{mesh:json!({"name":&*mesh.element.name,"primitives":primitives}),triangles})
}

fn matrix_json(m:&ufbx::Matrix)->Vec<f64>{vec![m.m00,m.m10,m.m20,0.0,m.m01,m.m11,m.m21,0.0,m.m02,m.m12,m.m22,0.0,m.m03,m.m13,m.m23,1.0]}
fn matrix_is_finite(m:&[f64])->bool{m.iter().all(|v|v.is_finite())}
/// Rotates the glTF light axis (-Z) onto the FBX light direction, then applies the node transform.
fn light_matrix(node:&ufbx::Node,direction:ufbx::Vec3)->Vec<f64>{
 let len=(direction.x*direction.x+direction.y*direction.y+direction.z*direction.z).sqrt();
 let d=if len>1e-12{[direction.x/len,direction.y/len,direction.z/len]}else{[0.0,0.0,-1.0]};
 let z=[-d[0],-d[1],-d[2]];let up=if z[1].abs()>0.99{[1.0,0.0,0.0]}else{[0.0,1.0,0.0]};
 let x=[up[1]*z[2]-up[2]*z[1],up[2]*z[0]-up[0]*z[2],up[0]*z[1]-up[1]*z[0]];let xl=(x[0]*x[0]+x[1]*x[1]+x[2]*x[2]).sqrt();let x=[x[0]/xl,x[1]/xl,x[2]/xl];
 let y=[z[1]*x[2]-z[2]*x[1],z[2]*x[0]-z[0]*x[2],z[0]*x[1]-z[1]*x[0]];
 let n=&node.node_to_world;
 let mul=|c:[f64;3]|[n.m00*c[0]+n.m01*c[1]+n.m02*c[2],n.m10*c[0]+n.m11*c[1]+n.m12*c[2],n.m20*c[0]+n.m21*c[1]+n.m22*c[2]];
 let (cx,cy,cz)=(mul(x),mul(y),mul(z));
 vec![cx[0],cx[1],cx[2],0.0,cy[0],cy[1],cy[2],0.0,cz[0],cz[1],cz[2],0.0,n.m03,n.m13,n.m23,1.0]
}

struct Importer<'a>{nodes:Vec<Value>,meshes:Vec<Value>,mesh_triangles:Vec<usize>,materials:Vec<Value>,accessors:Vec<Value>,images:Vec<Value>,samplers:Vec<Value>,textures:Vec<Value>,sampler_ids:HashMap<(u32,u32),usize>,lights:Vec<Value>,bin:Bin,report:Report,triangles:usize,mesh_nodes:usize,files:Vec<Value>,cancelled:&'a AtomicBool,progress:&'a (dyn Fn(Value)+Sync)}
impl<'a> Importer<'a>{
 fn check(&self)->Result<()>{if self.cancelled.load(Ordering::Relaxed){return Err(CompilerError::new("CANCELLED","Import cancelled"));}Ok(())}
 fn load(&mut self,file:&Path,mapped:&[u8],digest:&str,index:usize,total:usize)->Result<()>{
  let started=std::time::Instant::now();
  let file_name=file.file_name().and_then(|s|s.to_str()).unwrap_or("source").to_string();
  let source_dir=file.parent().filter(|p|!p.as_os_str().is_empty()).map(Path::to_path_buf).unwrap_or_else(||PathBuf::from("."));
  let canonical_dir=normalise(&source_dir);
  let progress=self.progress;let cancelled=self.cancelled;let label=file_name.clone();
  let callback=move|p:&ufbx::Progress|->ufbx::ProgressResult{if cancelled.load(Ordering::Relaxed){return ufbx::ProgressResult::Cancel;}progress(json!({"phase":"import-source","step":"parse","file":label,"index":index,"files":total,"completed":p.bytes_read,"total":p.bytes_total}));ufbx::ProgressResult::Continue};
  let opts=ufbx::LoadOpts{filename:ufbx::StringOpt::Ref(file.to_str().unwrap_or("")),
   ignore_animation:true,load_external_files:true,ignore_missing_external_files:true,generate_missing_normals:true,normalize_normals:true,
   target_axes:ufbx::CoordinateAxes::right_handed_y_up(),target_unit_meters:1.0,space_conversion:ufbx::SpaceConversion::TransformRoot,
   geometry_transform_handling:ufbx::GeometryTransformHandling::Preserve,inherit_mode_handling:ufbx::InheritModeHandling::Preserve,pivot_handling:ufbx::PivotHandling::Retain,
   index_error_handling:ufbx::IndexErrorHandling::Clamp,progress_cb:ufbx::ProgressCb::Ref(&callback),progress_interval_hint:PROGRESS_INTERVAL_BYTES,
   obj_search_mtl_by_filename:true,obj_unit_meters:1.0,obj_axes:ufbx::CoordinateAxes::right_handed_y_up(),
   ..Default::default()};
  let scene=ufbx::load_memory(mapped,opts).map_err(|e|import_error(&e))?;
  let parse_ms=started.elapsed().as_secs_f64()*1000.0;
  for warning in &scene.metadata.warnings{self.report.notes.push(format!("{file_name}: {} (x{})",&*warning.description,warning.count));}
  // Element ids restart in every file: material and mesh lookups are per file, table indices are global.
  let mut local_materials:HashMap<u32,usize>=HashMap::new();
  {
   let mut textures=TextureTable{source_dir:&source_dir,canonical_dir,bin:&mut self.bin,images:&mut self.images,samplers:&mut self.samplers,textures:&mut self.textures,sampler_ids:&mut self.sampler_ids,report:&mut self.report,by_element:HashMap::new()};
   for material in &scene.materials{self.materials.push(material_json(material,&mut textures));local_materials.insert(material.element.element_id,self.materials.len()-1);}
  }
  let mut mesh_ids:HashMap<(u32,Vec<Option<usize>>),Option<usize>>=HashMap::new();
  let mut file_nodes=0usize;let mut file_triangles=0usize;let mut hidden=0usize;
  let node_total=scene.nodes.len();
  for (i,node) in scene.nodes.iter().enumerate(){
   self.check()?;
   if node.is_root{continue;}
   if let Some(light)=node.light.as_ref(){self.push_light(node,light);}
   let Some(mesh)=node.mesh.as_ref() else {continue};
   if !node.visible{hidden+=1;continue;}
   let bound:Vec<Option<usize>>={let list=if node.materials.is_empty(){&mesh.materials}else{&node.materials};let mut out:Vec<Option<usize>>=list.iter().map(|m|local_materials.get(&m.element.element_id).copied()).collect();if out.is_empty(){out.push(None);}out};
   let key=(mesh.element.element_id,bound);
   let mesh_id=match mesh_ids.get(&key){Some(id)=>*id,None=>{
    let converted=mesh_json(mesh,&key.1,&mut self.bin,&mut self.accessors,&mut self.report);
    let id=converted.map(|out|{self.meshes.push(out.mesh);self.mesh_triangles.push(out.triangles);self.meshes.len()-1});
    mesh_ids.insert(key,id);
    if i%64==0||i+1==node_total{(self.progress)(json!({"phase":"import-source","step":"meshes","file":file_name,"index":index,"files":total,"completed":i+1,"total":node_total}));}
    id}};
   let Some(mesh_id)=mesh_id else {continue};
   let matrix=matrix_json(&node.geometry_to_world);
   if !matrix_is_finite(&matrix){self.report.add("node-invalid-transform");continue;}
   self.nodes.push(json!({"name":&*node.element.name,"matrix":matrix,"mesh":mesh_id}));
   file_nodes+=1;file_triangles+=self.mesh_triangles[mesh_id];
  }
  self.report.add_count("node-hidden",hidden);
  self.mesh_nodes+=file_nodes;self.triangles+=file_triangles;
  self.files.push(json!({"file":file_name,"bytes":mapped.len(),"sha256":digest,"format":if scene.metadata.file_format==ufbx::FileFormat::Obj{"obj"}else{"fbx"},"fbxVersion":scene.metadata.version,"ascii":scene.metadata.ascii,"creator":&*scene.metadata.creator,"unitMeters":scene.settings.unit_meters,"meshes":scene.meshes.len(),"materials":scene.materials.len(),"textures":scene.textures.len(),"lodGroups":scene.lod_groups.len(),"lights":scene.lights.len(),"hiddenNodes":hidden,"meshNodes":file_nodes,"triangles":file_triangles,"parseMs":parse_ms,"ms":started.elapsed().as_secs_f64()*1000.0}));
  Ok(())
 }
 fn push_light(&mut self,node:&ufbx::Node,light:&ufbx::Light){
  let kind=match light.type_{ufbx::LightType::Point=>"point",ufbx::LightType::Directional=>"directional",ufbx::LightType::Spot=>"spot",_=>{self.report.add("light-area-or-volume");return}};
  let matrix=light_matrix(node,light.local_direction);
  if !matrix_is_finite(&matrix){self.report.add("node-invalid-transform");return;}
  let mut json=json!({"name":&*light.element.name,"type":kind,"color":[light.color.x,light.color.y,light.color.z],"intensity":light.intensity});
  if kind=="spot"{json["spot"]=json!({"innerConeAngle":light.inner_angle.to_radians(),"outerConeAngle":light.outer_angle.to_radians().max(0.001)});}
  self.lights.push(json);
  self.nodes.push(json!({"name":&*node.element.name,"matrix":matrix,"extensions":{"KHR_lights_punctual":{"light":self.lights.len()-1}}}));
 }
}

/// Imports every FBX/OBJ in `source` into `<cache>/native/imports/<key>/` and returns that directory.
/// The key hashes the input bytes and the importer version, so unchanged sources are reused.
pub fn import_source(inputs:&[PathBuf],cache:&Path,cancelled:&AtomicBool,progress:&(dyn Fn(Value)+Sync))->Result<PathBuf>{
 let started=std::time::Instant::now();
 let source=inputs.first().and_then(|f|if inputs.len()==1{Some(f.as_path())}else{f.parent()}).unwrap_or(Path::new("."));
 // Map every input once: the mapping hashes now and feeds the parser later without a second read.
 let mapped=inputs.iter().map(|input|Ok(unsafe{memmap2::MmapOptions::new().map(&fs::File::open(input)?)?})).collect::<Result<Vec<memmap2::Mmap>>>()?;
 let hashes:Vec<String>=mapped.iter().map(|m|hash(m)).collect();
 let mut key_material=String::from(IMPORTER_VERSION);
 for (input,digest) in inputs.iter().zip(&hashes){key_material.push('\n');key_material.push_str(input.file_name().and_then(|s|s.to_str()).unwrap_or(""));key_material.push(':');key_material.push_str(digest);}
 let key=hash(key_material.as_bytes());
 let directory=cache.join("native").join("imports").join(&key);
 let manifest_path=directory.join("manifest.json");
 if let Ok(bytes)=fs::read(&manifest_path){if let Ok(existing)=serde_json::from_slice::<Value>(&bytes){if existing["status"]=="ready"&&existing["source"]["importer"]==IMPORTER_VERSION&&directory.join("model.gltf").is_file()&&directory.join("model.bin").is_file(){progress(json!({"phase":"import-source","step":"reused","key":key,"files":inputs.len()}));return Ok(directory);}}}
 let mut importer=Importer{nodes:Vec::new(),meshes:Vec::new(),mesh_triangles:Vec::new(),materials:Vec::new(),accessors:Vec::new(),images:Vec::new(),samplers:Vec::new(),textures:Vec::new(),sampler_ids:HashMap::new(),lights:Vec::new(),bin:Bin{bytes:Vec::new(),views:Vec::new()},report:Report::default(),triangles:0,mesh_nodes:0,files:Vec::new(),cancelled,progress};
 let total=inputs.len();
 for (index,input) in inputs.iter().enumerate(){importer.check()?;importer.load(input,&mapped[index],&hashes[index],index,total)?;}
 if importer.mesh_nodes==0{return Err(CompilerError::new("IMPORT_EMPTY","No visible mesh instance in the source"));}
 let Importer{nodes,meshes,materials,accessors,images,samplers,textures,lights,bin,report,triangles,mesh_nodes,files,..}=importer;
 let bin_len=bin.bytes.len();
 let (mesh_count,material_count,image_count,light_count)=(meshes.len(),materials.len(),images.len(),lights.len());
 let mut gltf=json!({"asset":{"version":"2.0","generator":format!("web-geometry-compiler {} ({})",crate::COMPILER_VERSION,IMPORTER_VERSION)},"scene":0,"scenes":[{"nodes":(0..nodes.len()).collect::<Vec<_>>()}],"nodes":nodes,"meshes":meshes,"materials":materials,"accessors":accessors,"bufferViews":bin.views,"buffers":[{"uri":"model.bin","byteLength":bin_len}]});
 if !images.is_empty(){gltf["images"]=json!(images);gltf["samplers"]=json!(samplers);gltf["textures"]=json!(textures);}
 if !lights.is_empty(){gltf["extensions"]=json!({"KHR_lights_punctual":{"lights":lights}});gltf["extensionsUsed"]=json!(["KHR_lights_punctual"]);}
 let gltf_bytes=serde_json::to_vec(&gltf)?;
 fs::create_dir_all(&directory)?;
 progress(json!({"phase":"import-source","step":"write","bytes":bin_len+gltf_bytes.len()}));
 atomic(&directory.join("model.bin"),&bin.bytes)?;
 atomic(&directory.join("model.gltf"),&gltf_bytes)?;
 let mut manifest=runtime_manifest("model.gltf",&hash(&gltf_bytes),&[("model.bin".to_string(),hash(&bin.bytes))],mesh_nodes,triangles);
 manifest["runtime"]["bytes"]=json!(gltf_bytes.len());
 manifest["source"]=json!({"importer":IMPORTER_VERSION,"path":source.to_string_lossy(),"files":files,"key":key,"meshes":mesh_count,"materials":material_count,"images":image_count,"lights":light_count,"importMs":started.elapsed().as_secs_f64()*1000.0});
 manifest["unsupported"]=json!(report.unsupported);manifest["notes"]=json!(report.notes);
 atomic(&manifest_path,&serde_json::to_vec_pretty(&manifest)?)?;
 progress(json!({"phase":"import-source","step":"complete","key":key,"triangles":triangles,"meshNodes":mesh_nodes,"ms":started.elapsed().as_secs_f64()*1000.0}));
 Ok(directory)
}
