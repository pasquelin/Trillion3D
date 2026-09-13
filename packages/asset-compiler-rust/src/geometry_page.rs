use std::collections::HashMap;
use crate::{CompilerError,Result};

pub const STRIDE:usize=72;
pub struct Attribute {pub offset:usize,pub width:usize,pub source_width:usize,pub flag:u32,pub values:Vec<f32>}

/** A complete, independently decodable geometry page. Float32 attributes are lossless. */
pub fn encode(indices:&[u32],positions:&[f32],attributes:&[Attribute])->Result<(Vec<u8>,u32,usize)>{
 if indices.len()<3||indices.len()%3!=0||positions.len()%3!=0{return Err(CompilerError::new("INVALID_PAGE","Invalid page triangle or position count"));}
 let mut original=Vec::<u32>::new();let mut remap=HashMap::<u32,u32>::new();let mut local=Vec::<u32>::with_capacity(indices.len());
 for &source in indices{
  if source as usize>=positions.len()/3{return Err(CompilerError::new("INVALID_PAGE","Page index exceeds positions"));}
  let id=if let Some(&id)=remap.get(&source){id}else{let id=original.len();if id>=65535{return Err(CompilerError::new("PAGE_VERTEX_LIMIT","Page has more than 65535 vertices"));}original.push(source);remap.insert(source,id as u32);id as u32};
  local.push(id);
 }
 let mut flags=0u32;for attribute in attributes{flags|=attribute.flag;if attribute.values.len()!=positions.len()/3*attribute.source_width||attribute.offset+attribute.width*4>STRIDE{return Err(CompilerError::new("INVALID_PAGE_ATTRIBUTE","Page attribute count or layout is invalid"));}}
 let mut vertices=vec![[0u8;STRIDE];original.len()];
 for (i,&source) in original.iter().enumerate(){
  let source=source as usize;
  for c in 0..3{let value=positions[source*3+c];if !value.is_finite(){return Err(CompilerError::new("INVALID_PAGE_ATTRIBUTE","Nonfinite position"));}vertices[i][c*4..c*4+4].copy_from_slice(&value.to_le_bytes());}
  for attribute in attributes{for c in 0..attribute.width{
   let value=if c<attribute.source_width{attribute.values[source*attribute.source_width+c]}else{1.0};
   if !value.is_finite(){return Err(CompilerError::new("INVALID_PAGE_ATTRIBUTE","Nonfinite page attribute"));}
   let offset=attribute.offset+c*4;vertices[i][offset..offset+4].copy_from_slice(&value.to_le_bytes());
  }}
 }
 let encoded_indices=meshopt::encode_index_buffer(&local,original.len()).map_err(|e|CompilerError::new("PAGE_COMPRESSION",e.to_string()))?;
 let encoded_vertices=meshopt::encode_vertex_buffer(&vertices).map_err(|e|CompilerError::new("PAGE_COMPRESSION",e.to_string()))?;
 let mut out=Vec::with_capacity(32+encoded_indices.len()+encoded_vertices.len());
 for word in [0x3250_4757u32,2,original.len() as u32,indices.len() as u32,flags,STRIDE as u32,encoded_indices.len() as u32,encoded_vertices.len() as u32]{out.extend_from_slice(&word.to_le_bytes());}
 out.extend_from_slice(&encoded_indices);out.extend_from_slice(&encoded_vertices);
 Ok((out,flags,original.len()))
}

#[cfg(test)]
mod tests{
 use super::*;
 #[derive(Clone)]struct Vertex([u8;STRIDE]);
 impl Default for Vertex{fn default()->Self{Self([0;STRIDE])}}
 #[test]
 fn page_roundtrip_keeps_local_indices_and_float_attributes(){
  let positions=[0.,0.,0.,1.,0.,0.,0.,1.,0.];
  let colors=Attribute{offset:56,width:4,source_width:3,flag:16,values:vec![1.,0.,0.,0.,1.,0.,0.,0.,1.]};
  let (bytes,flags,vertex_count)=encode(&[0,1,2,0,2,1],&positions,&[colors]).expect("encode");
  assert_eq!(flags,16);assert_eq!(vertex_count,3);
  let index_bytes=u32::from_le_bytes(bytes[24..28].try_into().expect("index length")) as usize;
  let indices:Vec<u16>=meshopt::decode_index_buffer(&bytes[32..32+index_bytes],6).expect("decode indices");
  let vertices:Vec<Vertex>=meshopt::decode_vertex_buffer(&bytes[32+index_bytes..],3).expect("decode vertices");
  assert_eq!(indices,[0,1,2,0,2,1]);
  assert_eq!(f32::from_le_bytes(vertices[0].0[0..4].try_into().expect("x")),0.);
  assert_eq!(f32::from_le_bytes(vertices[1].0[0..4].try_into().expect("x")),1.);
  assert_eq!(f32::from_le_bytes(vertices[2].0[64..68].try_into().expect("blue")),1.);
  assert_eq!(f32::from_le_bytes(vertices[2].0[68..72].try_into().expect("alpha")),1.);
 }
}
