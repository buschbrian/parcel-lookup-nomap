import assert from "node:assert/strict";
import { readApp, readBusinessApp } from "./app-config.mjs";

const {CFG}=await readApp();
const {CFG:businessCFG}=await readBusinessApp();
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
      ...(layer.attachments?["OBJECTID"]:[])]})),
  {key:"business-rental",url:businessCFG.rental.url,fields:[businessCFG.rental.idField]},
  {key:"business-buffer",url:businessCFG.buffer.url,
    fields:[businessCFG.buffer.originField,businessCFG.buffer.distanceField]}
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

const spatialResults=new Map(await Promise.all(CFG.LAYERS.map(async layer=>{
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
  return [layer.key,result.features.map(feature=>feature.attributes)];
})));

const floodSignature=attributes=>{
  const zone=String(attributes?.FLD_ZONE||"").trim().toUpperCase();
  const subtype=String(attributes?.ZONE_SUBTY||"").trim().toUpperCase()
    .replace(/\bPERCENT\b/g,"PCT").replace(/\s+/g," ");
  const sfha=String(attributes?.SFHA_TF||"").trim().toUpperCase();
  return zone+"|"+subtype+"|"+sfha;
};
const comparable=features=>new Set(features
  .filter(feature=>!/MINIMAL FLOOD HAZARD/i.test(String(feature?.ZONE_SUBTY||"")))
  .map(floodSignature));
const femaClasses=comparable(spatialResults.get("flood")||[]);
const cityClasses=comparable(spatialResults.get("flood_local")||[]);
assert.equal(femaClasses.size,cityClasses.size,"known parcel flood source count differs");
assert.equal([...femaClasses].every(value=>cityClasses.has(value)),true,
  "known parcel FEMA and Millcreek flood classifications differ");
console.log("ok known-parcel FEMA/Millcreek flood congruence");

const hazardParcelId="15354000190000";
const hazardParcelParams=new URLSearchParams({f:"json",returnGeometry:"true",outSR:"4326",
  outFields:"parcel_id,prop_location",where:CFG.parcel.idField+"='"+hazardParcelId+"'"});
const hazardParcel=await json(layerUrl(CFG.parcel.url)+"/query?"+hazardParcelParams);
const hazardGeometry=hazardParcel.features?.[0]?.geometry;
assert.ok(hazardGeometry,"known flood-hazard parcel geometry is available");
const floodLayers=[CFG.LAYERS.find(layer=>layer.key==="flood"),
  CFG.LAYERS.find(layer=>layer.key==="flood_local")];
const [hazardFema,hazardCity]=await Promise.all(floodLayers.map(async layer=>{
  const queryParams=new URLSearchParams({f:"json",returnGeometry:"false",outFields:"*",
    geometry:JSON.stringify(hazardGeometry),geometryType:"esriGeometryPolygon",inSR:"4326",
    spatialRel:"esriSpatialRelIntersects"});
  return (await json(layerUrl(layer.url)+"/query?"+queryParams)).features.map(f=>f.attributes);
}));
assert.equal(hazardFema.some(feature=>String(feature.SFHA_TF).toUpperCase()==="T"),true,
  "known hazard parcel no longer intersects FEMA SFHA");
const hazardFemaClasses=comparable(hazardFema);
const hazardCityClasses=comparable(hazardCity);
assert.equal(hazardFemaClasses.size,hazardCityClasses.size,
  "known hazard parcel flood source count differs");
assert.equal([...hazardFemaClasses].every(value=>hazardCityClasses.has(value)),true,
  "known hazard parcel FEMA and Millcreek classifications differ");
console.log("ok known-hazard-parcel FEMA/Millcreek flood congruence",hazardParcelId);

const faultParcelId="16203550110000";
const faultParcelParams=new URLSearchParams({f:"json",returnGeometry:"true",outSR:"4326",
  outFields:"parcel_id,prop_location",where:CFG.parcel.idField+"='"+faultParcelId+"'"});
const faultParcel=await json(layerUrl(CFG.parcel.url)+"/query?"+faultParcelParams);
const faultGeometry=faultParcel.features?.[0]?.geometry;
assert.ok(faultGeometry,"known special-study-area parcel geometry is available");
const faultLayer=CFG.LAYERS.find(layer=>layer.key==="fault");
const faultQueryParams=new URLSearchParams({f:"json",returnGeometry:"false",outFields:"OBJECTID",
  geometry:JSON.stringify(faultGeometry),geometryType:"esriGeometryPolygon",inSR:"4326",
  spatialRel:"esriSpatialRelIntersects"});
const faultResult=await json(layerUrl(faultLayer.url)+"/query?"+faultQueryParams);
assert.ok(faultResult.features.length>0,
  "known special-study-area parcel no longer intersects the fault study layer");
console.log("ok known fault-special-study-area parcel",faultParcelId);

const informationalHazardParcels={
  liquefaction:"22062280160000",
  debris_flow:"22013760250000",
  alluvial_fan:"22013520360000"
};
for(const [layerKey,positiveParcelId] of Object.entries(informationalHazardParcels)){
  const positiveParcelParams=new URLSearchParams({f:"json",returnGeometry:"true",outSR:"4326",
    outFields:"parcel_id,prop_location",where:CFG.parcel.idField+"='"+positiveParcelId+"'"});
  const positiveParcel=await json(layerUrl(CFG.parcel.url)+"/query?"+positiveParcelParams);
  const positiveGeometry=positiveParcel.features?.[0]?.geometry;
  assert.ok(positiveGeometry,layerKey+" known-positive parcel geometry is unavailable");
  const layer=CFG.LAYERS.find(candidate=>candidate.key===layerKey);
  const positiveQueryParams=new URLSearchParams({f:"json",returnGeometry:"false",outFields:"*",
    geometry:JSON.stringify(positiveGeometry),geometryType:"esriGeometryPolygon",inSR:"4326",
    spatialRel:"esriSpatialRelIntersects"});
  const positiveResult=await json(layerUrl(layer.url)+"/query?"+positiveQueryParams);
  assert.ok(positiveResult.features.length>0,
    layerKey+" known-positive parcel no longer intersects the configured layer");
  console.log("ok known informational-hazard parcel",layerKey,positiveParcelId);
}

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

const rentalParams=new URLSearchParams({f:"json",where:"1=1",returnGeometry:"false",
  outFields:businessCFG.rental.idField,resultRecordCount:"1"});
const rentalResult=await json(layerUrl(businessCFG.rental.url)+"/query?"+rentalParams);
const rentalParcelId=rentalResult.features?.[0]?.attributes?.[businessCFG.rental.idField];
assert.ok(rentalParcelId,"published short-term-rental layer has no records");
const rentalBufferParams=new URLSearchParams({f:"json",returnGeometry:"false",
  outFields:[businessCFG.buffer.originField,businessCFG.buffer.distanceField].join(","),
  where:businessCFG.buffer.originField+"='"+String(rentalParcelId).replaceAll("'","''")+"'"});
const rentalBuffer=await json(layerUrl(businessCFG.buffer.url)+"/query?"+rentalBufferParams);
assert.ok(rentalBuffer.features?.length,"known published rental has no matching buffer");
// ArcGIS currently stores BUFF_DIST as 121.92024384 (400 feet expressed in
// metres) even though its field alias says feet. Verify the geometry itself:
// in the service's Utah Central feet coordinate system, every envelope side
// extends about 400 feet beyond the originating rental parcel.
const distanceValues=rentalBuffer.features.map(feature=>
  Number(feature.attributes[businessCFG.buffer.distanceField]));
assert.equal(distanceValues.every(value=>Math.abs(value-121.92024384)<0.01||
  Math.abs(value-400)<0.01),true,"published buffer-distance attribute changed");
async function featureExtent(url,idField,id){
  const extentParams=new URLSearchParams({f:"json",returnExtentOnly:"true",outSR:"102743",
    where:idField+"='"+String(id).replaceAll("'","''")+"'"});
  return (await json(layerUrl(url)+"/query?"+extentParams)).extent;
}
const [rentalExtent,bufferExtent]=await Promise.all([
  featureExtent(businessCFG.rental.url,businessCFG.rental.idField,rentalParcelId),
  featureExtent(businessCFG.buffer.url,businessCFG.buffer.originField,rentalParcelId)
]);
assert.ok(rentalExtent&&bufferExtent,"published rental or buffer extent is unavailable");
const bufferMargins=[rentalExtent.xmin-bufferExtent.xmin,rentalExtent.ymin-bufferExtent.ymin,
  bufferExtent.xmax-rentalExtent.xmax,bufferExtent.ymax-rentalExtent.ymax];
assert.equal(bufferMargins.every(value=>value>=395&&value<=405),true,
  "published short-term-rental geometry is not a 400-foot buffer");
console.log("ok short-term-rental parcel and 400-foot buffer geometry",rentalParcelId);

const webMapUrl=CFG.referenceWebMap.portalUrl+"/sharing/rest/content/items/"+
  CFG.referenceWebMap.itemId+"/data?f=json";
const webMap=await json(webMapUrl);
const leafLayers=[];
function flatten(layers){
  for(const layer of layers||[]){
    if(layer.layers) flatten(layer.layers);
    else if(layer.url) leafLayers.push(layer);
  }
}
flatten(webMap.operationalLayers);
const normalizeUrl=url=>new URL(url).href.replace(/\/$/,"").toLowerCase();
const webMapUrls=new Set(leafLayers.map(layer=>normalizeUrl(layer.url)));
const paritySpecs=[
  {key:"address",url:CFG.address.url},{key:"parcel",url:CFG.parcel.url},
  ...CFG.LAYERS.filter(layer=>layer.kind!=="femaFlood"),
  {key:"business-rental",url:businessCFG.rental.url},
  {key:"business-buffer",url:businessCFG.buffer.url}
];
for(const spec of paritySpecs){
  assert.equal(webMapUrls.has(normalizeUrl(layerUrl(spec.url))),true,
    spec.key+" is not present in the configured public Planning web map");
}
console.log("ok public-web-map parity",paritySpecs.length,"adopted local layers verified");
