import assert from "node:assert/strict";
import { readApp } from "./app-config.mjs";

const {CFG}=await readApp();
const timeoutMs=20_000;
const layerUrl=path=>/^https?:\/\//i.test(path)?path:CFG.org+path;

async function json(url){
  const response=await fetch(url,{signal:AbortSignal.timeout(timeoutMs),headers:{Accept:"application/json"}});
  assert.equal(response.ok,true,url+" returned HTTP "+response.status);
  const body=await response.json();
  assert.equal(body.error,undefined,url+" returned an ArcGIS error");
  return body;
}

const specs=[
  {key:"address",url:CFG.address.url,fields:[CFG.address.searchField,CFG.address.parcelField,
    CFG.address.numField,CFG.address.nameField,...CFG.address.extra]},
  {key:"parcel",url:CFG.parcel.url,fields:[CFG.parcel.idField,CFG.parcel.latField,CFG.parcel.lonField,
    ...CFG.PARCEL_FACTS.map(([field])=>field),...CFG.PARCEL_FLAGS.map(flag=>flag.field)]},
  ...CFG.LAYERS.map(layer=>({key:layer.key,url:layer.url,
    fields:[...Object.keys(layer.fields||{}),...(layer.nameField?[layer.nameField]:[]),
      ...(layer.attachments?["OBJECTID"]:[])]}))
];

for(const spec of specs){
  const metadata=await json(layerUrl(spec.url)+"?f=json");
  const fields=new Set((metadata.fields||[]).map(field=>field.name));
  const missing=[...new Set(spec.fields)].filter(field=>!fields.has(field));
  assert.deepEqual(missing,[],spec.key+" missing configured fields: "+missing.join(", "));
  console.log("ok",spec.key,spec.url);
}

const params=new URLSearchParams({f:"json",returnGeometry:"false",
  where:"UPPER("+CFG.address.searchField+") LIKE '3300 E SANTA ROSA AVE%'",
  outFields:CFG.address.searchField+","+CFG.address.parcelField,resultRecordCount:"1"});
const known=await json(CFG.org+CFG.address.url+"/query?"+params);
assert.ok(known.features?.[0]?.attributes?.[CFG.address.parcelField],"known address returns a parcel ID");
console.log("ok known-address lookup",known.features[0].attributes[CFG.address.searchField]);

const parcelId=known.features[0].attributes[CFG.address.parcelField];
const parcelParams=new URLSearchParams({f:"json",returnGeometry:"true",outSR:"4326",outFields:"*",
  where:CFG.parcel.idField+"='"+String(parcelId).replaceAll("'","''")+"'"});
const parcelResult=await json(CFG.org+CFG.parcel.url+"/query?"+parcelParams);
const record=parcelResult.features?.[0]?.attributes;
const parcelGeometry=parcelResult.features?.[0]?.geometry;
assert.ok(record,"known parcel record is available");
const lon=record[CFG.parcel.lonField],lat=record[CFG.parcel.latField];
assert.equal(Number.isFinite(Number(lon))&&Number.isFinite(Number(lat)),true,"known parcel has a centroid");
console.log("ok known-parcel lookup",parcelId);

await Promise.all(CFG.LAYERS.map(async layer=>{
  const useParcel=layer.geometryMode==="parcel"&&parcelGeometry;
  const spatialParams=new URLSearchParams({f:"json",returnGeometry:"false",outFields:"*",
    geometry:useParcel?JSON.stringify(parcelGeometry):String(lon)+","+String(lat),
    geometryType:useParcel?"esriGeometryPolygon":"esriGeometryPoint",inSR:"4326",
    spatialRel:"esriSpatialRelIntersects",
    ...(layer.distance?{distance:String(layer.distance),units:layer.units||"esriSRUnit_Meter"}:{})});
  const result=await json(layerUrl(layer.url)+"/query?"+spatialParams);
  assert.ok(Array.isArray(result.features),layer.key+" query returned no feature array");
  if((layer.cardinality||"one")==="one")
    assert.ok(result.features.length<=1,layer.key+" unexpectedly returned multiple polygons");
  if(layer.attachments&&result.features[0]?.attributes?.OBJECTID!=null){
    const objectId=result.features[0].attributes.OBJECTID;
    const attachments=await json(layerUrl(layer.url)+"/"+objectId+"/attachments?f=json");
    assert.ok(Array.isArray(attachments.attachmentInfos),layer.key+" attachment listing is unavailable");
    console.log("ok",layer.key,"spatial query; attachments",attachments.attachmentInfos.length);
  }else{
    console.log("ok",layer.key,"spatial query; matches",result.features.length);
  }
}));

const historicLayer=CFG.LAYERS.find(layer=>layer.key==="hist");
const historicParams=new URLSearchParams({f:"json",where:"1=1",returnGeometry:"false",
  outFields:"name,designation_type,local_ordinance,listyear"});
const historicResult=await json(layerUrl(historicLayer.url)+"/query?"+historicParams);
const districts=new Map(historicResult.features.map(feature=>[
  feature.attributes.name,feature.attributes
]));
assert.equal(districts.get("Mountair Acres Subdivision Historic District")?.designation_type,
  "Federal","Mountair Acres must remain distinguishable as National Register only");
assert.equal(districts.get("Mountair Acres Subdivision Historic District")?.local_ordinance,
  "No","Mountair Acres local-ordinance status changed");
assert.equal(districts.get("Evergreen Avenue Historic District")?.designation_type,
  "Federal and Local","Evergreen must retain Federal and Local designation");
assert.equal(districts.get("Evergreen Avenue Historic District")?.local_ordinance,
  "Yes","Evergreen local-ordinance status changed");
console.log("ok historic designation distinction; National Register-only and local district verified");

console.log("Candidate replacements still require GIS/Planning approval:");
console.log("- FutureLandUse_2024_Millcreek/FeatureServer/0");
console.log("- Zone_Update_2025___Related_Master/FeatureServer/2");
