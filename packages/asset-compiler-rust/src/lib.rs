//! Native exact-cluster compiler. Rendering, UI and platform IPC do not belong here.
mod topology;
mod qem;
mod dag;
mod perf;
mod accessor_validation;
mod geometry_page;
mod manifest_binary;
pub mod import;
use std::{collections::{BTreeMap,BTreeSet},fmt::{Display,Formatter},fs::{self,File},io::{Read,Write,BufWriter,Seek,SeekFrom},path::{Path,PathBuf},sync::{Arc,atomic::{AtomicBool,Ordering}},time::Instant};
use serde_json::{Value,json};use sha2::{Sha256,Digest};use rayon::prelude::*;
pub const FORMAT_VERSION:u32=1;pub const COMPILER_VERSION:&str=env!("CARGO_PKG_VERSION");
pub const CLUSTERED_BLEND_FORMAT_VERSION:u32=2;
/// Per-cluster DAG identity: group QEM error projected through the group bounding sphere.
pub const DAG_ERROR_MODEL:&str="dag-group-qem-v1";
pub const DAG_CLUSTER_STRATEGY:&str="dag-groups";
/// Numbers per culling node: min[3], max[3], sphere[4], maxParentError, firstChild, childCount,
/// firstPage, pageCount. `maxParentError` is -1 when the subtree holds a cluster with no replacement.
pub const CULLING_STRIDE:usize=15;
/// Target size of one streaming bundle. A bundle is a single request that carries dozens of
/// clusters of the same level that sit next to each other, so filling a cut costs hundreds of
/// requests instead of tens of thousands. Clusters stay individually addressable through their own
/// object and through their offset inside the bundle.
pub const STREAM_BUNDLE_BYTES:usize=128*1024;
pub const STRUCTURE_VERSION:u32=1;
/// Target size of one bootstrap object. The root clusters of every primitive share these objects,
/// so the coarsest complete cover of a whole scene is a handful of large requests instead of one
/// small request per primitive — which is what the first image waits on.
pub const BOOTSTRAP_BUNDLE_BYTES:usize=1024*1024;
/// Name of the binary sidecar beside `clusters.json`.
pub const MANIFEST_BINARY_FILE:&str="clusters.bin";
#[derive(Debug)] pub struct CompilerError {pub code:&'static str,pub message:String}
impl CompilerError {fn new(code:&'static str,message:impl Into<String>)->Self{Self{code,message:message.into()}}}
impl Display for CompilerError {fn fmt(&self,f:&mut Formatter<'_>)->std::fmt::Result{write!(f,"{}: {}",self.code,self.message)}}
impl std::error::Error for CompilerError {}
impl From<std::io::Error> for CompilerError {fn from(value:std::io::Error)->Self{Self::new("IO_ERROR",value.to_string())}}
impl From<serde_json::Error> for CompilerError {fn from(value:serde_json::Error)->Self{Self::new("INVALID_JSON",value.to_string())}}
impl From<rayon::ThreadPoolBuildError> for CompilerError {fn from(value:rayon::ThreadPoolBuildError)->Self{Self::new("THREAD_POOL_ERROR",value.to_string())}}
pub type Result<T> = std::result::Result<T,CompilerError>;
#[derive(Clone)] pub struct Options {pub source:PathBuf,pub cache:PathBuf,pub resource_base:String,pub scope:String,pub triangle_budget:usize,pub threads:usize,pub ram_budget_mb:usize,pub simplification:String,pub cancelled:Arc<AtomicBool>}
pub const CLUSTER_TRIANGLES:usize=256;
fn invalid(message:impl Into<String>)->CompilerError{CompilerError::new("INVALID_GLTF",message)}
fn required_index(v:Option<&Value>,field:&str)->Result<usize>{let raw=v.and_then(Value::as_u64).ok_or_else(||invalid(format!("{field} must be an unsigned integer")))?;usize::try_from(raw).map_err(|_|invalid(format!("{field} is too large")))}
fn optional_index(v:Option<&Value>,field:&str,default:usize)->Result<usize>{match v{Some(value)=>required_index(Some(value),field),None=>Ok(default)}}
fn values<'a>(g:&'a Value,field:&str)->Result<&'a Vec<Value>>{g.get(field).and_then(Value::as_array).ok_or_else(||invalid(format!("{field} array is required")))}
fn item<'a>(items:&'a [Value],id:usize,field:&str)->Result<&'a Value>{items.get(id).ok_or_else(||invalid(format!("{field} index {id} is out of bounds")))}
fn hash(b:&[u8])->String{format!("{:x}",Sha256::digest(b))}
fn hash_file(p:&Path)->Result<String>{let mut f=File::open(p)?;let mut h=Sha256::new();let mut block=[0u8;65536];loop{let n=f.read(&mut block)?;if n==0{break}h.update(&block[..n]);}Ok(format!("{:x}",h.finalize()))}
fn is_safe_source_name(name:&str)->bool{!name.is_empty()&&name.len()<256&&name!="."&&name!=".."&&!name.contains('/')&&!name.contains('\\')&&!name.contains("..")&&!name.contains('\0')}
enum Binary {Mapped(memmap2::Mmap),Owned(Vec<u8>)}
impl Binary {fn bytes(&self)->&[u8]{match self{Self::Mapped(map)=>map,Self::Owned(bytes)=>bytes}}}
struct RuntimeSource {manifest:Value,manifest_bytes:Vec<u8>,g:Value,g_bytes:Vec<u8>,binary:Binary,bin_hash:String}
fn is_glb(bytes:&[u8])->bool{bytes.len()>=4&&bytes[0]==b'g'&&bytes[1]==b'l'&&bytes[2]==b'T'&&bytes[3]==b'F'}
fn parse_glb(bytes:&[u8])->Result<(Value,Vec<u8>)>{
 if bytes.len()<12{return Err(invalid("GLB too short"));}
 let magic=u32::from_le_bytes(bytes[0..4].try_into().unwrap());
 if magic!=0x4654_6C67{return Err(invalid("Not a GLB"));}
 let version=u32::from_le_bytes(bytes[4..8].try_into().unwrap());
 if version!=2{return Err(CompilerError::new("UNSUPPORTED_FORMAT","Only GLB version 2 is supported"));}
 let length=u32::from_le_bytes(bytes[8..12].try_into().unwrap()) as usize;
 if length!=bytes.len(){return Err(invalid("GLB length mismatch"));}
 let mut offset=12;let mut json=None;let mut bin=None;
 while offset+8<=bytes.len(){
  let chunk_len=u32::from_le_bytes(bytes[offset..offset+4].try_into().unwrap()) as usize;
  let chunk_type=u32::from_le_bytes(bytes[offset+4..offset+8].try_into().unwrap());
  offset+=8;
  let end=offset.checked_add(chunk_len).ok_or_else(||invalid("GLB chunk overflow"))?;
  if end>bytes.len(){return Err(invalid("GLB chunk exceeds file"));}
  let data=&bytes[offset..end];
  match chunk_type{0x4E4F_534A=>json=Some(serde_json::from_slice::<Value>(data)?),0x004E_4942=>bin=Some(data.to_vec()),_=>{}}
  offset=end;
 }
 Ok((json.ok_or_else(||invalid("GLB JSON chunk is required"))?,bin.unwrap_or_default()))
}
fn primitive_triangles(g:&Value,p:&Value)->Result<usize>{
 let attributes=p.get("attributes").and_then(Value::as_object).ok_or_else(||invalid("primitive.attributes is required"))?;
 if !attributes.contains_key("POSITION"){return Err(invalid("primitive.attributes.POSITION is required"));}
 let accessors=values(g,"accessors")?;
 if let Some(index_v)=p.get("indices"){
  let id=required_index(Some(index_v),"primitive.indices")?;
  let count=required_index(item(accessors,id,"accessor")?.get("count"),"accessor.count")?;
  if count==0||count%3!=0{return Err(CompilerError::new("INVALID_TRIANGLES","Index count must be a positive multiple of three"));}
  Ok(count/3)
 }else{
  let id=required_index(attributes.get("POSITION"),"primitive.attributes.POSITION")?;
  let count=required_index(item(accessors,id,"accessor")?.get("count"),"accessor.count")?;
  if count==0||count%3!=0{return Err(invalid("Unindexed POSITION count must be a positive multiple of three"));}
  Ok(count/3)
 }
}
fn node_triangles(g:&Value,node:&Value)->Result<usize>{
 let mesh_id=required_index(node.get("mesh"),"node.mesh")?;
 let mesh=item(values(g,"meshes")?,mesh_id,"mesh")?;
 let mut triangles=0;
 for p in values(mesh,"primitives")?{triangles+=primitive_triangles(g,p)?;}
 Ok(triangles)
}
fn source_stats(g:&Value)->Result<(usize,usize)>{
 let mut mesh_nodes=0;let mut triangles=0;
 for n in values(g,"nodes")?{
  if n.get("mesh").is_some(){mesh_nodes+=1;triangles+=node_triangles(g,n)?;}
 }
 Ok((mesh_nodes,triangles))
}
fn discover_model(dir:&Path)->Result<String>{
 let mut found=Vec::new();
 for entry in fs::read_dir(dir)?{
  let entry=entry?;
  let name=entry.file_name();
  let Some(name)=name.to_str() else {continue};
  if !is_safe_source_name(name){continue;}
  let lower=name.to_ascii_lowercase();
  if lower.ends_with(".gltf")||lower.ends_with(".glb"){found.push(name.to_string());}
 }
 if found.len()!=1{return Err(invalid("Source directory needs manifest.json, exactly one .gltf/.glb or .fbx/.obj files"));}
 Ok(found.pop().unwrap())
}
fn unsplit_material(material:Option<&Value>)->bool{
 let Some(material)=material else {return false};
 material.get("extensions").and_then(|e|e.get("KHR_materials_transmission")).and_then(|t|t.get("transmissionFactor")).and_then(Value::as_f64).map(|v|v>0.0).unwrap_or(false)
}
fn relative_image_uri(uri:&str)->bool{!uri.is_empty()&&!uri.starts_with("data:")&&!uri.starts_with('/')&&!uri.contains("://")}
fn rewrite_images(source:&mut Value,resource_base:&str,view_map:&BTreeMap<usize,usize>)->Result<()>{
 let Some(images)=source.get_mut("images").and_then(Value::as_array_mut) else {return Ok(())};
 let base=resource_base.trim_end_matches('/');
 for image in images{
  if let Some(uri)=image.get("uri").and_then(Value::as_str){
   if relative_image_uri(uri){image["uri"]=json!(format!("{base}/{uri}"));}
  }
  if image.get("bufferView").is_some(){
   let old=required_index(image.get("bufferView"),"image.bufferView")?;
   let mapped=*view_map.get(&old).ok_or_else(||invalid("image.bufferView is not in the compacted buffer"))?;
   image["bufferView"]=json!(mapped);
  }
 }
 Ok(())
}
/// A file with an import extension, or a directory holding importable files and neither a manifest nor a glTF.
fn needs_import(source:&Path)->Result<bool>{
 if source.is_file(){return Ok(source.file_name().and_then(|s|s.to_str()).map(import::is_import_source).unwrap_or(false));}
 if source.join("manifest.json").exists(){return Ok(false);}
 let mut gltf=0;let mut importable=0;
 for entry in fs::read_dir(source)?{let entry=entry?;let name=entry.file_name();let Some(name)=name.to_str() else {continue};let lower=name.to_ascii_lowercase();if lower.ends_with(".gltf")||lower.ends_with(".glb"){gltf+=1;}else if import::is_import_source(name){importable+=1;}}
 Ok(gltf==0&&importable>0)
}
fn validate_manifest(manifest:&Value)->Result<()>{
 if manifest.get("status").and_then(Value::as_str)!=Some("ready"){return Err(CompilerError::new("SOURCE_NOT_READY","Source manifest is not ready"));}
 if let Some(version)=manifest.get("formatVersion").and_then(Value::as_u64){if version!=FORMAT_VERSION as u64{return Err(CompilerError::new("UNSUPPORTED_FORMAT",format!("Expected {FORMAT_VERSION}, received {version}")));}}
 Ok(())
}
fn verify_sidecar(declared:Option<&Value>,uri:&str,actual:&str)->Result<()>{
 let Some(manifest)=declared else {return Ok(())};
 let Some(sidecars)=manifest.get("runtime").and_then(|r|r.get("sidecars")).and_then(Value::as_array) else {return Ok(())};
 let sidecar=sidecars.iter().find(|v|v.get("file").and_then(Value::as_str)==Some(uri)).ok_or_else(||invalid("buffer sidecar hash is required"))?;
 if actual!=sidecar.get("sha256").and_then(Value::as_str).ok_or_else(||invalid("sidecar.sha256 is required"))?{return Err(CompilerError::new("SOURCE_HASH_MISMATCH","Binary hash differs from manifest"));}
 Ok(())
}
fn concat_gltf_buffers(dir:&Path,g:&Value,embedded:Option<&[u8]>,declared:Option<&Value>)->Result<(Binary,Vec<usize>,Vec<(String,String)>)>{
 let buffers=values(g,"buffers")?;
 if buffers.is_empty(){return Err(invalid("glTF buffers are required"));}
 if buffers.len()==1{
  if let Some(uri)=buffers[0].get("uri").and_then(Value::as_str).filter(|s|!s.is_empty()){
   if !is_safe_source_name(uri){return Err(invalid("glTF buffer uri is required"));}
   let digest=hash_file(&dir.join(uri))?;
   verify_sidecar(declared,uri,&digest)?;
   let file=File::open(dir.join(uri))?;
   let map=unsafe{memmap2::MmapOptions::new().map(&file)?};
   if required_index(buffers[0].get("byteLength"),"buffer.byteLength")? > map.len(){return Err(invalid("glTF buffer byteLength exceeds source bytes"));}
   return Ok((Binary::Mapped(map),vec![0],vec![(uri.to_string(),digest)]));
  }
  if let Some(bin)=embedded{if required_index(buffers[0].get("byteLength"),"buffer.byteLength")? > bin.len(){return Err(invalid("glTF buffer byteLength exceeds source bytes"));}return Ok((Binary::Owned(bin.to_vec()),vec![0],Vec::new()));}
 }
 let mut out=Vec::new();let mut offsets=Vec::new();let mut sidecars=Vec::new();
 for (i,buffer) in buffers.iter().enumerate(){
  let pad=(4-out.len()%4)%4;out.extend(std::iter::repeat(0u8).take(pad));offsets.push(out.len());
  if let Some(uri)=buffer.get("uri").and_then(Value::as_str).filter(|s|!s.is_empty()){
   if !is_safe_source_name(uri){return Err(invalid("glTF buffer uri is required"));}
   let bytes=fs::read(dir.join(uri))?;
   if required_index(buffer.get("byteLength"),"buffer.byteLength")? > bytes.len(){return Err(invalid("glTF buffer byteLength exceeds source bytes"));}
   let digest=hash(&bytes);
   verify_sidecar(declared,uri,&digest)?;
   sidecars.push((uri.to_string(),digest));
   out.extend_from_slice(&bytes);
  }else if i==0{
   let bin=embedded.ok_or_else(||invalid("glTF buffer uri is required"))?;
   if required_index(buffer.get("byteLength"),"buffer.byteLength")? > bin.len(){return Err(invalid("glTF buffer byteLength exceeds source bytes"));}
   out.extend_from_slice(bin);
  }else{return Err(invalid("glTF buffer uri is required"));}
 }
 Ok((Binary::Owned(out),offsets,sidecars))
}
fn flatten_buffer_views(g:&mut Value,offsets:&[usize],bin_len:usize)->Result<()>{
 let declared:Vec<usize>=values(g,"buffers")?.iter().map(|b|required_index(b.get("byteLength"),"buffer.byteLength")).collect::<Result<_>>()?;
 let views=g.get_mut("bufferViews").and_then(Value::as_array_mut).ok_or_else(||invalid("bufferViews array is required"))?;
 for (id,v) in views.iter_mut().enumerate(){
  let buffer=optional_index(v.get("buffer"),"bufferView.buffer",0)?;
  if buffer>=offsets.len(){return Err(invalid(format!("bufferView.buffer {buffer} is out of bounds")));}
  let start=offsets[buffer].checked_add(optional_index(v.get("byteOffset"),"bufferView.byteOffset",0)?).ok_or_else(||invalid("bufferView offset overflow"))?;
  let len=required_index(v.get("byteLength"),"bufferView.byteLength")?;
  let local=optional_index(v.get("byteOffset"),"bufferView.byteOffset",0)?;
  if local.checked_add(len).filter(|&end|end<=declared[buffer]).is_none(){return Err(invalid("bufferView exceeds declared buffer bounds"));}
  let end=start.checked_add(len).ok_or_else(||invalid("bufferView range overflow"))?;
  if end>bin_len{return Err(CompilerError::new("BUFFER_OUT_OF_BOUNDS","bufferView exceeds binary buffer"));}
  v["buffer"]=json!(0);
  v["byteOffset"]=json!(start);
  let _id=id;
 }
 g["buffers"]=json!([{"byteLength":bin_len}]);
 Ok(())
}
fn load_model_file(dir:&Path,name:&str,declared:Option<(Value,Vec<u8>)>)->Result<RuntimeSource>{
 if !is_safe_source_name(name){return Err(invalid("manifest.runtime.file is required"));}
 if let Some((ref manifest,_))=&declared{validate_manifest(manifest)?;}
 let file_bytes=fs::read(dir.join(name))?;
 if let Some((ref manifest,_))=&declared{
  let expected=manifest.pointer("/runtime/sha256").and_then(Value::as_str).ok_or_else(||invalid("manifest.runtime.sha256 is required"))?;
  if hash(&file_bytes)!=expected{return Err(CompilerError::new("SOURCE_HASH_MISMATCH","glTF hash differs from manifest"));}
 }
 let declared_ref=declared.as_ref().map(|(m,_)|m);
 let (mut g,binary,offsets,sidecars)=if is_glb(&file_bytes){
  let (g,bin)=parse_glb(&file_bytes)?;
  let (binary,offsets,sidecars)=concat_gltf_buffers(dir,&g,Some(&bin),declared_ref)?;
  (g,binary,offsets,sidecars)
 }else{
  let g:Value=serde_json::from_slice(&file_bytes)?;
  let (binary,offsets,sidecars)=concat_gltf_buffers(dir,&g,None,declared_ref)?;
  (g,binary,offsets,sidecars)
 };
 flatten_buffer_views(&mut g,&offsets,binary.bytes().len())?;
 let bin_hash=hash(binary.bytes());
 let (manifest,manifest_bytes)=if let Some(pair)=declared{
  pair
 }else{
  let (mesh_nodes,triangles)=source_stats(&g)?;
  let sidecar_json:Vec<Value>=sidecars.iter().map(|(file,sha)|json!({"file":file,"sha256":sha})).collect();
  let manifest=json!({"status":"ready","formatVersion":FORMAT_VERSION,"runtime":{"file":name,"sha256":hash(&file_bytes),"sidecars":sidecar_json,"trianglesAcrossNodes":triangles,"meshNodes":mesh_nodes}});
  let manifest_bytes=serde_json::to_vec(&manifest)?;
  (manifest,manifest_bytes)
 };
 Ok(RuntimeSource{manifest,manifest_bytes,g,g_bytes:file_bytes,binary,bin_hash})
}
fn load_runtime(o:&Options)->Result<RuntimeSource>{
 if o.source.is_file(){
  let name=o.source.file_name().and_then(|s|s.to_str()).ok_or_else(||invalid("runtime file is required"))?;
  let parent=o.source.parent().filter(|p|!p.as_os_str().is_empty()).unwrap_or_else(||Path::new("."));
  return load_model_file(parent,name,None);
 }
 let manifest_path=o.source.join("manifest.json");
 if manifest_path.exists(){
  let manifest_bytes=fs::read(&manifest_path)?;
  let manifest:Value=serde_json::from_slice(&manifest_bytes)?;
  validate_manifest(&manifest)?;
  let gltf_file=manifest.get("runtime").and_then(|r|r.get("file")).and_then(Value::as_str).map(str::to_owned).ok_or_else(||invalid("manifest.runtime.file is required"))?;
  return load_model_file(&o.source,&gltf_file,Some((manifest,manifest_bytes)));
 }
 let name=discover_model(&o.source)?;
 load_model_file(&o.source,&name,None)
}
fn atomic(path:&Path,data:&[u8])->Result<()>{let temp=path.with_extension(format!("tmp-{}-{:?}",std::process::id(),std::thread::current().id()));fs::write(&temp,data)?;fs::rename(temp,path)?;Ok(())}
/// Content-addressed object store write.
///
/// The file name is the SHA-256 of its bytes, so a name always holds the same content. Creating the
/// file exclusively never truncates an object another process already finished, and `clusters.json`
/// — the only file that names an object — is published atomically once every object is on disk, so
/// no reader can learn of an object before it is complete. Dropping the temp-file rename halves the
/// directory work, which dominates a cache made of tens of thousands of small objects.
fn store_object(path:&Path,data:&[u8])->Result<()>{
 match fs::OpenOptions::new().write(true).create_new(true).open(path){
  Ok(mut file)=>{file.write_all(data)?;Ok(())}
  Err(error) if error.kind()==std::io::ErrorKind::AlreadyExists=>atomic(path,data),
  Err(error)=>Err(error.into()),
 }
}
/// Merges the pinned root bundles of every primitive into a few shared bootstrap objects.
///
/// A bundle is built inside one primitive, so a scene of hundreds of primitives pays hundreds of
/// small requests before it can show its fallback cover. Concatenating those payloads costs nothing
/// at read time — a cluster is still read at its own offset — and turns the bootstrap into a handful
/// of requests. Two primitives that share a root bundle share its slice, so instancing does not
/// inflate the bootstrap. Every primitive keeps its own bundle entries; they now name a shared
/// object and carry the offset of their slice inside it.
fn share_bootstrap_bundles(o:&Options,primitives:&mut [Value])->Result<usize>{
 let objects=o.cache.join("native").join("objects");
 // (primitive, bundle) of every pinned bundle, in manifest order: the packing is deterministic.
 let mut members:Vec<(usize,usize)>=Vec::new();
 for (index,primitive) in primitives.iter().enumerate(){
  let Some(streams)=primitive.get("streams").and_then(Value::as_object) else {continue};
  let pinned=streams.get("pinned").and_then(Value::as_u64).unwrap_or(0) as usize;
  let bundles=streams.get("pages").and_then(Value::as_array).map_or(0,Vec::len);
  for bundle in 0..pinned.min(bundles){members.push((index,bundle));}
 }
 if members.len()<2{return Ok(members.len())}
 let mut payloads:Vec<Vec<u8>>=Vec::new();let mut clusters:Vec<u64>=Vec::new();
 let mut placed:BTreeMap<String,(usize,usize)>=BTreeMap::new();
 let mut slots:Vec<(usize,usize)>=Vec::with_capacity(members.len());
 for &(primitive,bundle) in &members{
  let entry=&primitives[primitive]["streams"]["pages"][bundle];
  let digest=entry["sha256"].as_str().ok_or_else(||invalid("Stream bundle has no digest"))?.to_string();
  let bytes=entry["bytes"].as_u64().ok_or_else(||invalid("Stream bundle has no byte length"))? as usize;
  let count=entry["count"].as_u64().unwrap_or(0);
  if let Some(&slot)=placed.get(&digest){slots.push(slot);continue}
  if payloads.last().is_none_or(|payload|!payload.is_empty()&&payload.len()+bytes>BOOTSTRAP_BUNDLE_BYTES){payloads.push(Vec::new());clusters.push(0);}
  let chunk=payloads.len()-1;let offset=payloads[chunk].len();
  let source=fs::read(objects.join(format!("{digest}.bin")))?;
  if source.len()!=bytes{return Err(CompilerError::new("INVALID_CLUSTER_PARTITION","A stream bundle object does not match its declared size"))}
  payloads[chunk].extend_from_slice(&source);clusters[chunk]+=count;
  placed.insert(digest,(chunk,offset));slots.push((chunk,offset));
 }
 let mut names=Vec::with_capacity(payloads.len());
 for payload in &payloads{
  let digest=hash(payload);
  let target=objects.join(format!("{digest}.bin"));
  if !(target.exists()&&hash_file(&target)?==digest){store_object(&target,payload)?;}
  names.push(digest);
 }
 // Patch every pinned entry and shift the offsets of the clusters it carries.
 for (member,&(chunk,offset)) in members.iter().zip(slots.iter()){
  let (primitive,bundle)=*member;
  {
   let entry=&mut primitives[primitive]["streams"]["pages"][bundle];
   *entry=json!({"url":format!("../../objects/{}.bin",names[chunk]),"sha256":names[chunk],"bytes":payloads[chunk].len(),"count":clusters[chunk]});
  }
  if offset==0{continue}
  let pages=primitives[primitive]["pages"].as_array_mut().ok_or_else(||invalid("primitive.pages is required"))?;
  for page in pages{
   if page.get("stream").and_then(Value::as_u64)!=Some(bundle as u64){continue}
   let previous=page.get("streamOffset").and_then(Value::as_u64).ok_or_else(||invalid("A bundled cluster has no offset"))? as usize;
   page["streamOffset"]=json!(previous+offset);
  }
 }
 Ok(payloads.len())
}
fn check(o:&Options)->Result<()>{if o.cancelled.load(Ordering::Relaxed){return Err(CompilerError::new("CANCELLED","Compilation cancelled"))}Ok(())}
struct SparseAccessor<'a>{count:usize,indices_bin:&'a [u8],indices_offset:usize,indices_component:usize,values_bin:&'a [u8],values_offset:usize}
struct Accessor<'a>{bin:&'a [u8],base:usize,stride:usize,count:usize,component:usize,bytes:usize,width:usize,normalized:bool,has_buffer_view:bool,sparse:Option<SparseAccessor<'a>>}
fn accessor<'a>(g:&'a Value,bin:&'a [u8],id:usize)->Result<Accessor<'a>>{accessor_validation::validate(g,bin,id)?;let accessors=values(g,"accessors")?;let views=values(g,"bufferViews")?;let a=item(accessors,id,"accessor")?;
 let component=required_index(a.get("componentType"),"accessor.componentType")?;let normalized=a.get("normalized").and_then(Value::as_bool)==Some(true);if normalized&&component==5126{return Err(invalid("FLOAT accessor cannot be normalized"));}let bytes=match component{5120|5121=>1,5122|5123=>2,5125|5126=>4,_=>return Err(CompilerError::new("UNSUPPORTED_COMPONENT",component.to_string()))};let width=match a.get("type").and_then(Value::as_str){Some("SCALAR")=>1,Some("VEC2")=>2,Some("VEC3")=>3,Some("VEC4")=>4,_=>return Err(CompilerError::new("UNSUPPORTED_ACCESSOR_TYPE","Unsupported or missing accessor type"))};let count=required_index(a.get("count"),"accessor.count")?;
 let (base,stride,has_buffer_view)=if let Some(bv)=a.get("bufferView"){let view_id=required_index(Some(bv),"accessor.bufferView")?;let v=item(views,view_id,"bufferView")?;if optional_index(v.get("buffer"),"bufferView.buffer",0)?!=0{return Err(CompilerError::new("UNSUPPORTED_ACCESSOR","Only buffer zero is supported"));}let base=optional_index(v.get("byteOffset"),"bufferView.byteOffset",0)?.checked_add(optional_index(a.get("byteOffset"),"accessor.byteOffset",0)?).ok_or_else(||invalid("Accessor offset overflow"))?;let stride=optional_index(v.get("byteStride"),"bufferView.byteStride",width*bytes)?;if stride<width*bytes{return Err(invalid("Accessor stride is smaller than one element"));}(base,stride,true)}else{if a.get("sparse").is_none(){return Err(invalid("Accessor requires bufferView unless sparse"));}(0,width*bytes,false)};
 let sparse=if let Some(sparse_val)=a.get("sparse"){let scount=required_index(sparse_val.get("count"),"sparse.count")?;let ind_obj=sparse_val.get("indices").ok_or_else(||invalid("sparse.indices is required"))?;let ind_view_id=required_index(ind_obj.get("bufferView"),"sparse.indices.bufferView")?;let ind_view=item(views,ind_view_id,"bufferView")?;let ind_comp=required_index(ind_obj.get("componentType"),"sparse.indices.componentType")?;let ind_off=optional_index(ind_view.get("byteOffset"),"sparse.indices.view.byteOffset",0)?.checked_add(optional_index(ind_obj.get("byteOffset"),"sparse.indices.byteOffset",0)?).ok_or_else(||invalid("Sparse indices offset overflow"))?;let val_obj=sparse_val.get("values").ok_or_else(||invalid("sparse.values is required"))?;let val_view_id=required_index(val_obj.get("bufferView"),"sparse.values.bufferView")?;let val_view=item(views,val_view_id,"bufferView")?;let val_off=optional_index(val_view.get("byteOffset"),"sparse.values.view.byteOffset",0)?.checked_add(optional_index(val_obj.get("byteOffset"),"sparse.values.byteOffset",0)?).ok_or_else(||invalid("Sparse values offset overflow"))?;Some(SparseAccessor{count:scount,indices_bin:bin,indices_offset:ind_off,indices_component:ind_comp,values_bin:bin,values_offset:val_off})}else{None};
 Ok(Accessor{bin,base,stride,count,component,bytes,width,normalized,has_buffer_view,sparse})
}
impl Accessor<'_>{
 fn bytes_at(&self,i:usize,c:usize)->Result<&[u8]>{if i>=self.count||c>=self.width{return Err(CompilerError::new("INDEX_OUT_OF_BOUNDS","Accessor element is out of bounds"))}if !self.has_buffer_view{return Ok(&[0u8;4][..self.bytes]);}let o=self.base.checked_add(i.checked_mul(self.stride).ok_or_else(||invalid("Accessor offset overflow"))?).and_then(|value|value.checked_add(c*self.bytes)).ok_or_else(||invalid("Accessor offset overflow"))?;self.bin.get(o..o+self.bytes).ok_or_else(||CompilerError::new("BUFFER_OUT_OF_BOUNDS","Accessor exceeds binary buffer"))}
 fn decoded_value(&self,b:&[u8])->Result<f64>{let raw=match self.component{5120=>(b[0] as i8) as f64,5121=>b[0] as f64,5122=>i16::from_le_bytes([b[0],b[1]]) as f64,5123=>u16::from_le_bytes([b[0],b[1]]) as f64,5125=>u32::from_le_bytes([b[0],b[1],b[2],b[3]]) as f64,5126=>f32::from_le_bytes([b[0],b[1],b[2],b[3]]) as f64,_=>return Err(invalid("Unsupported component"))};if !self.normalized{return Ok(raw)}Ok(match self.component{5120=>(raw/127.).max(-1.),5121=>raw/255.,5122=>(raw/32767.).max(-1.),5123=>raw/65535.,5125=>raw/4294967295.,_=>return Err(invalid("Unsupported normalized component"))})}
 fn value(&self,i:usize,c:usize)->Result<f64>{self.decoded_value(self.bytes_at(i,c)?)}
 fn u32_at(&self,i:usize)->Result<u32>{let b=self.bytes_at(i,0)?;match self.component{5121=>Ok(b[0] as u32),5123=>Ok(u16::from_le_bytes([b[0],b[1]]) as u32),5125=>Ok(u32::from_le_bytes([b[0],b[1],b[2],b[3]])),5126=>{let value=f32::from_le_bytes([b[0],b[1],b[2],b[3]]);if !value.is_finite()||value.fract()!=0.||value<0.||value>u32::MAX as f32{return Err(invalid("Index is not an unsigned 32-bit integer"))}Ok(value as u32)},_=>Err(invalid("Unsupported component"))}}
 fn f32_at(&self,i:usize,c:usize)->Result<f32>{let value=self.value(i,c)? as f32;if !value.is_finite(){return Err(CompilerError::new("NONFINITE_POSITION","Position is not finite"))}Ok(value)}
 fn collect_u32(&self)->Result<Vec<u32>>{
  if self.normalized||!matches!(self.component,5121|5123|5125){return Err(invalid("Indices require an unsigned integer accessor"));}
  let mut out=Vec::with_capacity(self.count);
  if !self.has_buffer_view{out.resize(self.count,0);}
  else if self.width==1&&self.stride==self.bytes&&self.component!=5126{
   let nbytes=self.count.checked_mul(self.bytes).ok_or_else(||invalid("Accessor offset overflow"))?;let end=self.base.checked_add(nbytes).ok_or_else(||invalid("Accessor offset overflow"))?;let slice=self.bin.get(self.base..end).ok_or_else(||CompilerError::new("BUFFER_OUT_OF_BOUNDS","Accessor exceeds binary buffer"))?;
   match self.component{5121=>out.extend(slice.iter().map(|&b|b as u32)),5123=>{for chunk in slice.chunks_exact(2){out.push(u16::from_le_bytes([chunk[0],chunk[1]]) as u32);}},5125=>{for chunk in slice.chunks_exact(4){out.push(u32::from_le_bytes([chunk[0],chunk[1],chunk[2],chunk[3]]));}},_=>{}}
  }else{for i in 0..self.count{out.push(self.u32_at(i)?);}}
  if let Some(sparse)=&self.sparse{
   for k in 0..sparse.count{
    let idx=match sparse.indices_component{5121=>*sparse.indices_bin.get(sparse.indices_offset+k).ok_or_else(||invalid("Sparse index out of bounds"))? as usize,5123=>{let o=sparse.indices_offset+k*2;let b=sparse.indices_bin.get(o..o+2).ok_or_else(||invalid("Sparse index out of bounds"))?;u16::from_le_bytes([b[0],b[1]]) as usize},5125=>{let o=sparse.indices_offset+k*4;let b=sparse.indices_bin.get(o..o+4).ok_or_else(||invalid("Sparse index out of bounds"))?;u32::from_le_bytes([b[0],b[1],b[2],b[3]]) as usize},_=>return Err(invalid("Unsupported sparse indices component"))};
    if idx>=self.count{return Err(CompilerError::new("INDEX_OUT_OF_BOUNDS","Sparse index exceeds count"));}
    let vo=sparse.values_offset+k*self.bytes;let b=sparse.values_bin.get(vo..vo+self.bytes).ok_or_else(||invalid("Sparse value out of bounds"))?;
    let val=match self.component{5121=>b[0] as u32,5123=>u16::from_le_bytes([b[0],b[1]]) as u32,5125=>u32::from_le_bytes([b[0],b[1],b[2],b[3]]),_=>return Err(invalid("Unsupported component"))};
    out[idx]=val;
   }
  }
  Ok(out)
 }
 fn collect_f32(&self)->Result<Vec<f32>>{
  let n=self.count.checked_mul(self.width).ok_or_else(||invalid("Accessor offset overflow"))?;let mut out=Vec::with_capacity(n);
  if !self.has_buffer_view{out.resize(n,0.0);}
  else if self.component==5126&&self.stride==self.width*self.bytes{
   let nbytes=n.checked_mul(4).ok_or_else(||invalid("Accessor offset overflow"))?;let end=self.base.checked_add(nbytes).ok_or_else(||invalid("Accessor offset overflow"))?;let slice=self.bin.get(self.base..end).ok_or_else(||CompilerError::new("BUFFER_OUT_OF_BOUNDS","Accessor exceeds binary buffer"))?;
   for chunk in slice.chunks_exact(4){let value=f32::from_le_bytes([chunk[0],chunk[1],chunk[2],chunk[3]]);if !value.is_finite(){return Err(CompilerError::new("NONFINITE_POSITION","Position is not finite"));}out.push(value);}
  }else{for i in 0..self.count{for c in 0..self.width{out.push(self.f32_at(i,c)?);}}}
  if let Some(sparse)=&self.sparse{
   for k in 0..sparse.count{
    let idx=match sparse.indices_component{5121=>*sparse.indices_bin.get(sparse.indices_offset+k).ok_or_else(||invalid("Sparse index out of bounds"))? as usize,5123=>{let o=sparse.indices_offset+k*2;let b=sparse.indices_bin.get(o..o+2).ok_or_else(||invalid("Sparse index out of bounds"))?;u16::from_le_bytes([b[0],b[1]]) as usize},5125=>{let o=sparse.indices_offset+k*4;let b=sparse.indices_bin.get(o..o+4).ok_or_else(||invalid("Sparse index out of bounds"))?;u32::from_le_bytes([b[0],b[1],b[2],b[3]]) as usize},_=>return Err(invalid("Unsupported sparse indices component"))};
    if idx>=self.count{return Err(CompilerError::new("INDEX_OUT_OF_BOUNDS","Sparse index exceeds count"));}
    for c in 0..self.width{let vo=sparse.values_offset+(k*self.width+c)*self.bytes;let b=sparse.values_bin.get(vo..vo+self.bytes).ok_or_else(||invalid("Sparse value out of bounds"))?;let val=self.decoded_value(b)? as f32;if !val.is_finite(){return Err(CompilerError::new("NONFINITE_POSITION","Position is not finite"));}out[idx*self.width+c]=val;}
   }
  }
  Ok(out)
 }
}
/// Order-independent multiset fingerprint of a triangle list. Detects a partition that drops,
/// duplicates or alters a triangle without holding every triangle in memory.
fn triangle_fingerprint<'a>(triangles:impl Iterator<Item=&'a [u32]>)->u64{
 let mut total=0u64;
 for tri in triangles{
  let mut corners=[tri[0],tri[1],tri[2]];corners.sort_unstable();
  let mut hash=0x9e37_79b9_7f4a_7c15u64;
  for corner in corners{hash=(hash^corner as u64).wrapping_mul(0x100_0000_01b3);hash^=hash>>29;}
  total=total.wrapping_add(hash);
 }
 total
}
pub fn parse_compiler_args(args:&[String],cancelled:Arc<AtomicBool>)->std::result::Result<Options,String>{
 fn number(value:Option<&String>,default:usize,name:&str)->std::result::Result<usize,String>{match value{Some(raw)=>raw.parse::<usize>().ok().filter(|v|*v>0).ok_or_else(||format!("{name} must be a positive integer")),None=>Ok(default)}}
 let (scope,triangle_budget,threads,ram_budget_mb,resource_base,simplification)=match args.len(){
  5=>(args[2].clone(),number(Some(&args[3]),150000,"triangles")?,2,256,args[4].clone(),"none".into()),
  7=>(args[2].clone(),number(Some(&args[3]),150000,"triangles")?,number(Some(&args[4]),2,"threads")?,number(Some(&args[5]),256,"RAM_MB")?,args[6].clone(),"none".into()),
  8=>(args[2].clone(),number(Some(&args[3]),150000,"triangles")?,number(Some(&args[4]),2,"threads")?,number(Some(&args[5]),256,"RAM_MB")?,args[6].clone(),args[7].clone()),
  _=>return Err("Usage: web-geometry-compiler SOURCE CACHE [slice|full] [triangles] RESOURCE_BASE_URL\n       web-geometry-compiler SOURCE CACHE [slice|full] [triangles] [threads] [RAM_MB] RESOURCE_BASE_URL [none|qem-endpoints]\n       SOURCE is a .gltf/.glb file or a directory".into()),
 };
 if !["none","qem-endpoints"].contains(&simplification.as_str()){return Err("simplification must be none or qem-endpoints".into());}
 Ok(Options{source:PathBuf::from(&args[0]),cache:PathBuf::from(&args[1]),resource_base,scope,triangle_budget,threads,ram_budget_mb,simplification,cancelled})
}
/// Library entry point: strategy, cancellation, storage roots and progress are supplied by the host.
pub fn compile(o:&Options,progress:impl Fn(Value)+Sync)->Result<Value>{
 check(o)?;if !["slice","full"].contains(&o.scope.as_str())||o.triangle_budget==0||o.threads==0||o.threads>64||o.ram_budget_mb<64||o.resource_base.is_empty()||!["none","qem-endpoints"].contains(&o.simplification.as_str()){return Err(CompilerError::new("INVALID_OPTIONS","scope, budgets, threads, resource_base and simplification must be valid"))}
 let started=Instant::now();
 // FBX/OBJ sources are first turned into a glTF pair inside the cache; everything below reads glTF only.
 let imported;let o=if needs_import(&o.source)?{imported=Options{source:import::import_source(&o.source,&o.cache,&o.cancelled,&progress)?,..o.clone()};&imported}else{o};
 let loaded=load_runtime(o)?;
 let bin=loaded.binary.bytes();
 let g=&loaded.g;
 let g_bytes=&loaded.g_bytes;
 let manifest=&loaded.manifest;
 let bin_hash=&loaded.bin_hash;
 let mut implementation=Sha256::new();implementation.update(include_bytes!("lib.rs"));implementation.update(include_bytes!("main.rs"));implementation.update(include_bytes!("topology.rs"));implementation.update(include_bytes!("qem.rs"));implementation.update(include_bytes!("dag.rs"));implementation.update(include_bytes!("accessor_validation.rs"));implementation.update(include_bytes!("geometry_page.rs"));implementation.update(include_bytes!("manifest_binary.rs"));implementation.update(include_bytes!("import.rs"));implementation.update(include_bytes!("../Cargo.toml"));implementation.update(include_bytes!("../Cargo.lock"));
 let key=hash(serde_json::to_string(&json!({"source":hash(&loaded.manifest_bytes),"binary":bin_hash,"compiler":COMPILER_VERSION,"implementation":format!("{:x}",implementation.finalize()),"scope":o.scope,"budget":o.triangle_budget,"resourceBase":o.resource_base,"simplification":o.simplification,"errorModel":DAG_ERROR_MODEL}))?.as_bytes());
  let nodes=values(g,"nodes")?;let mesh_values=values(g,"meshes")?;let accessor_values=values(g,"accessors")?;let view_values=values(g,"bufferViews")?;let mut chosen=BTreeSet::new();let mut selected_triangles=0;let mut overflowing=Vec::new();
  let mut skinned_meshes=BTreeSet::new();
  for (i,n) in nodes.iter().enumerate(){
   if n.get("mesh").is_some(){
    if n.get("skin").is_some(){
     if let Ok(m)=required_index(n.get("mesh"),"node.mesh"){skinned_meshes.insert(m);}
    }
    let triangles=node_triangles(g,n)?;
    if o.scope=="full"||selected_triangles+triangles<=o.triangle_budget{chosen.insert(i);selected_triangles+=triangles;}else{overflowing.push((i,triangles));}
   }
  }
  if chosen.is_empty(){
   overflowing.sort_by_key(|&(i,triangles)|(triangles,i));
   if let Some((i,triangles))=overflowing.first().copied(){chosen.insert(i);selected_triangles=triangles;}
   else{return Err(CompilerError::new("EMPTY_SLICE","No complete mesh instance fits the slice budget"));}
  }
  let mut meshes=BTreeSet::new();for i in &chosen{meshes.insert(required_index(nodes[*i].get("mesh"),"node.mesh")?);}let mesh_map:BTreeMap<usize,usize>=meshes.iter().enumerate().map(|(new,old)|(*old,new)).collect();
  let mut accessors=BTreeSet::new();let mut jobs=Vec::new();
  for old in &meshes{
   for (primitive,p) in values(item(mesh_values,*old,"mesh")?,"primitives")?.iter().enumerate(){
    if let Some(indices)=p.get("indices"){accessors.insert(required_index(Some(indices),"primitive.indices")?);}
    let attributes=p.get("attributes").and_then(Value::as_object).ok_or_else(||invalid("primitive.attributes is required"))?;
    if !attributes.contains_key("POSITION"){return Err(invalid("primitive.attributes.POSITION is required"))}
    for a in attributes.values(){accessors.insert(required_index(Some(a),"primitive attribute")?);}
    if let Some(targets)=p.get("targets").and_then(Value::as_array){
     for target in targets{
      if let Some(t_obj)=target.as_object(){for a in t_obj.values(){accessors.insert(required_index(Some(a),"primitive target attribute")?);}}
     }
    }
    jobs.push((*old,primitive));
   }
  }
  if let Some(skins)=g.get("skins").and_then(Value::as_array){
   for skin in skins{
    if let Some(ibm)=skin.get("inverseBindMatrices"){accessors.insert(required_index(Some(ibm),"skin.inverseBindMatrices")?);}
   }
  }
  if let Some(animations)=g.get("animations").and_then(Value::as_array){
   for anim in animations{
    if let Some(samplers)=anim.get("samplers").and_then(Value::as_array){
     for sampler in samplers{
      if let Some(inp)=sampler.get("input"){accessors.insert(required_index(Some(inp),"animation sampler input")?);}
      if let Some(out)=sampler.get("output"){accessors.insert(required_index(Some(out),"animation sampler output")?);}
     }
    }
   }
  }
  let access_map:BTreeMap<usize,usize>=accessors.iter().enumerate().map(|(new,old)|(*old,new)).collect();
  for id in &accessors{accessor_validation::validate(g,bin,*id)?;}
  let mut views=BTreeSet::new();
  for a in &accessors{
   let acc=item(accessor_values,*a,"accessor")?;
   if acc.get("bufferView").is_some(){views.insert(required_index(acc.get("bufferView"),"accessor.bufferView")?);}
   if let Some(sparse)=acc.get("sparse"){
    let ind_bv=required_index(sparse.get("indices").and_then(|i|i.get("bufferView")),"sparse.indices.bufferView")?;
    let val_bv=required_index(sparse.get("values").and_then(|v|v.get("bufferView")),"sparse.values.bufferView")?;
    views.insert(ind_bv);views.insert(val_bv);
   }
  }
  if let Some(images)=g.get("images").and_then(Value::as_array){for image in images{if image.get("bufferView").is_some(){views.insert(required_index(image.get("bufferView"),"image.bufferView")?);}}}
  let view_map:BTreeMap<usize,usize>=views.iter().enumerate().map(|(new,old)|(*old,new)).collect();
  let mut estimated_working_bytes=g_bytes.len().saturating_mul(2).saturating_add(o.threads.saturating_mul(1024*1024));
  for id in &views{estimated_working_bytes=estimated_working_bytes.checked_add(required_index(item(view_values,*id,"bufferView")?.get("byteLength"),"bufferView.byteLength")?).ok_or_else(||invalid("Working set overflow"))?;}
  for (old,primitive) in &jobs{let p=item(values(item(mesh_values,*old,"mesh")?,"primitives")?,*primitive,"primitive")?;let count=primitive_triangles(g,p)?.checked_mul(3).ok_or_else(||invalid("Working set overflow"))?;estimated_working_bytes=estimated_working_bytes.checked_add(count.checked_mul(4).ok_or_else(||invalid("Working set overflow"))?).ok_or_else(||invalid("Working set overflow"))?;}
  estimated_working_bytes=estimated_working_bytes.checked_add(bin.len()).ok_or_else(||invalid("Working set overflow"))?;
  if estimated_working_bytes>o.ram_budget_mb*1024*1024{return Err(CompilerError::new("RAM_ADMISSION_BUDGET_EXCEEDED","Estimated working set exceeds configured budget"))}
  let directory=o.cache.join("native").join(&o.scope).join(&key);fs::create_dir_all(directory.join("pages"))?;fs::create_dir_all(o.cache.join("native").join("objects"))?;let temp=directory.join("source.bin.tmp");let mut writer=BufWriter::new(File::create(&temp)?);let mut offset=0;let mut output_views=Vec::new();for id in &views{check(o)?;let mut v=item(view_values,*id,"bufferView")?.clone();if optional_index(v.get("buffer"),"bufferView.buffer",0)?!=0{return Err(CompilerError::new("UNSUPPORTED_ACCESSOR","Multiple buffers are unsupported"))}let padding=(4-offset%4)%4;writer.write_all(&[0u8;3][..padding])?;offset+=padding;let start=optional_index(v.get("byteOffset"),"bufferView.byteOffset",0)?;let len=required_index(v.get("byteLength"),"bufferView.byteLength")?;let end=start.checked_add(len).ok_or_else(||invalid("bufferView range overflow"))?;writer.write_all(bin.get(start..end).ok_or_else(||CompilerError::new("BUFFER_OUT_OF_BOUNDS","bufferView exceeds binary buffer"))?)?;v["byteOffset"]=json!(offset);offset+=len;output_views.push(v);}writer.flush()?;drop(writer);fs::rename(temp,directory.join("source.bin"))?;
  let import_ms=started.elapsed().as_secs_f64()*1000.;progress(json!({"phase":"import","completed":1,"total":1,"ms":import_ms,"primitives":jobs.len(),"nodes":chosen.len()}));
  let cluster_start=Instant::now();let pool=rayon::ThreadPoolBuilder::new().num_threads(o.threads).build()?;
  // Compact per-page index storage is bounded independently from source size. Metadata is retained.
  let mut primitives:Vec<Value>=pool.install(||jobs.par_iter().map(|(old,primitive)|->Result<Value>{check(o)?;let p=item(values(item(mesh_values,*old,"mesh")?,"primitives")?,*primitive,"primitive")?;if optional_index(p.get("mode"),"primitive.mode",4)?!=4{return Err(CompilerError::new("UNSUPPORTED_PRIMITIVE","Only static triangles are supported"))}
   let positions=accessor(g,bin,required_index(p.get("attributes").and_then(Value::as_object).and_then(|a|a.get("POSITION")),"primitive.attributes.POSITION")?)?;if positions.width!=3||positions.component!=5126{return Err(invalid("POSITION must be float VEC3"));}
   let (index_values,triangle_count)=if p.get("indices").is_some(){
    let ids=accessor(g,bin,required_index(p.get("indices"),"primitive.indices")?)?;
    if ids.width!=1||ids.normalized||![5121,5123,5125].contains(&ids.component){return Err(invalid("indices component must be unsigned SCALAR"));}
    if ids.count==0||ids.count%3!=0{return Err(CompilerError::new("INVALID_TRIANGLES","Index count must be a positive multiple of three"));}
    (ids.collect_u32()?,ids.count/3)
   }else{
    if positions.count==0||positions.count%3!=0{return Err(invalid("Unindexed POSITION count must be a positive multiple of three"));}
    ((0..positions.count as u32).collect(),positions.count/3)
   };
   let pos={let _t=perf::Timer::new(&perf::PHASES.decode);positions.collect_f32()?};
   let topology={let _t=perf::Timer::new(&perf::PHASES.topology);crate::topology::classify_topology(&index_values,positions.count)?};
   let is_skinned_or_morph=p.get("targets").is_some()||skinned_meshes.contains(old)||p.get("attributes").and_then(Value::as_object).map(|a|a.contains_key("JOINTS_0")||a.contains_key("WEIGHTS_0")).unwrap_or(false);
   let material=if let Some(material)=p.get("material"){let id=required_index(Some(material),"primitive.material")?;values(g,"materials")?.get(id)}else{None};
   let unsplit=is_skinned_or_morph||unsplit_material(material);
   let clustered_blend=!unsplit&&material.and_then(|m|m.get("alphaMode")).and_then(Value::as_str)==Some("BLEND");
   let mesh=*mesh_map.get(old).ok_or_else(||invalid("Missing mesh mapping"))?;let mut pages=Vec::new();let mut reused:i32=0;
   let mut page_attributes=Vec::<geometry_page::Attribute>::new();
   if !unsplit{for (name,width,offset,flag) in [("NORMAL",3,12,1),("TEXCOORD_0",2,24,2),("TANGENT",4,32,4),("TEXCOORD_1",2,48,8),("COLOR_0",4,56,16)]{
    if let Some(id)=p.get("attributes").and_then(Value::as_object).and_then(|attributes|attributes.get(name)){
     let a=accessor(g,bin,required_index(Some(id),name)?)?;
     if a.count!=positions.count||(a.width!=width&&!(name=="COLOR_0"&&a.width==3)){return Err(CompilerError::new("INVALID_PAGE_ATTRIBUTE",format!("{name} count or width differs from POSITION")));}
     page_attributes.push(geometry_page::Attribute{offset,width,source_width:a.width,flag,values:a.collect_f32()?});
    }
   }}
   let store_packed=|slice:&[u32]|->Result<(Value,bool)>{
    let (data,flags,vertex_count)=geometry_page::encode(slice,&pos,&page_attributes)?;
    let digest=hash(&data);let name=format!("../../objects/{}.bin",digest);let target=o.cache.join("native").join("objects").join(format!("{}.bin",digest));
    let reused=target.exists()&&hash_file(&target)?==digest;if !reused{store_object(&target,&data)?;}
    Ok((json!({"url":name,"sha256":digest,"bytes":data.len(),"formatVersion":2,"codec":"meshopt","vertexCount":vertex_count,"indexCount":slice.len(),"flags":flags,"uncompressedBytes":vertex_count*geometry_page::STRIDE+slice.len()*2}),reused))
   };
   // Transparent primitives join the DAG too: their draw order is restored at runtime from the
   // recorded source rank, so spatial clustering no longer scrambles the blend order.
   let dag_primitive=!unsplit;
   let mut dag_report=Value::Null;let mut culling_report=Value::Null;let mut structure_report=Value::Null;let mut stream_report=Value::Null;
   if dag_primitive{
    let (dag,groups,tallies)=crate::dag::build_dag_tallied(&pos,&index_values,&||check(o))?;
    if dag.iter().filter(|c|c.level==0).map(|c|c.triangles()).sum::<usize>()!=index_values.len()/3{
     return Err(CompilerError::new("INCOMPLETE_CLUSTER_PARTITION","Level 0 clusters do not cover the source triangles"));
    }
    if triangle_fingerprint(index_values.chunks_exact(3))!=triangle_fingerprint(dag.iter().filter(|c|c.level==0).flat_map(|c|c.indices.chunks_exact(3))){
     return Err(CompilerError::new("INVALID_CLUSTER_PARTITION","Level 0 clusters are not the source triangles"));
    }
    let depth=dag.iter().map(|c|c.level).max().unwrap_or(0);
    let mut level_stats=Vec::new();
    for level in 0..=depth{
     let mut errors:Vec<f64>=Vec::new();let mut triangles=0usize;let mut roots=0usize;
     for cluster in dag.iter().filter(|c|c.level==level){errors.push(cluster.lod_error);triangles+=cluster.triangles();if cluster.is_root(){roots+=1;}}
     if errors.is_empty(){continue;}
     errors.sort_by(f64::total_cmp);
     level_stats.push(json!({"level":level,"clusters":errors.len(),"triangles":triangles,"roots":roots,"errorMin":errors[0],"errorMedian":errors[errors.len()/2],"errorMax":errors[errors.len()-1]}));
    }
    let group_stats:Vec<Value>=tallies.iter().enumerate().map(|(i,tally)|json!({"level":i+1,"reduced":tally.reduced,"tooSmall":tally.too_small,"noCollapse":tally.no_collapse,"borderLost":tally.border_lost,"unusableError":tally.unusable_error})).collect();
    dag_report=json!({"depth":depth,"clusterTriangles":crate::dag::DAG_CLUSTER_TRIANGLES,"groupMin":crate::dag::DAG_GROUP_MIN,"groupMax":crate::dag::DAG_GROUP_MAX,"levels":level_stats,"groups":group_stats});
    // Pages follow the culling order so every hierarchy node owns a contiguous page range.
    let (order,culling)={let _t=perf::Timer::new(&perf::PHASES.culling);crate::dag::build_culling_bvh(&pos,&dag)};
    let base_id=pages.len();
    let mut page_of=vec![0usize;dag.len()];
    for (rank,&slot) in order.iter().enumerate(){page_of[slot]=base_id+rank;}
    // Bundles group clusters of one level that the culling order already placed next to each other.
    // Root clusters come first and form their own bundles, so the coarsest complete cover of the
    // primitive is a handful of pinned requests.
    let mut bundle_order:Vec<usize>=(0..order.len()).collect();
    bundle_order.sort_by_key(|&rank|{let cluster=&dag[order[rank]];(if cluster.is_root(){0u8}else{1u8},cluster.level,rank)});
    let mut bundles:Vec<Vec<usize>>=Vec::new();
    {
     let mut current:Vec<usize>=Vec::new();let mut held=0usize;let mut key=None;
     for &rank in &bundle_order{
      let cluster=&dag[order[rank]];
      let next_key=(cluster.is_root(),cluster.level);
      let size=cluster.indices.len()*4;
      if !current.is_empty()&&(key!=Some(next_key)||held+size>STREAM_BUNDLE_BYTES){bundles.push(std::mem::take(&mut current));held=0;}
      key=Some(next_key);current.push(rank);held+=size;
     }
     if !current.is_empty(){bundles.push(current);}
    }
    let pinned_bundles=bundles.iter().take_while(|bundle|dag[order[bundle[0]]].is_root()).count();
    struct Bundle{url:String,digest:String,bytes:usize,count:usize,pages:Vec<(usize,Value)>,reused:i32}
    let built:Vec<Bundle>=bundles.par_iter().enumerate().map(|(bundle_index,members)|->Result<Bundle>{
     check(o)?;
     let mut payload=Vec::new();
     let mut emitted=Vec::with_capacity(members.len());
     let mut reused=0i32;
     for &rank in members{
      let cluster=&dag[order[rank]];
      let offset=payload.len();
      let mut min=[f64::INFINITY;3];let mut max=[f64::NEG_INFINITY;3];
      {let _t=perf::Timer::new(&perf::PHASES.page_bytes);
       for &id in &cluster.indices{let index=id as usize;if index*3+2>=pos.len(){return Err(invalid("Invalid cluster index"));}payload.extend_from_slice(&id.to_le_bytes());for a in 0..3{let value=pos[index*3+a] as f64;min[a]=min[a].min(value);max[a]=max[a].max(value);}}}
      let bytes=&payload[offset..];
      let digest={let _t=perf::Timer::new(&perf::PHASES.page_hash);hash(bytes)};
      let name=format!("../../objects/{}.bin",digest);let target=o.cache.join("native").join("objects").join(format!("{}.bin",digest));
      {let _t=perf::Timer::new(&perf::PHASES.page_write);if target.exists()&&hash_file(&target)?==digest{reused+=1;}else{store_object(&target,bytes)?;}}
      let (geometry,packed_reused)={let _t=perf::Timer::new(&perf::PHASES.page_packed);store_packed(&cluster.indices)?};if packed_reused{reused+=1;}
      let finite_parent=cluster.parent_error.is_finite();
      emitted.push((base_id+rank,json!({"id":base_id+rank,"url":name,"sha256":digest,"bytes":bytes.len(),"count":cluster.indices.len(),"start":cluster.source_rank as usize*3,"min":min,"max":max,
       "role":if cluster.level==0{"exact"}else{"coarse"},"geometry":geometry,"level":cluster.level,
       "lodError":cluster.lod_error,"sphere":cluster.sphere,
       "parentError":if finite_parent{json!(cluster.parent_error)}else{Value::Null},
       "parentSphere":if finite_parent{json!(cluster.parent_sphere)}else{Value::Null},
       "group":match cluster.group{Some(index)=>json!(index),None=>Value::Null},
       "source":match cluster.source{Some(index)=>json!(index),None=>Value::Null},
       "stream":bundle_index,"streamOffset":offset})));
     }
     let digest={let _t=perf::Timer::new(&perf::PHASES.page_hash);hash(&payload)};
     let target=o.cache.join("native").join("objects").join(format!("{}.bin",digest));
     {let _t=perf::Timer::new(&perf::PHASES.page_write);if !(target.exists()&&hash_file(&target)?==digest){store_object(&target,&payload)?;}}
     Ok(Bundle{url:format!("../../objects/{}.bin",digest),digest,bytes:payload.len(),count:members.len(),pages:emitted,reused})
    }).collect::<Result<Vec<_>>>()?;
    let mut ordered:Vec<Option<Value>>=vec![None;order.len()];
    let mut streams=Vec::with_capacity(built.len());
    for bundle in built{
     reused+=bundle.reused;
     streams.push(json!({"url":bundle.url,"sha256":bundle.digest,"bytes":bundle.bytes,"count":bundle.count}));
     for (id,page) in bundle.pages{ordered[id-base_id]=Some(page);}
    }
    pages.reserve(ordered.len());
    for page in ordered{pages.push(page.ok_or_else(||CompilerError::new("INVALID_CLUSTER_PARTITION","A cluster was not bundled"))?);}
    stream_report=json!({"version":STRUCTURE_VERSION,"pinned":pinned_bundles,"bundleBytes":STREAM_BUNDLE_BYTES,"pages":streams});
    let mut roots:Vec<usize>=dag.iter().enumerate().filter(|(_,cluster)|cluster.is_root()).map(|(slot,_)|page_of[slot]).collect();
    roots.sort_unstable();
    let structure_groups:Vec<Value>=groups.iter().map(|group|json!({
     "level":group.level,"error":group.error,"sphere":group.sphere,
     "children":group.children.iter().map(|&slot|page_of[slot]).collect::<Vec<_>>(),
     "outputs":group.outputs.iter().map(|&slot|page_of[slot]).collect::<Vec<_>>(),
    })).collect();
    structure_report=json!({"version":STRUCTURE_VERSION,"roots":roots,"groups":structure_groups});
    // Flat node array, CULLING_STRIDE numbers per node; -1 marks a subtree holding a root.
    let mut flat=Vec::with_capacity(culling.len()*CULLING_STRIDE);
    for node in &culling{
     for a in 0..3{flat.push(json!(node.min[a]));}
     for a in 0..3{flat.push(json!(node.max[a]));}
     for a in 0..4{flat.push(json!(node.sphere[a]));}
     flat.push(if node.max_parent_error.is_finite(){json!(node.max_parent_error)}else{json!(-1.0)});
     flat.push(json!(node.first_child));flat.push(json!(node.child_count));
     flat.push(json!(node.first_cluster));flat.push(json!(node.cluster_count));
    }
    culling_report=json!({"stride":CULLING_STRIDE,"count":culling.len(),"nodes":flat});
   }
   progress(json!({"phase":"primitive","mesh":mesh,"primitive":primitive,"pages":pages.len()}));Ok(json!({"mesh":mesh,"primitive":primitive,"material":p.get("material").cloned().unwrap_or(Value::Null),"triangles":triangle_count,"pass":if unsplit{"shared-blend"}else if clustered_blend{"clustered-blend"}else{"exact-clusters"},"clusterStrategy":if dag_primitive{json!(DAG_CLUSTER_STRATEGY)}else{Value::Null},"hierarchy":Value::Null,"dag":dag_report,"culling":culling_report,"structure":structure_report,"streams":stream_report,"pages":pages,"reusedPages":reused,"topology":{"triangles":topology.triangles,"edges":{"boundary":topology.boundary_edges,"manifold":topology.manifold_edges,"nonManifold":topology.non_manifold_edges},"vertices":{"interior":topology.interior_vertices,"boundary":topology.boundary_vertices,"locked":topology.locked_vertices,"unused":topology.unused_vertices},"manifold":topology.manifold}}))}).collect::<Result<Vec<_>>>())?;
  let bootstrap_bundles={let _t=perf::Timer::new(&perf::PHASES.page_write);share_bootstrap_bundles(o,&mut primitives)?};
  progress(json!({"phase":"bootstrap","completed":bootstrap_bundles,"total":bootstrap_bundles}));
  let mut source=g.clone();let mut output_meshes=Vec::new();
  for id in &meshes{
   let mut mesh=item(values(&source,"meshes")?,*id,"mesh")?.clone();
   for p in mesh.get_mut("primitives").and_then(Value::as_array_mut).ok_or_else(||invalid("mesh.primitives is required"))?{
    if p.get("indices").is_some(){let old=required_index(p.get("indices"),"primitive.indices")?;p["indices"]=json!(*access_map.get(&old).ok_or_else(||invalid("Missing accessor mapping"))?);}
    for v in p.get_mut("attributes").and_then(Value::as_object_mut).ok_or_else(||invalid("primitive.attributes is required"))?.values_mut(){let old=required_index(Some(v),"primitive attribute")?;*v=json!(*access_map.get(&old).ok_or_else(||invalid("Missing accessor mapping"))?);}
    if let Some(targets)=p.get_mut("targets").and_then(Value::as_array_mut){
     for target in targets{
      if let Some(t_obj)=target.as_object_mut(){for v in t_obj.values_mut(){let old=required_index(Some(v),"primitive target attribute")?;*v=json!(*access_map.get(&old).ok_or_else(||invalid("Missing accessor mapping"))?);}}
     }
    }
   }
   output_meshes.push(mesh);
  }
  source["meshes"]=Value::Array(output_meshes);
  for (i,n) in source.get_mut("nodes").and_then(Value::as_array_mut).ok_or_else(||invalid("nodes array is required"))?.iter_mut().enumerate(){if n.get("mesh").is_some(){if chosen.contains(&i){let old=required_index(n.get("mesh"),"node.mesh")?;n["mesh"]=json!(*mesh_map.get(&old).ok_or_else(||invalid("Missing mesh mapping"))?);}else{n.as_object_mut().ok_or_else(||invalid("node object is required"))?.remove("mesh");}}}
  let mut output_accessors=Vec::new();
  for id in &accessors{
   let mut a=item(values(&source,"accessors")?,*id,"accessor")?.clone();
   if a.get("bufferView").is_some(){let old=required_index(a.get("bufferView"),"accessor.bufferView")?;a["bufferView"]=json!(*view_map.get(&old).ok_or_else(||invalid("Missing bufferView mapping"))?);}
   if let Some(sparse)=a.get_mut("sparse").and_then(Value::as_object_mut){
    if let Some(indices)=sparse.get_mut("indices").and_then(Value::as_object_mut){let old=required_index(indices.get("bufferView"),"sparse.indices.bufferView")?;indices["bufferView"]=json!(*view_map.get(&old).ok_or_else(||invalid("Missing bufferView mapping"))?);}
    if let Some(vals)=sparse.get_mut("values").and_then(Value::as_object_mut){let old=required_index(vals.get("bufferView"),"sparse.values.bufferView")?;vals["bufferView"]=json!(*view_map.get(&old).ok_or_else(||invalid("Missing bufferView mapping"))?);}
   }
   output_accessors.push(a);
  }
  source["accessors"]=Value::Array(output_accessors);
  if let Some(skins)=source.get_mut("skins").and_then(Value::as_array_mut){
   for skin in skins{
    if skin.get("inverseBindMatrices").is_some(){
     let old=required_index(skin.get("inverseBindMatrices"),"skin.inverseBindMatrices")?;
     if let Some(mapped)=access_map.get(&old){skin["inverseBindMatrices"]=json!(*mapped);}
    }
   }
  }
  if let Some(animations)=source.get_mut("animations").and_then(Value::as_array_mut){
   for anim in animations{
    if let Some(samplers)=anim.get_mut("samplers").and_then(Value::as_array_mut){
     for sampler in samplers{
      if let Some(inp)=sampler.get("input"){let old=required_index(Some(inp),"animation sampler input")?;if let Some(mapped)=access_map.get(&old){sampler["input"]=json!(*mapped);}}
      if let Some(out)=sampler.get("output"){let old=required_index(Some(out),"animation sampler output")?;if let Some(mapped)=access_map.get(&old){sampler["output"]=json!(*mapped);}}
     }
    }
   }
  }
  source["bufferViews"]=json!(output_views);source["buffers"]=json!([{"uri":"source.bin","byteLength":offset}]);rewrite_images(&mut source,&o.resource_base,&view_map)?;
  atomic(&directory.join("source.gltf"),&serde_json::to_vec(&source)?)?;
  let mut autonomous_scene=Value::Null;
  if !primitives.is_empty()&&primitives.iter().all(|primitive|primitive["pass"]=="exact-clusters"){
   let mut scene=source.clone();let mut scene_bytes=vec![0u8;44];
   for (i,value) in [0u16,1,2].iter().enumerate(){scene_bytes[36+i*2..38+i*2].copy_from_slice(&value.to_le_bytes());}
   let mut scene_views=vec![json!({"buffer":0,"byteOffset":0,"byteLength":36}),json!({"buffer":0,"byteOffset":36,"byteLength":6})];
   let mut source_binary=File::open(directory.join("source.bin"))?;
   if let Some(images)=scene.get_mut("images").and_then(Value::as_array_mut){for image in images{
    if let Some(old)=image.get("bufferView"){let id=required_index(Some(old),"image.bufferView")?;let view=item(&output_views,id,"image bufferView")?;
     let start=required_index(view.get("byteOffset"),"image.byteOffset")?;let length=required_index(view.get("byteLength"),"image.byteLength")?;
     while scene_bytes.len()%4!=0{scene_bytes.push(0);}let at=scene_bytes.len();let end=at.checked_add(length).ok_or_else(||invalid("Image view too large"))?;scene_bytes.resize(end,0);
     source_binary.seek(SeekFrom::Start(start as u64))?;source_binary.read_exact(&mut scene_bytes[at..end])?;
     image["bufferView"]=json!(scene_views.len());scene_views.push(json!({"buffer":0,"byteOffset":at,"byteLength":length}));
    }
   }}
   scene["buffers"]=json!([{"uri":"scene.bin","byteLength":scene_bytes.len()}]);scene["bufferViews"]=Value::Array(scene_views);
   scene["accessors"]=json!([{"bufferView":0,"componentType":5126,"type":"VEC3","count":3,"min":[0,0,0],"max":[0,0,0]},{"bufferView":1,"componentType":5123,"type":"SCALAR","count":3}]);
   if let Some(meshes)=scene.get_mut("meshes").and_then(Value::as_array_mut){for mesh in meshes{if let Some(parts)=mesh.get_mut("primitives").and_then(Value::as_array_mut){for part in parts{let material=part.get("material").cloned();*part=json!({"mode":4,"attributes":{"POSITION":0},"indices":1});if let Some(material)=material{part["material"]=material;}}}}}
   if let Some(object)=scene.as_object_mut(){object.remove("skins");object.remove("animations");}
   if let Some(nodes)=scene.get_mut("nodes").and_then(Value::as_array_mut){for node in nodes{if let Some(object)=node.as_object_mut(){object.remove("skin");object.remove("weights");}}}
   atomic(&directory.join("scene.bin"),&scene_bytes)?;atomic(&directory.join("scene.gltf"),&serde_json::to_vec(&scene)?)?;autonomous_scene=json!("scene.gltf");
  }
  let mut unsupported=vec!["hard RSS enforcement","N-API binding"];if o.simplification=="none"{unsupported.insert(0,"simplification");}
  let cache_format=if primitives.iter().any(|primitive|primitive["pass"]=="clustered-blend"){CLUSTERED_BLEND_FORMAT_VERSION}else{FORMAT_VERSION};
  let result=json!({"schema":cache_format,"formatVersion":cache_format,"compilerVersion":COMPILER_VERSION,"errorModel":DAG_ERROR_MODEL,"status":"ready","key":key,"scope":o.scope,"clusterStrategy":DAG_CLUSTER_STRATEGY,"selectedTriangles":selected_triangles,"sourceTriangles":manifest["runtime"]["trianglesAcrossNodes"],"selectedNodes":chosen,"totalNodes":manifest["runtime"]["meshNodes"],"autonomousScene":autonomous_scene,"primitives":primitives,"simplification":o.simplification!="none","gpuDriven":false,"metrics":{"importMs":import_ms,"clusterHierarchyPagesMs":cluster_start.elapsed().as_secs_f64()*1000.,"wallMs":started.elapsed().as_secs_f64()*1000.,"sourceMappedBytes":bin.len(),"outputGeometryBytes":offset,"phases":perf::PHASES.report(),"threads":o.threads,"ramBudgetMb":o.ram_budget_mb,"admissionEstimatedBytes":estimated_working_bytes,"peakRssBytes":null,"cpuMs":null,"diskBytesRead":null},"unsupported":unsupported});
 // The manifest travels as a small JSON plus a binary of typed-array columns: a reader maps the
 // columns instead of tokenizing tens of megabytes before its first frame.
 {let _t=perf::Timer::new(&perf::PHASES.manifest);
  let templates=manifest_binary::Templates{binary:MANIFEST_BINARY_FILE,page:"../../objects/{sha}.bin",geometry:"../../objects/{sha}.bin",bundle:"../../objects/{sha}.bin"};
  let (mut slim,binary)=manifest_binary::split(&result,&templates)?;
  slim["binary"]["sha256"]=json!(hash(&binary));
  atomic(&directory.join(MANIFEST_BINARY_FILE),&binary)?;
  atomic(&directory.join("clusters.json"),&serde_json::to_vec(&slim)?)?;}
 atomic(&o.cache.join("native").join(&o.scope).join("manifest.json"),&serde_json::to_vec(&json!({"status":"ready","formatVersion":cache_format,"compiler":"native-rust","key":key,"scope":o.scope,"url":format!("{}/clusters.json",key)}))?)?;progress(json!({"phase":"complete","completed":1,"total":1}));Ok(result)
}
#[cfg(test)] mod tests {use super::*;use std::time::{SystemTime,UNIX_EPOCH};use std::sync::atomic::AtomicU64;
 static NEXT_FIXTURE_ID:AtomicU64=AtomicU64::new(0);
 fn fixture()->(PathBuf,Options){fixture_named("mesh.gltf","mesh.bin")}
 fn fixture_named(gltf_name:&str,bin_name:&str)->(PathBuf,Options){let root=std::env::temp_dir().join(format!("web-geometry-{}-{}-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos(),NEXT_FIXTURE_ID.fetch_add(1,Ordering::Relaxed),gltf_name));let source=root.join("source");let cache=root.join("cache");fs::create_dir_all(&source).expect("source");let mut bin=Vec::new();for value in [0f32,0.,0.,1.,0.,0.,0.,1.,0.]{bin.extend_from_slice(&value.to_le_bytes())}for value in [0u32,1,2]{bin.extend_from_slice(&value.to_le_bytes())}let gltf=json!({"asset":{"version":"2.0"},"buffers":[{"uri":bin_name,"byteLength":48}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36},{"buffer":0,"byteOffset":36,"byteLength":12}],"accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":3},{"bufferView":1,"componentType":5125,"type":"SCALAR","count":3}],"meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],"nodes":[{"mesh":0},{"mesh":0}],"materials":[],"images":[]});let gltf_bytes=serde_json::to_vec(&gltf).expect("gltf");fs::write(source.join(gltf_name),&gltf_bytes).expect("gltf write");fs::write(source.join(bin_name),&bin).expect("bin write");fs::write(source.join("manifest.json"),serde_json::to_vec(&json!({"status":"ready","formatVersion":FORMAT_VERSION,"runtime":{"file":gltf_name,"sha256":hash(&gltf_bytes),"sidecars":[{"file":bin_name,"sha256":hash(&bin)}],"trianglesAcrossNodes":2,"meshNodes":2}})).expect("manifest")).expect("manifest write");let options=Options{source,cache,resource_base:"/assets/".into(),scope:"slice".into(),triangle_budget:1,threads:1,ram_budget_mb:64,simplification:"none".into(),cancelled:Arc::new(AtomicBool::new(false))};(root,options)}
 #[test] fn parse_accepts_five_to_eight_args(){let cancelled=Arc::new(AtomicBool::new(false));let five=parse_compiler_args(&["s".into(),"c".into(),"slice".into(),"12".into(),"/assets/".into()],cancelled.clone()).expect("five");assert_eq!(five.threads,2);assert_eq!(five.ram_budget_mb,256);assert_eq!(five.simplification,"none");let seven=parse_compiler_args(&["s".into(),"c".into(),"full".into(),"12".into(),"4".into(),"128".into(),"/a/".into()],cancelled.clone()).expect("seven");assert_eq!(seven.threads,4);assert_eq!(seven.ram_budget_mb,128);let eight=parse_compiler_args(&["s".into(),"c".into(),"full".into(),"12".into(),"4".into(),"128".into(),"/a/".into(),"qem-endpoints".into()],cancelled).expect("eight");assert_eq!(eight.simplification,"qem-endpoints");assert!(parse_compiler_args(&["s".into(),"c".into(),"full".into(),"12".into(),"4".into(),"128".into(),"/a/".into(),"bicubic".into()],Arc::new(AtomicBool::new(false))).is_err());assert!(parse_compiler_args(&["s".into(),"c".into(),"full".into(),"12".into(),"4".into(),"128".into(),"/a/".into(),"qem-endpoints".into(),"dag".into()],Arc::new(AtomicBool::new(false))).is_err());}
 #[test] fn malformed_accessor_is_rejected(){let g=json!({"accessors":[{"bufferView":0,"componentType":5125,"type":"SCALAR","count":1}],"bufferViews":[{"buffer":0,"byteLength":4}]});assert!(accessor(&g,&[],0).is_err());}
 #[test] fn accessor_cannot_read_past_its_buffer_view(){let g=json!({"accessors":[{"bufferView":0,"componentType":5125,"type":"SCALAR","count":2}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":4}]});assert!(accessor(&g,&[0u8;8],0).is_err());}
 #[test] fn compile_rejects_local_accessor_overflow_before_publication(){let(root,options)=fixture_named("mesh.gltf","mesh.bin");let gltf_path=options.source.join("mesh.gltf");let mut gltf:Value=serde_json::from_slice(&fs::read(&gltf_path).expect("read")).expect("json");gltf["bufferViews"][0]["byteLength"]=json!(24);let bytes=serde_json::to_vec(&gltf).expect("encode");fs::write(&gltf_path,&bytes).expect("write");let manifest_path=options.source.join("manifest.json");let mut manifest:Value=serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");manifest["runtime"]["sha256"]=json!(hash(&bytes));fs::write(&manifest_path,serde_json::to_vec(&manifest).expect("encode")).expect("write");assert_eq!(compile(&options,|_|{}).expect_err("accessor").code,"INVALID_GLTF");assert!(!options.cache.join("native/slice/manifest.json").exists());fs::remove_dir_all(root).expect("cleanup");}
 #[test] fn compile_writes_pages_and_namespaced_pointer(){let(root,options)=fixture();let result=compile(&options,|_|{}).expect("compile");assert_eq!(result["selectedTriangles"],1);assert!(options.cache.join("native/slice/manifest.json").exists());let key=result["key"].as_str().expect("key");let directory=options.cache.join("native/slice").join(key);assert!(directory.join("source.gltf").exists());assert!(directory.join("scene.gltf").exists());let geometry=&result["primitives"][0]["pages"][0]["geometry"];assert_eq!(geometry["formatVersion"],2);let page=fs::read(directory.join(geometry["url"].as_str().expect("page URL"))).expect("autonomous geometry page");let index_bytes=u32::from_le_bytes(page[24..28].try_into().expect("index bytes")) as usize;let indices:Vec<u16>=meshopt::decode_index_buffer(&page[32..32+index_bytes],3).expect("decode");assert_eq!(indices,[0,1,2]);fs::remove_dir_all(root).expect("cleanup");}
 #[test] fn compile_rejects_cancel_hash_and_format(){let(root,options)=fixture();options.cancelled.store(true,Ordering::Relaxed);assert_eq!(compile(&options,|_|{}).expect_err("cancel").code,"CANCELLED");options.cancelled.store(false,Ordering::Relaxed);fs::write(options.source.join("mesh.bin"),[0u8;48]).expect("corrupt");assert_eq!(compile(&options,|_|{}).expect_err("hash").code,"SOURCE_HASH_MISMATCH");let manifest_path=options.source.join("manifest.json");let mut manifest:Value=serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");manifest["formatVersion"]=json!(999);fs::write(&manifest_path,serde_json::to_vec(&manifest).expect("encode")).expect("write");assert_eq!(compile(&options,|_|{}).expect_err("format").code,"UNSUPPORTED_FORMAT");fs::remove_dir_all(root).expect("cleanup");}
 #[test] fn compile_indexes_unindexed_triangles(){let(root,options)=fixture();let gltf_path=options.source.join("mesh.gltf");let mut gltf:Value=serde_json::from_slice(&fs::read(&gltf_path).expect("read")).expect("json");gltf["meshes"][0]["primitives"][0].as_object_mut().expect("primitive").remove("indices");let gltf_bytes=serde_json::to_vec(&gltf).expect("encode");fs::write(&gltf_path,&gltf_bytes).expect("write");let manifest_path=options.source.join("manifest.json");let mut manifest:Value=serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");manifest["runtime"]["sha256"]=json!(hash(&gltf_bytes));fs::write(&manifest_path,serde_json::to_vec(&manifest).expect("encode")).expect("write");let result=compile(&options,|_|{}).expect("compile");assert_eq!(result["selectedTriangles"],1);assert_eq!(result["primitives"][0]["pages"][0]["count"],3);fs::remove_dir_all(root).expect("cleanup");}
 #[test] fn compile_reads_named_runtime_file(){let(root,options)=fixture_named("cube.gltf","cube.bin");let result=compile(&options,|_|{}).expect("compile");assert_eq!(result["selectedTriangles"],1);assert!(options.cache.join("native/slice/manifest.json").exists());fs::remove_dir_all(root).expect("cleanup");}
 #[test] fn compile_rejects_unsafe_runtime_file(){let(root,options)=fixture_named("mesh.gltf","mesh.bin");let manifest_path=options.source.join("manifest.json");let mut manifest:Value=serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");manifest["runtime"]["file"]=json!("../mesh.gltf");fs::write(&manifest_path,serde_json::to_vec(&manifest).expect("encode")).expect("write");assert_eq!(compile(&options,|_|{}).expect_err("unsafe").code,"INVALID_GLTF");fs::remove_dir_all(root).expect("cleanup");}
 fn cube_fixture()->(PathBuf,Options){
  let root=std::env::temp_dir().join(format!("web-geometry-cube-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos()));
  let source=root.join("source");let cache=root.join("cache");fs::create_dir_all(&source).expect("source");
  let mut bin=Vec::new();
  for value in [0f32,0.,0.,1.,0.,0.,1.,1.,0.,0.,1.,0.,0.,0.,1.,1.,0.,1.,1.,1.,1.,0.,1.,1.]{bin.extend_from_slice(&value.to_le_bytes());}
  for value in [0u32,1,2,0,2,3,4,6,5,4,7,6,0,4,5,0,5,1,3,2,6,3,6,7,1,5,6,1,6,2,0,3,7,0,7,4]{bin.extend_from_slice(&value.to_le_bytes());}
  let gltf=json!({"asset":{"version":"2.0"},"buffers":[{"uri":"cube.bin","byteLength":bin.len()}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":96},{"buffer":0,"byteOffset":96,"byteLength":144}],"accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":8},{"bufferView":1,"componentType":5125,"type":"SCALAR","count":36}],"meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],"nodes":[{"mesh":0}],"materials":[],"images":[]});
  let gltf_bytes=serde_json::to_vec(&gltf).expect("gltf");
  fs::write(source.join("cube.gltf"),&gltf_bytes).expect("gltf write");fs::write(source.join("cube.bin"),&bin).expect("bin write");
  fs::write(source.join("manifest.json"),serde_json::to_vec(&json!({"status":"ready","formatVersion":FORMAT_VERSION,"runtime":{"file":"cube.gltf","sha256":hash(&gltf_bytes),"sidecars":[{"file":"cube.bin","sha256":hash(&bin)}],"trianglesAcrossNodes":12,"meshNodes":1}})).expect("manifest")).expect("manifest write");
  let options=Options{source,cache,resource_base:"/assets/".into(),scope:"full".into(),triangle_budget:150000,threads:1,ram_budget_mb:64,simplification:"qem-endpoints".into(),cancelled:Arc::new(AtomicBool::new(false))};
  (root,options)
 }
 #[test] fn compile_dag_emits_a_flat_per_cluster_cut(){
  let (root,options)=grid_fixture_displaced(100,100,3.0);
  let result=compile(&options,|_|{}).expect("compile");
  assert_eq!(result["errorModel"],DAG_ERROR_MODEL);
  assert_eq!(result["clusterStrategy"],DAG_CLUSTER_STRATEGY);
  let primitive=&result["primitives"][0];
  assert_eq!(primitive["clusterStrategy"],DAG_CLUSTER_STRATEGY);
  assert!(primitive["hierarchy"].is_null(),"the DAG cut needs no hierarchy tree");
  let depth=primitive["dag"]["depth"].as_u64().expect("depth");
  assert!(depth>=2,"a 20 000 triangle grid must coarsen more than once, got depth {depth}");
  let pages=primitive["pages"].as_array().expect("pages");
  let mut exact_indices=0usize;let mut roots=0usize;let mut coarse=0usize;
  for page in pages{
   let level=page["level"].as_u64().expect("level");
   let lod=page["lodError"].as_f64().expect("lodError");
   let sphere=page["sphere"].as_array().expect("sphere");
   assert_eq!(sphere.len(),4);
   assert!(sphere[3].as_f64().expect("radius")>=0.0);
   assert!(lod>=0.0);
   if level==0{assert_eq!(page["role"],"exact");assert_eq!(lod,0.0);exact_indices+=page["count"].as_u64().expect("count") as usize;}
   else{assert_eq!(page["role"],"coarse");assert!(lod>0.0);coarse+=1;}
   assert!(page["count"].as_u64().expect("count")<=(crate::dag::DAG_CLUSTER_TRIANGLES*3) as u64);
   match page["parentError"].as_f64(){
    Some(parent)=>{
     assert!(parent>=lod,"parent error {parent} below LOD error {lod}");
     let parent_sphere=page["parentSphere"].as_array().expect("parentSphere");
     let centre=|v:&Vec<Value>,i:usize|v[i].as_f64().expect("coordinate");
     let distance=((centre(sphere,0)-centre(parent_sphere,0)).powi(2)+(centre(sphere,1)-centre(parent_sphere,1)).powi(2)+(centre(sphere,2)-centre(parent_sphere,2)).powi(2)).sqrt();
     assert!(distance+centre(sphere,3)<=centre(parent_sphere,3)+1e-6,"parent bounds must enclose the cluster bounds");
    }
    None=>{assert!(page["parentSphere"].is_null());roots+=1;}
   }
  }
  assert_eq!(exact_indices,20000*3,"level 0 pages must cover the source index buffer once");
  assert!(coarse>0);assert!(roots>0);
  // The culling hierarchy must own every page exactly once and bound it.
  let culling=&primitive["culling"];
  assert_eq!(culling["stride"],CULLING_STRIDE);
  let count=culling["count"].as_u64().expect("count") as usize;
  let nodes=culling["nodes"].as_array().expect("nodes");
  assert_eq!(nodes.len(),count*CULLING_STRIDE);
  assert!(count>1,"a 20 000 triangle grid must need interior nodes");
  let number=|index:usize|nodes[index].as_f64().expect("culling number");
  let mut covered=vec![0usize;pages.len()];
  for node in 0..count{
   let base=node*CULLING_STRIDE;
   let children=number(base+12) as usize;
   let page_count=number(base+14) as usize;
   if children>0{assert_eq!(page_count,0);assert!(number(base+11) as usize+children<=count);continue;}
   let first=number(base+13) as usize;
   assert!(page_count>0&&first+page_count<=pages.len());
   for id in first..first+page_count{
    covered[id]+=1;
    for axis in 0..3{
     assert!(pages[id]["min"][axis].as_f64().expect("min")>=number(base+axis)-1e-6,"page outside its node box");
     assert!(pages[id]["max"][axis].as_f64().expect("max")<=number(base+3+axis)+1e-6,"page outside its node box");
    }
    let parent=pages[id]["parentError"].as_f64();
    let bound=number(base+10);
    assert!(bound<0.0||parent.map(|value|value<=bound+1e-9).unwrap_or(false),"node error bound below a page it owns");
   }
  }
  assert!(covered.iter().all(|&n|n==1),"every page belongs to exactly one culling leaf");
  fs::remove_dir_all(root).expect("cleanup");
 }
 #[test] fn compile_dag_bundles_clusters_for_streaming_and_names_their_group(){
  let (root,options)=grid_fixture_displaced(100,100,3.0);
  let result=compile(&options,|_|{}).expect("compile");
  let primitive=&result["primitives"][0];
  let directory=options.cache.join("native/full").join(result["key"].as_str().expect("key"));
  let pages=primitive["pages"].as_array().expect("pages");
  let streams=&primitive["streams"];
  assert_eq!(streams["version"],STRUCTURE_VERSION);
  let bundles=streams["pages"].as_array().expect("bundles");
  assert!(bundles.len()>1,"a 20 000 triangle grid must need several bundles");
  assert!(bundles.len()*30<pages.len(),"a bundle must carry dozens of clusters");
  let pinned=streams["pinned"].as_u64().expect("pinned") as usize;
  assert!(pinned>=1&&pinned<=bundles.len());
  // Every page sits in exactly one bundle, at the recorded offset, and bundles stay homogeneous.
  let mut members:Vec<Vec<usize>>=vec![Vec::new();bundles.len()];
  for (id,page) in pages.iter().enumerate(){
   let bundle=page["stream"].as_u64().expect("stream") as usize;
   assert!(bundle<bundles.len());
   members[bundle].push(id);
  }
  assert_eq!(members.iter().map(Vec::len).sum::<usize>(),pages.len());
  for (index,bundle) in bundles.iter().enumerate(){
   assert!(!members[index].is_empty());
   let level=pages[members[index][0]]["level"].clone();
   let is_root=pages[members[index][0]]["parentError"].is_null();
   assert_eq!(index<pinned,is_root,"pinned bundles are exactly the ones holding the coarsest cover");
   let payload=fs::read(directory.join(bundle["url"].as_str().expect("bundle URL"))).expect("bundle");
   assert_eq!(payload.len() as u64,bundle["bytes"].as_u64().expect("bytes"));
   assert_eq!(bundle["count"].as_u64().expect("count") as usize,members[index].len());
   let mut covered=0usize;
   for &id in &members[index]{
    assert_eq!(pages[id]["level"],level,"a bundle holds one level");
    assert_eq!(pages[id]["parentError"].is_null(),is_root);
    let offset=pages[id]["streamOffset"].as_u64().expect("offset") as usize;
    let length=pages[id]["count"].as_u64().expect("count") as usize*4;
    let single=fs::read(directory.join(pages[id]["url"].as_str().expect("page URL"))).expect("page");
    assert_eq!(single.len(),length);
    assert_eq!(&payload[offset..offset+length],&single[..],"a cluster must be readable at its offset in the bundle");
    covered+=length;
   }
   assert_eq!(covered,payload.len(),"a bundle is exactly its clusters");
  }
  // The structure links every cluster to the group that replaces it and lists the coarse cover.
  let structure=&primitive["structure"];
  assert_eq!(structure["version"],STRUCTURE_VERSION);
  let roots=structure["roots"].as_array().expect("roots");
  assert!(!roots.is_empty());
  for entry in roots{assert!(pages[entry.as_u64().expect("root id") as usize]["parentError"].is_null());}
  let groups=structure["groups"].as_array().expect("groups");
  assert!(!groups.is_empty());
  let mut owned=vec![0usize;pages.len()];
  for (index,group) in groups.iter().enumerate(){
   let children=group["children"].as_array().expect("children");
   let outputs=group["outputs"].as_array().expect("outputs");
   assert!(!children.is_empty()&&!outputs.is_empty());
   for child in children{
    let id=child.as_u64().expect("child id") as usize;owned[id]+=1;
    assert_eq!(pages[id]["group"].as_u64().expect("group") as usize,index);
    assert_eq!(pages[id]["parentError"],group["error"]);
    assert_eq!(pages[id]["parentSphere"],group["sphere"]);
   }
   for output in outputs{
    let id=output.as_u64().expect("output id") as usize;
    assert_eq!(pages[id]["lodError"],group["error"]);
    assert_eq!(pages[id]["sphere"],group["sphere"]);
    assert_eq!(pages[id]["source"].as_u64().expect("source") as usize,index);
   }
  }
  for (id,page) in pages.iter().enumerate(){
   assert_eq!(owned[id],if page["parentError"].is_null(){0}else{1});
   assert_eq!(page["source"].is_null(),page["level"]==0,"only level 0 has no producing group");
  }
  fs::remove_dir_all(root).expect("cleanup");
 }
 #[test] fn compile_dag_covers_transparent_primitives_and_records_their_source_rank(){
  let (root,options)=grid_fixture_displaced(80,80,3.0);
  let gltf_path=options.source.join("grid.gltf");
  let mut gltf:Value=serde_json::from_slice(&fs::read(&gltf_path).expect("read")).expect("json");
  let material=json!({"alphaMode":"BLEND","doubleSided":true,"pbrMetallicRoughness":{"baseColorFactor":[0.2,0.8,0.3,0.45]}});
  gltf["materials"]=json!([material.clone()]);gltf["meshes"][0]["primitives"][0]["material"]=json!(0);
  let gltf_bytes=serde_json::to_vec(&gltf).expect("encode");fs::write(&gltf_path,&gltf_bytes).expect("write");
  fs::remove_file(options.source.join("manifest.json")).expect("direct source");
  let result=compile(&options,|_|{}).expect("compile");
  let primitive=&result["primitives"][0];
  assert_eq!(primitive["pass"],"clustered-blend","the material stays blended, it is never turned into a mask");
  assert_eq!(primitive["clusterStrategy"],DAG_CLUSTER_STRATEGY,"a transparent primitive now gets its own DAG");
  let directory=options.cache.join("native/full").join(result["key"].as_str().expect("key"));
  let source:Value=serde_json::from_slice(&fs::read(directory.join("source.gltf")).expect("source")).expect("json");
  assert_eq!(source["materials"][0],material);
  let pages=primitive["pages"].as_array().expect("pages");
  let exact:Vec<&Value>=pages.iter().filter(|page|page["role"]=="exact").collect();
  assert_eq!(exact.iter().map(|page|page["count"].as_u64().expect("count")).sum::<u64>(),80*80*2*3);
  // Source ranks must span the index buffer so the runtime can restore a blend order.
  let mut starts:Vec<u64>=exact.iter().map(|page|page["start"].as_u64().expect("start")).collect();
  starts.sort_unstable();
  assert_eq!(starts[0],0);
  assert!(starts.last().copied().expect("start")>0);
  assert!(starts.windows(2).all(|pair|pair[0]<=pair[1]));
  assert!(starts.iter().collect::<std::collections::BTreeSet<_>>().len()>starts.len()/2,"source ranks must discriminate pages");
  fs::remove_dir_all(root).expect("cleanup");
 }
 /// Planar at amplitude zero; a curved sheet otherwise, so simplification has a real error to report.
 fn grid_fixture_displaced(nx:usize,ny:usize,amplitude:f32)->(PathBuf,Options){
  let root=std::env::temp_dir().join(format!("web-geometry-grid-{}-{}",std::process::id(),SystemTime::now().duration_since(UNIX_EPOCH).expect("clock").as_nanos()));
  let source=root.join("source");let cache=root.join("cache");fs::create_dir_all(&source).expect("source");
  let mut positions=Vec::new();
  for y in 0..=ny{for x in 0..=nx{positions.extend([x as f32,y as f32,(x as f32*0.31).sin()*(y as f32*0.27).cos()*amplitude]);}}
  let mut indices=Vec::new();let width=(nx+1) as u32;
  for y in 0..ny as u32{for x in 0..nx as u32{let i=y*width+x;indices.extend([i,i+1,i+width,i+1,i+1+width,i+width]);}}
  let mut bin=Vec::new();
  for value in &positions{bin.extend_from_slice(&value.to_le_bytes());}
  for value in &indices{bin.extend_from_slice(&value.to_le_bytes());}
  let pos_bytes=positions.len()*4;let index_bytes=indices.len()*4;
  let gltf=json!({"asset":{"version":"2.0"},"buffers":[{"uri":"grid.bin","byteLength":bin.len()}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":pos_bytes},{"buffer":0,"byteOffset":pos_bytes,"byteLength":index_bytes}],"accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":positions.len()/3},{"bufferView":1,"componentType":5125,"type":"SCALAR","count":indices.len()}],"meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],"nodes":[{"mesh":0}],"materials":[],"images":[]});
  let gltf_bytes=serde_json::to_vec(&gltf).expect("gltf");
  fs::write(source.join("grid.gltf"),&gltf_bytes).expect("gltf");fs::write(source.join("grid.bin"),&bin).expect("bin");
  fs::write(source.join("manifest.json"),serde_json::to_vec(&json!({"status":"ready","formatVersion":FORMAT_VERSION,"runtime":{"file":"grid.gltf","sha256":hash(&gltf_bytes),"sidecars":[{"file":"grid.bin","sha256":hash(&bin)}],"trianglesAcrossNodes":indices.len()/3,"meshNodes":1}})).expect("manifest")).expect("manifest write");
  let options=Options{source,cache,resource_base:"/assets/".into(),scope:"full".into(),triangle_budget:150000,threads:1,ram_budget_mb:64,simplification:"qem-endpoints".into(),cancelled:Arc::new(AtomicBool::new(false))};
  (root,options)
 }
 fn encode_glb(gltf:&Value,bin:&[u8])->Vec<u8>{
  let mut json=serde_json::to_vec(gltf).expect("json");
  while json.len()%4!=0{json.push(b' ');}
  let mut blob=bin.to_vec();
  while blob.len()%4!=0{blob.push(0);}
  let total=12+8+json.len()+8+blob.len();
  let mut out=Vec::with_capacity(total);
  out.extend_from_slice(&0x46546C67u32.to_le_bytes());
  out.extend_from_slice(&2u32.to_le_bytes());
  out.extend_from_slice(&(total as u32).to_le_bytes());
  out.extend_from_slice(&(json.len() as u32).to_le_bytes());
  out.extend_from_slice(&0x4E4F534Au32.to_le_bytes());
  out.extend_from_slice(&json);
  out.extend_from_slice(&(blob.len() as u32).to_le_bytes());
  out.extend_from_slice(&0x004E4942u32.to_le_bytes());
  out.extend_from_slice(&blob);
  out
 }
 #[test] fn compile_omits_images_when_the_gltf_has_none(){
  let(root,options)=fixture();
  let gltf_path=options.source.join("mesh.gltf");
  let mut gltf:Value=serde_json::from_slice(&fs::read(&gltf_path).expect("read")).expect("json");
  gltf.as_object_mut().expect("object").remove("images");
  let gltf_bytes=serde_json::to_vec(&gltf).expect("encode");
  fs::write(&gltf_path,&gltf_bytes).expect("write");
  let manifest_path=options.source.join("manifest.json");
  let mut manifest:Value=serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");
  manifest["runtime"]["sha256"]=json!(hash(&gltf_bytes));
  fs::write(&manifest_path,serde_json::to_vec(&manifest).expect("encode")).expect("write");
  let result=compile(&options,|_|{}).expect("compile");
  let key=result["key"].as_str().expect("key");
  let written:Value=serde_json::from_slice(&fs::read(options.cache.join("native/slice").join(key).join("source.gltf")).expect("source")).expect("json");
  assert!(written.get("images").is_none()||written["images"].as_array().map(|a|a.is_empty()).unwrap_or(false));
  fs::remove_dir_all(root).expect("cleanup");
 }
 #[test] fn compile_keeps_buffer_view_images_without_uri(){
  let(root,options)=fixture();
  let mut bin=fs::read(options.source.join("mesh.bin")).expect("bin");
  let image_offset=bin.len();
  bin.extend_from_slice(&[137,80,78,71,13,10,26,10]);
  fs::write(options.source.join("mesh.bin"),&bin).expect("bin write");
  let gltf_path=options.source.join("mesh.gltf");
  let mut gltf:Value=serde_json::from_slice(&fs::read(&gltf_path).expect("read")).expect("json");
  gltf["buffers"][0]["byteLength"]=json!(bin.len());
  gltf["bufferViews"].as_array_mut().expect("views").push(json!({"buffer":0,"byteOffset":image_offset,"byteLength":8}));
  gltf["images"]=json!([{"bufferView":2,"mimeType":"image/png"}]);
  let gltf_bytes=serde_json::to_vec(&gltf).expect("encode");
  fs::write(&gltf_path,&gltf_bytes).expect("write");
  let manifest_path=options.source.join("manifest.json");
  let mut manifest:Value=serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");
  manifest["runtime"]["sha256"]=json!(hash(&gltf_bytes));
  manifest["runtime"]["sidecars"]=json!([{"file":"mesh.bin","sha256":hash(&bin)}]);
  fs::write(&manifest_path,serde_json::to_vec(&manifest).expect("encode")).expect("write");
  let result=compile(&options,|_|{}).expect("compile");
  let key=result["key"].as_str().expect("key");
  let written:Value=serde_json::from_slice(&fs::read(options.cache.join("native/slice").join(key).join("source.gltf")).expect("source")).expect("json");
  assert!(written["images"][0].get("uri").is_none());
  assert_eq!(written["images"][0]["bufferView"],2);
  assert_eq!(written["images"][0]["mimeType"],"image/png");
  fs::remove_dir_all(root).expect("cleanup");
 }
 #[test] fn compile_without_manifest_discovers_the_gltf(){
  let(root,options)=fixture();
  fs::remove_file(options.source.join("manifest.json")).expect("manifest");
  let result=compile(&options,|_|{}).expect("compile");
  assert_eq!(result["selectedTriangles"],1);
  fs::remove_dir_all(root).expect("cleanup");
 }
 #[test] fn compile_accepts_a_gltf_file_path(){
  let(root,mut options)=fixture();
  fs::remove_file(options.source.join("manifest.json")).expect("manifest");
  options.source=options.source.join("mesh.gltf");
  let result=compile(&options,|_|{}).expect("compile");
  assert_eq!(result["selectedTriangles"],1);
  fs::remove_dir_all(root).expect("cleanup");
 }
 #[test] fn compile_accepts_glb_without_manifest(){
  let(root,options)=fixture();
  let mut gltf:Value=serde_json::from_slice(&fs::read(options.source.join("mesh.gltf")).expect("read")).expect("json");
  let bin=fs::read(options.source.join("mesh.bin")).expect("bin");
  gltf["buffers"][0].as_object_mut().expect("buffer").remove("uri");
  gltf["buffers"][0]["byteLength"]=json!(bin.len());
  let glb=encode_glb(&gltf,&bin);
  fs::remove_dir_all(&options.source).expect("clear");
  fs::create_dir_all(&options.source).expect("source");
  fs::write(options.source.join("mesh.glb"),&glb).expect("glb");
  let result=compile(&options,|_|{}).expect("compile");
  assert_eq!(result["selectedTriangles"],1);
  fs::remove_dir_all(root).expect("cleanup");
 }
 #[test] fn compile_leaves_transmission_unsplit(){
  let(root,options)=fixture();
  let gltf_path=options.source.join("mesh.gltf");
  let mut gltf:Value=serde_json::from_slice(&fs::read(&gltf_path).expect("read")).expect("json");
  gltf["materials"]=json!([{"alphaMode":"BLEND","extensions":{"KHR_materials_transmission":{"transmissionFactor":1.0},"KHR_materials_volume":{"thicknessFactor":0.02}}}]);
  gltf["meshes"][0]["primitives"][0]["material"]=json!(0);
  let gltf_bytes=serde_json::to_vec(&gltf).expect("encode");
  fs::write(&gltf_path,&gltf_bytes).expect("write");
  let manifest_path=options.source.join("manifest.json");
  let mut manifest:Value=serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");
  manifest["runtime"]["sha256"]=json!(hash(&gltf_bytes));
  fs::write(&manifest_path,serde_json::to_vec(&manifest).expect("encode")).expect("write");
  let result=compile(&options,|_|{}).expect("compile");
  assert_eq!(result["primitives"][0]["pass"],"shared-blend");
  assert!(result["primitives"][0]["pages"].as_array().expect("pages").is_empty());
  fs::remove_dir_all(root).expect("cleanup");
 }
 #[test] fn compile_source_v1_emits_blend_cache_v2(){
  let(root,options)=fixture();
  let opaque=compile(&options,|_|{}).expect("opaque compile");assert_eq!(opaque["formatVersion"],1);
  let gltf_path=options.source.join("mesh.gltf");let manifest_path=options.source.join("manifest.json");
  let mut gltf:Value=serde_json::from_slice(&fs::read(&gltf_path).expect("read")).expect("json");
  gltf["materials"]=json!([{"alphaMode":"BLEND"}]);gltf["meshes"][0]["primitives"][0]["material"]=json!(0);
  let bytes=serde_json::to_vec(&gltf).expect("encode");fs::write(&gltf_path,&bytes).expect("write");
  let mut manifest:Value=serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");
  assert_eq!(manifest["formatVersion"],1);manifest["runtime"]["sha256"]=json!(hash(&bytes));
  let source_manifest=serde_json::to_vec(&manifest).expect("encode");fs::write(&manifest_path,&source_manifest).expect("write");
  let blend=compile(&options,|_|{}).expect("blend compile");
  assert_eq!(blend["schema"],2);assert_eq!(blend["formatVersion"],2);
  let pointer:Value=serde_json::from_slice(&fs::read(options.cache.join("native/slice/manifest.json")).expect("pointer")).expect("json");
  assert_eq!(pointer["formatVersion"],2);assert_eq!(fs::read(&manifest_path).expect("unchanged source"),source_manifest);
  fs::remove_dir_all(root).expect("cleanup");
 }
 #[test] fn compile_concatenates_multiple_buffers(){
  let(root,options)=fixture();
  let pos=fs::read(options.source.join("mesh.bin")).expect("bin");
  let (positions,indices)=(pos[..36].to_vec(),pos[36..].to_vec());
  fs::write(options.source.join("pos.bin"),&positions).expect("pos");
  fs::write(options.source.join("idx.bin"),&indices).expect("idx");
  let gltf=json!({"asset":{"version":"2.0"},"buffers":[{"uri":"pos.bin","byteLength":36},{"uri":"idx.bin","byteLength":12}],"bufferViews":[{"buffer":0,"byteOffset":0,"byteLength":36},{"buffer":1,"byteOffset":0,"byteLength":12}],"accessors":[{"bufferView":0,"componentType":5126,"type":"VEC3","count":3},{"bufferView":1,"componentType":5125,"type":"SCALAR","count":3}],"meshes":[{"primitives":[{"attributes":{"POSITION":0},"indices":1}]}],"nodes":[{"mesh":0},{"mesh":0}],"materials":[]});
  let gltf_bytes=serde_json::to_vec(&gltf).expect("gltf");
  fs::write(options.source.join("mesh.gltf"),&gltf_bytes).expect("write");
  let manifest=json!({"status":"ready","formatVersion":FORMAT_VERSION,"runtime":{"file":"mesh.gltf","sha256":hash(&gltf_bytes),"sidecars":[{"file":"pos.bin","sha256":hash(&positions)},{"file":"idx.bin","sha256":hash(&indices)}],"trianglesAcrossNodes":2,"meshNodes":2}});
  fs::write(options.source.join("manifest.json"),serde_json::to_vec(&manifest).expect("manifest")).expect("write");
  let result=compile(&options,|_|{}).expect("compile");
  assert_eq!(result["selectedTriangles"],1);
  let key=result["key"].as_str().expect("key");
  let written:Value=serde_json::from_slice(&fs::read(options.cache.join("native/slice").join(key).join("source.gltf")).expect("source")).expect("json");
  assert_eq!(written["buffers"].as_array().expect("buffers").len(),1);
  assert_eq!(written["bufferViews"][0]["buffer"],0);
  assert_eq!(written["bufferViews"][1]["buffer"],0);
  fs::remove_dir_all(root).expect("cleanup");
 }
 #[test] fn compile_slice_keeps_the_smallest_mesh_when_budget_is_below_one_instance(){
  let(root,mut options)=cube_fixture();
  options.scope="slice".into();
  options.triangle_budget=1;
  let result=compile(&options,|_|{}).expect("compile");
  assert_eq!(result["selectedTriangles"],12);
  fs::remove_dir_all(root).expect("cleanup");
 }
 #[test] fn compile_sparse_accessor_overrides_base_data(){
  let(root,options)=fixture();
  let mut bin=fs::read(options.source.join("mesh.bin")).expect("read bin");
  let sparse_idx_offset=bin.len();
  bin.extend_from_slice(&1u32.to_le_bytes());
  let sparse_val_offset=bin.len();
  for v in [5.0f32,0.0,0.0]{bin.extend_from_slice(&v.to_le_bytes());}
  fs::write(options.source.join("mesh.bin"),&bin).expect("write bin");
  let gltf_path=options.source.join("mesh.gltf");
  let mut gltf:Value=serde_json::from_slice(&fs::read(&gltf_path).expect("read")).expect("json");
  gltf["buffers"][0]["byteLength"]=json!(bin.len());
  let bv_idx=gltf["bufferViews"].as_array().expect("views").len();
  let bv_val=bv_idx+1;
  gltf["bufferViews"].as_array_mut().expect("views").push(json!({"buffer":0,"byteOffset":sparse_idx_offset,"byteLength":4}));
  gltf["bufferViews"].as_array_mut().expect("views").push(json!({"buffer":0,"byteOffset":sparse_val_offset,"byteLength":12}));
  gltf["accessors"][0]["sparse"]=json!({"count":1,"indices":{"bufferView":bv_idx,"componentType":5125},"values":{"bufferView":bv_val}});
  let gltf_bytes=serde_json::to_vec(&gltf).expect("encode");
  fs::write(&gltf_path,&gltf_bytes).expect("write");
  let manifest_path=options.source.join("manifest.json");
  let mut manifest:Value=serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");
  manifest["runtime"]["sha256"]=json!(hash(&gltf_bytes));
  manifest["runtime"]["sidecars"][0]["sha256"]=json!(hash(&bin));
  fs::write(&manifest_path,serde_json::to_vec(&manifest).expect("encode")).expect("write");
  let result=compile(&options,|_|{}).expect("compile");
  assert_eq!(result["selectedTriangles"],1);
  let page=&result["primitives"][0]["pages"][0];
  assert_eq!(page["max"][0],5.0);
  fs::remove_dir_all(root).expect("cleanup");
 }
 #[test] fn compile_leaves_skinned_and_morph_meshes_unsplit(){
  let(root,options)=fixture();
  let mut bin=fs::read(options.source.join("mesh.bin")).expect("read bin");
  let target_offset=bin.len();
  for v in [0.1f32,0.2,0.3]{bin.extend_from_slice(&v.to_le_bytes());}
  let ibm_offset=bin.len();
  for _ in 0..16{bin.extend_from_slice(&0.0f32.to_le_bytes());}
  fs::write(options.source.join("mesh.bin"),&bin).expect("write bin");
  let gltf_path=options.source.join("mesh.gltf");
  let mut gltf:Value=serde_json::from_slice(&fs::read(&gltf_path).expect("read")).expect("json");
  gltf["buffers"][0]["byteLength"]=json!(bin.len());
  let bv_target=gltf["bufferViews"].as_array().expect("views").len();
  let bv_ibm=bv_target+1;
  gltf["bufferViews"].as_array_mut().expect("views").push(json!({"buffer":0,"byteOffset":target_offset,"byteLength":12}));
  gltf["bufferViews"].as_array_mut().expect("views").push(json!({"buffer":0,"byteOffset":ibm_offset,"byteLength":64}));
  let acc_target=gltf["accessors"].as_array().expect("accessors").len();
  let acc_ibm=acc_target+1;
  gltf["accessors"].as_array_mut().expect("accessors").push(json!({"bufferView":bv_target,"componentType":5126,"type":"VEC3","count":1}));
  gltf["accessors"].as_array_mut().expect("accessors").push(json!({"bufferView":bv_ibm,"componentType":5126,"type":"MAT4","count":1}));
  gltf["meshes"][0]["primitives"][0]["targets"]=json!([{"POSITION":acc_target}]);
  gltf["nodes"][0]["skin"]=json!(0);
  gltf["skins"]=json!([{"inverseBindMatrices":acc_ibm,"joints":[0]}]);
  let gltf_bytes=serde_json::to_vec(&gltf).expect("encode");
  fs::write(&gltf_path,&gltf_bytes).expect("write");
  let manifest_path=options.source.join("manifest.json");
  let mut manifest:Value=serde_json::from_slice(&fs::read(&manifest_path).expect("read")).expect("json");
  manifest["runtime"]["sha256"]=json!(hash(&gltf_bytes));
  manifest["runtime"]["sidecars"][0]["sha256"]=json!(hash(&bin));
  fs::write(&manifest_path,serde_json::to_vec(&manifest).expect("encode")).expect("write");
  let result=compile(&options,|_|{}).expect("compile");
  assert_eq!(result["primitives"][0]["pass"],"shared-blend");
  assert!(result["primitives"][0]["pages"].as_array().expect("pages").is_empty());
  let key=result["key"].as_str().expect("key");
  let source_gltf:Value=serde_json::from_slice(&fs::read(options.cache.join("native/slice").join(key).join("source.gltf")).expect("read source")).expect("json");
  assert!(source_gltf.get("skins").is_some());
  assert!(source_gltf["meshes"][0]["primitives"][0].get("targets").is_some());
  fs::remove_dir_all(root).expect("cleanup");
 }

 fn obj_fixture(name:&str,mtl:bool)->(PathBuf,Options){
  let (root,mut options)=fixture();
  let source=root.join("obj");fs::create_dir_all(&source).expect("obj dir");
  let mut obj=String::from("v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nvn 0 0 1\nvt 0 0\nvt 1 0\nvt 0 1\nvt 1 1\n");
  if mtl{obj.push_str("mtllib quad.mtl\nusemtl painted\n");fs::write(source.join("quad.mtl"),"newmtl painted\nKd 0.2 0.4 0.6\nd 0.5\nmap_Kd textures/paint.png\n").expect("mtl");fs::create_dir_all(source.join("textures")).expect("textures");fs::write(source.join("textures/paint.png"),b"\x89PNG\r\n\x1a\nnot-a-real-png").expect("png");}
  obj.push_str("f 1/1/1 2/2/1 4/4/1 3/3/1\n");
  fs::write(source.join(name),obj).expect("obj write");
  options.source=source.join(name);options.scope="full".into();options.triangle_budget=150000;
  (root,options)
 }
 #[test] fn obj_source_is_imported_into_the_cache_then_compiled(){
  let (root,options)=obj_fixture("quad.obj",true);
  let events=std::sync::Mutex::new(Vec::new());
  let result=compile(&options,|e|events.lock().unwrap().push(e)).expect("compile obj");
  assert_eq!(result["selectedTriangles"],2);
  let imports=options.cache.join("native/imports");
  let entries:Vec<_>=fs::read_dir(&imports).expect("imports").map(|e|e.expect("entry").path()).collect();
  assert_eq!(entries.len(),1);
  let manifest:Value=serde_json::from_slice(&fs::read(entries[0].join("manifest.json")).expect("manifest")).expect("json");
  assert_eq!(manifest["status"],"ready");assert_eq!(manifest["source"]["importer"],import::IMPORTER_VERSION);assert_eq!(manifest["runtime"]["trianglesAcrossNodes"],2);assert_eq!(manifest["runtime"]["meshNodes"],1);
  let gltf:Value=serde_json::from_slice(&fs::read(entries[0].join("model.gltf")).expect("gltf")).expect("json");
  assert_eq!(gltf["materials"][0]["pbrMetallicRoughness"]["baseColorFactor"][3],0.5);
  assert_eq!(gltf["materials"][0]["alphaMode"],"BLEND");
  assert_eq!(gltf["images"][0]["uri"],"textures/paint.png");
  assert_eq!(gltf["meshes"][0]["primitives"][0]["attributes"]["TEXCOORD_0"].as_u64().is_some(),true);
  let steps:Vec<String>=events.lock().unwrap().iter().filter(|e|e["phase"]=="import-source").map(|e|e["step"].as_str().unwrap_or("").to_string()).collect();
  assert!(steps.contains(&"complete".to_string()),"{steps:?}");
  // A second run reuses the import and only recompiles when the compile key changed (it did not).
  let events=std::sync::Mutex::new(Vec::new());
  let again=compile(&options,|e|events.lock().unwrap().push(e)).expect("compile again");
  assert_eq!(again["key"],result["key"]);
  let steps:Vec<String>=events.lock().unwrap().iter().filter(|e|e["phase"]=="import-source").map(|e|e["step"].as_str().unwrap_or("").to_string()).collect();
  assert_eq!(steps,vec!["reused".to_string()]);
  fs::remove_dir_all(root).expect("cleanup");
 }
 #[test] fn directory_of_importable_files_is_merged_into_one_scene(){
  let (root,options)=obj_fixture("a.obj",false);
  let dir=options.source.parent().expect("dir").to_path_buf();
  fs::copy(dir.join("a.obj"),dir.join("b.obj")).expect("copy");
  let options=Options{source:dir.clone(),..options};
  assert!(needs_import(&dir).expect("needs import"));
  let result=compile(&options,|_|{}).expect("compile dir");
  assert_eq!(result["selectedTriangles"],4);
  assert_eq!(result["selectedNodes"].as_array().map(|a|a.len()),Some(2));
  fs::remove_dir_all(root).expect("cleanup");
 }
 #[test] fn gltf_sources_never_go_through_the_importer(){
  let (root,options)=fixture();
  assert!(!needs_import(&options.source).expect("manifest dir"));
  assert!(!needs_import(&options.source.join("mesh.gltf")).expect("gltf file"));
  fs::remove_dir_all(root).expect("cleanup");
 }
 #[test] fn cancelled_import_reports_cancelled(){
  let (root,options)=obj_fixture("quad.obj",false);
  options.cancelled.store(true,Ordering::Relaxed);
  assert_eq!(compile(&options,|_|{}).expect_err("cancelled").code,"CANCELLED");
  fs::remove_dir_all(root).expect("cleanup");
 }
}
