'use strict';
function nameParts(filename) {
  const base = String(filename || '').replace(/\.(jpe?g|png|webp|heic)$/i,'').replace(/\s*\(\d+\)\s*$/,'').trim();
  const cut = base.indexOf('&');
  if (cut < 0) return {design:'Unknown Design',colour:'Unknown Colour',needs_review:true};
  const design = base.slice(0,cut).trim() || 'Unknown Design';
  const colour = base.slice(cut+1).trim() || 'Unknown Colour';
  return {design,colour,needs_review:design==='Unknown Design'||colour==='Unknown Colour'};
}
function mapRow(r) {
  const p = nameParts(r.filename);
  return {id:r.drive_file_id,code:'',store:r.store,branch:r.store,department:r.department||'Saree',fabric_name:r.fabric,
    category:'Not Defined',design:p.design,design_name:'Not Defined',theme:p.design,colour:p.colour,filename:r.filename,qty:1,needs_review:p.needs_review};
}
module.exports={nameParts,mapRow};
