import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { readApp, readBusinessApp } from "./app-config.mjs";
import { buildReport, classifyHttp, contractFailure, renderSummary,
  withRetry } from "./service-contract-core.mjs";

const {CFG}=await readApp();
const {CFG:businessCFG}=await readBusinessApp();
const timeoutMs=20_000;
const layerUrl=path=>/^https?:\/\//i.test(path)?path:CFG.org+path;

/* Transport failure is retried on a bounded backoff; anything the service says
   about its own data is not. An ArcGIS error body is a rejected query — a
   contract finding, not a bad connection — so it is raised as one and reported
   on the first attempt. See scripts/service-contract-core.mjs. */
async function json(url){
  const {value}=await withRetry(async()=>{
    const response=await fetch(url,
      {signal:AbortSignal.timeout(timeoutMs),headers:{Accept:"application/json"}});
    if(!response.ok){
      const {kind,transient}=classifyHttp(response.status);
      const error=new Error(url+" returned HTTP "+response.status);
      error.kind=kind;
      if(!transient) error.code="HTTP_"+response.status;
      throw error;
    }
    const body=await response.json();
    if(body.error)
      throw contractFailure(url+" returned an ArcGIS error: "+
        (body.error.message||"query rejected"));
    return body;
  });
  return value;
}

/* Every contract is recorded rather than thrown, so one failure does not hide
   the other fifty. Checks that depend on a failed prerequisite are recorded as
   skipped rather than silently missing — a report that simply stops is how the
   deployment check went two months proving nothing. */
const checks=[];
async function contract(key,detail,run){
  try{
    const note=await run();
    checks.push({key,ok:true,detail,note:note===undefined?undefined:String(note)});
    console.log("ok",key,detail===undefined?"":detail,note===undefined?"":note);
    return true;
  }catch(error){
    const kind=error?.kind==="contract"||error instanceof assert.AssertionError
      ? "contract" : (error?.kind||"unknown");
    checks.push({key,ok:false,detail,
      failure:{kind,message:error?.message||String(error),attempts:error?.attempts||1}});
    console.error("FAIL",key,"-",error?.message||error);
    return false;
  }
}
function skip(key,reason){
  checks.push({key,ok:false,skipped:true,detail:reason});
  console.log("skip",key,"-",reason);
}

const specs=[
  {key:"address",url:CFG.address.url,fields:[CFG.address.searchField,CFG.address.parcelField,
    CFG.address.numField,CFG.address.nameField,...CFG.address.extra]},
  // Owner, care-of and the Assessor link are named in CFG rather than read by name in
  // the page, so they are verified here too. Without them a County rename would drop
  // the owner block and the valuation link from every result and pass every check.
  {key:"parcel",url:CFG.parcel.url,fields:[CFG.parcel.idField,CFG.parcel.latField,CFG.parcel.lonField,
    CFG.parcel.ownerField,CFG.parcel.careOfField,CFG.parcel.assessorLinkField,
    ...CFG.PARCEL_FACTS.map(([field])=>field),...CFG.PARCEL_FLAGS.map(flag=>flag.field)]},
  ...CFG.LAYERS.map(layer=>({key:layer.key,url:layer.url,
    fields:[...Object.keys(layer.fields||{}),...(layer.nameField?[layer.nameField]:[]),
      ...(layer.attachments?["OBJECTID"]:[])]})),
  {key:"business-rental",url:businessCFG.rental.url,fields:[businessCFG.rental.idField]},
  {key:"business-buffer",url:businessCFG.buffer.url,
    fields:[businessCFG.buffer.originField,businessCFG.buffer.distanceField]}
];

for(const spec of specs){
  await contract(spec.key,spec.url,async()=>{
    const metadata=await json(layerUrl(spec.url)+"?f=json");
    const fields=new Set((metadata.fields||[]).map(field=>field.name));
    const missing=[...new Set(spec.fields)].filter(field=>!fields.has(field));
    if(missing.length)
      throw contractFailure(spec.key+" missing configured fields: "+missing.join(", "));
    return fields.size+" fields";
  });
}

const params=new URLSearchParams({f:"json",returnGeometry:"false",
  where:"UPPER("+CFG.address.searchField+") LIKE '3300 E SANTA ROSA AVE%'",
  outFields:CFG.address.searchField+","+CFG.address.parcelField,resultRecordCount:"1"});
let parcelId=null;
await contract("known-address",CFG.address.url,async()=>{
  const known=await json(CFG.org+CFG.address.url+"/query?"+params);
  parcelId=known.features?.[0]?.attributes?.[CFG.address.parcelField];
  if(!parcelId) throw contractFailure("the published test address returns no parcel ID");
  // The address is the synthetic fixture published throughout this repository.
  return known.features[0].attributes[CFG.address.searchField];
});
let record=null,parcelGeometry=null,lon=null,lat=null;
if(parcelId) await contract("known-parcel",CFG.parcel.url,async()=>{
  const parcelParams=new URLSearchParams({f:"json",returnGeometry:"true",outSR:"4326",outFields:"*",
    where:CFG.parcel.idField+"='"+String(parcelId).replaceAll("'","''")+"'"});
  const parcelResult=await json(CFG.org+CFG.parcel.url+"/query?"+parcelParams);
  record=parcelResult.features?.[0]?.attributes;
  parcelGeometry=parcelResult.features?.[0]?.geometry;
  if(!record) throw contractFailure("the known parcel record is no longer available");
  lon=record[CFG.parcel.lonField]; lat=record[CFG.parcel.latField];
  if(!(Number.isFinite(Number(lon))&&Number.isFinite(Number(lat))))
    throw contractFailure("the known parcel no longer has a usable centroid");
  // The parcel id only. `record` holds owner and mailing details: never report it.
  return parcelId;
});
else skip("known-parcel","the known-address lookup did not return a parcel ID");

const spatialResults=new Map(await Promise.all(CFG.LAYERS.map(async layer=>{
 if(!record){ skip(layer.key+" spatial","the known parcel is unavailable"); return [layer.key,[]]; }
 let features=[];
 await contract(layer.key+" spatial",layer.url,async()=>{
  const useParcel=layer.geometryMode==="parcel"&&parcelGeometry;
  const spatialParams=new URLSearchParams({f:"json",returnGeometry:"false",outFields:"*",
    geometry:useParcel?JSON.stringify(parcelGeometry):String(lon)+","+String(lat),
    geometryType:useParcel?"esriGeometryPolygon":"esriGeometryPoint",inSR:"4326",
    spatialRel:"esriSpatialRelIntersects",
    ...(layer.distance?{distance:String(layer.distance),units:layer.units||"esriSRUnit_Meter"}:{})});
  const result=await json(layerUrl(layer.url)+"/query?"+spatialParams);
  if(!Array.isArray(result.features))
    throw contractFailure(layer.key+" query returned no feature array");
  if((layer.cardinality||"one")==="one"&&result.features.length>1)
    throw contractFailure(layer.key+" unexpectedly returned multiple polygons");
  features=result.features.map(feature=>feature.attributes);
  if(layer.attachments&&result.features[0]?.attributes?.OBJECTID!=null){
    const objectId=result.features[0].attributes.OBJECTID;
    const attachments=await json(layerUrl(layer.url)+"/"+objectId+"/attachments?f=json");
    if(!Array.isArray(attachments.attachmentInfos))
      throw contractFailure(layer.key+" attachment listing is unavailable");
    return "attachments "+attachments.attachmentInfos.length;
  }
  return "matches "+result.features.length;
 });
 return [layer.key,features];
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
await contract("flood-congruence","known parcel",async()=>{
  const femaClasses=comparable(spatialResults.get("flood")||[]);
  const cityClasses=comparable(spatialResults.get("flood_local")||[]);
  if(femaClasses.size!==cityClasses.size)
    throw contractFailure("known parcel flood source count differs");
  if(![...femaClasses].every(value=>cityClasses.has(value)))
    throw contractFailure("known parcel FEMA and Millcreek flood classifications differ");
  return femaClasses.size+" classifications agree";
});

const hazardParcelId="15354000190000";
await contract("hazard-parcel-congruence",hazardParcelId,async()=>{
  const hazardParcelParams=new URLSearchParams({f:"json",returnGeometry:"true",outSR:"4326",
    outFields:"parcel_id,prop_location",where:CFG.parcel.idField+"='"+hazardParcelId+"'"});
  const hazardParcel=await json(layerUrl(CFG.parcel.url)+"/query?"+hazardParcelParams);
  const hazardGeometry=hazardParcel.features?.[0]?.geometry;
  if(!hazardGeometry) throw contractFailure("known flood-hazard parcel geometry is unavailable");
  const floodLayers=[CFG.LAYERS.find(layer=>layer.key==="flood"),
    CFG.LAYERS.find(layer=>layer.key==="flood_local")];
  const [hazardFema,hazardCity]=await Promise.all(floodLayers.map(async layer=>{
    const queryParams=new URLSearchParams({f:"json",returnGeometry:"false",outFields:"*",
      geometry:JSON.stringify(hazardGeometry),geometryType:"esriGeometryPolygon",inSR:"4326",
      spatialRel:"esriSpatialRelIntersects"});
    return (await json(layerUrl(layer.url)+"/query?"+queryParams)).features.map(f=>f.attributes);
  }));
  if(!hazardFema.some(feature=>String(feature.SFHA_TF).toUpperCase()==="T"))
    throw contractFailure("known hazard parcel no longer intersects FEMA SFHA");
  const hazardFemaClasses=comparable(hazardFema);
  const hazardCityClasses=comparable(hazardCity);
  if(hazardFemaClasses.size!==hazardCityClasses.size)
    throw contractFailure("known hazard parcel flood source count differs");
  if(![...hazardFemaClasses].every(value=>hazardCityClasses.has(value)))
    throw contractFailure("known hazard parcel FEMA and Millcreek classifications differ");
  return hazardFemaClasses.size+" classifications agree";
});

const faultParcelId="16203550110000";
await contract("fault-special-study-area",faultParcelId,async()=>{
  const faultParcelParams=new URLSearchParams({f:"json",returnGeometry:"true",outSR:"4326",
    outFields:"parcel_id,prop_location",where:CFG.parcel.idField+"='"+faultParcelId+"'"});
  const faultParcel=await json(layerUrl(CFG.parcel.url)+"/query?"+faultParcelParams);
  const faultGeometry=faultParcel.features?.[0]?.geometry;
  if(!faultGeometry) throw contractFailure("known special-study-area parcel geometry is unavailable");
  const faultLayer=CFG.LAYERS.find(layer=>layer.key==="fault");
  const faultQueryParams=new URLSearchParams({f:"json",returnGeometry:"false",outFields:"OBJECTID",
    geometry:JSON.stringify(faultGeometry),geometryType:"esriGeometryPolygon",inSR:"4326",
    spatialRel:"esriSpatialRelIntersects"});
  const faultResult=await json(layerUrl(faultLayer.url)+"/query?"+faultQueryParams);
  if(!(faultResult.features.length>0))
    throw contractFailure("known special-study-area parcel no longer intersects the fault study layer");
  return "intersects";
});

const informationalHazardParcels={
  liquefaction:"22062280160000",
  debris_flow:"22013760250000",
  alluvial_fan:"22013520360000"
};
for(const [layerKey,positiveParcelId] of Object.entries(informationalHazardParcels)){
  await contract("informational-hazard-"+layerKey,positiveParcelId,async()=>{
    const positiveParcelParams=new URLSearchParams({f:"json",returnGeometry:"true",outSR:"4326",
      outFields:"parcel_id,prop_location",where:CFG.parcel.idField+"='"+positiveParcelId+"'"});
    const positiveParcel=await json(layerUrl(CFG.parcel.url)+"/query?"+positiveParcelParams);
    const positiveGeometry=positiveParcel.features?.[0]?.geometry;
    if(!positiveGeometry)
      throw contractFailure(layerKey+" known-positive parcel geometry is unavailable");
    const layer=CFG.LAYERS.find(candidate=>candidate.key===layerKey);
    const positiveQueryParams=new URLSearchParams({f:"json",returnGeometry:"false",outFields:"*",
      geometry:JSON.stringify(positiveGeometry),geometryType:"esriGeometryPolygon",inSR:"4326",
      spatialRel:"esriSpatialRelIntersects"});
    const positiveResult=await json(layerUrl(layer.url)+"/query?"+positiveQueryParams);
    if(!(positiveResult.features.length>0))
      throw contractFailure(layerKey+" known-positive parcel no longer intersects the configured layer");
    return "intersects";
  });
}

const historicLayer=CFG.LAYERS.find(layer=>layer.key==="hist");
await contract("historic-designation",historicLayer.url,async()=>{
  const historicParams=new URLSearchParams({f:"json",where:"1=1",returnGeometry:"false",
    outFields:"name,designation_type,local_ordinance,listyear"});
  const historicResult=await json(layerUrl(historicLayer.url)+"/query?"+historicParams);
  const districts=new Map(historicResult.features.map(feature=>[
    feature.attributes.name,feature.attributes
  ]));
  const expect=(district,field,value)=>{
    const actual=districts.get(district)?.[field];
    if(actual!==value)
      throw contractFailure(district+" "+field+" is now "+JSON.stringify(actual)+
        ", expected "+JSON.stringify(value));
  };
  expect("Mountair Acres Subdivision Historic District","designation_type","Federal");
  expect("Mountair Acres Subdivision Historic District","local_ordinance","No");
  expect("Evergreen Avenue Historic District","designation_type","Federal and Local");
  expect("Evergreen Avenue Historic District","local_ordinance","Yes");
  return "National Register-only and local district still distinguishable";
});

await contract("short-term-rental-buffer",businessCFG.buffer.url,async()=>{
  const rentalParams=new URLSearchParams({f:"json",where:"1=1",returnGeometry:"false",
    outFields:businessCFG.rental.idField,resultRecordCount:"1"});
  const rentalResult=await json(layerUrl(businessCFG.rental.url)+"/query?"+rentalParams);
  const rentalParcelId=rentalResult.features?.[0]?.attributes?.[businessCFG.rental.idField];
  if(!rentalParcelId) throw contractFailure("published short-term-rental layer has no records");
  const rentalBufferParams=new URLSearchParams({f:"json",returnGeometry:"false",
    outFields:[businessCFG.buffer.originField,businessCFG.buffer.distanceField].join(","),
    where:businessCFG.buffer.originField+"='"+String(rentalParcelId).replaceAll("'","''")+"'"});
  const rentalBuffer=await json(layerUrl(businessCFG.buffer.url)+"/query?"+rentalBufferParams);
  if(!rentalBuffer.features?.length)
    throw contractFailure("known published rental has no matching buffer");
  // ArcGIS currently stores BUFF_DIST as 121.92024384 (400 feet expressed in
  // metres) even though its field alias says feet. Verify the geometry itself:
  // in the service's Utah Central feet coordinate system, every envelope side
  // extends about 400 feet beyond the originating rental parcel.
  const distanceValues=rentalBuffer.features.map(feature=>
    Number(feature.attributes[businessCFG.buffer.distanceField]));
  if(!distanceValues.every(value=>Math.abs(value-121.92024384)<0.01||Math.abs(value-400)<0.01))
    throw contractFailure("published buffer-distance attribute changed");
  const featureExtent=async(url,idField,id)=>{
    const extentParams=new URLSearchParams({f:"json",returnExtentOnly:"true",outSR:"102743",
      where:idField+"='"+String(id).replaceAll("'","''")+"'"});
    return (await json(layerUrl(url)+"/query?"+extentParams)).extent;
  };
  const [rentalExtent,bufferExtent]=await Promise.all([
    featureExtent(businessCFG.rental.url,businessCFG.rental.idField,rentalParcelId),
    featureExtent(businessCFG.buffer.url,businessCFG.buffer.originField,rentalParcelId)
  ]);
  if(!(rentalExtent&&bufferExtent))
    throw contractFailure("published rental or buffer extent is unavailable");
  const bufferMargins=[rentalExtent.xmin-bufferExtent.xmin,rentalExtent.ymin-bufferExtent.ymin,
    bufferExtent.xmax-rentalExtent.xmax,bufferExtent.ymax-rentalExtent.ymax];
  if(!bufferMargins.every(value=>value>=395&&value<=405))
    throw contractFailure("published short-term-rental geometry is not a 400-foot buffer");
  return "400-foot buffer geometry verified";
});

await contract("public-web-map-parity",CFG.referenceWebMap.itemId,async()=>{
  const webMapUrl=CFG.referenceWebMap.portalUrl+"/sharing/rest/content/items/"+
    CFG.referenceWebMap.itemId+"/data?f=json";
  const webMap=await json(webMapUrl);
  const leafLayers=[];
  const flatten=layers=>{
    for(const layer of layers||[]){
      if(layer.layers) flatten(layer.layers);
      else if(layer.url) leafLayers.push(layer);
    }
  };
  flatten(webMap.operationalLayers);
  const normalizeUrl=url=>new URL(url).href.replace(/\/$/,"").toLowerCase();
  const webMapUrls=new Set(leafLayers.map(layer=>normalizeUrl(layer.url)));
  const paritySpecs=[
    {key:"address",url:CFG.address.url},{key:"parcel",url:CFG.parcel.url},
    ...CFG.LAYERS.filter(layer=>layer.kind!=="femaFlood"),
    {key:"business-rental",url:businessCFG.rental.url},
    {key:"business-buffer",url:businessCFG.buffer.url}
  ];
  const absent=paritySpecs.filter(spec=>!webMapUrls.has(normalizeUrl(layerUrl(spec.url))))
    .map(spec=>spec.key);
  if(absent.length)
    throw contractFailure("not present in the configured public Planning web map: "+
      absent.join(", "));
  return paritySpecs.length+" adopted local layers verified";
});

/* One report, naming every contract that failed and why. Written whether the run
   passed or failed: a clean report is the evidence a release candidate needs, and
   the workflow uploads it either way. Sanitized by construction in
   service-contract-core.mjs — the parcel queries above use outFields=*, so owner
   names pass through this process and must never reach the file. */
const report=buildReport(checks,{generatedAt:new Date().toISOString()});
await writeFile(new URL("../service-contract-report.json",import.meta.url),
  JSON.stringify(report,null,2)+"\n","utf8");
const summary=renderSummary(report);
console.log("\n"+summary);
if(process.env.GITHUB_STEP_SUMMARY)
  await writeFile(process.env.GITHUB_STEP_SUMMARY,summary,{flag:"a"});
if(!report.ok){
  console.error(report.failed.length+" service contract(s) failed: "+
    report.contractFailures.length+" drift, "+report.transportFailures.length+" transport");
  process.exit(1);
}
