import { writeFile } from "node:fs/promises";
import { readApp, readBusinessApp } from "./app-config.mjs";
import { buildReport, classifyCheckFailure, classifyHttp, contractFailure, layerFieldList,
  parcelFieldList, pointInRings, probePoints, renderSummary, settleLayerChecks, transportFor,
  withRetry } from "./service-contract-core.mjs";

const {CFG}=await readApp();
const {CFG:businessCFG}=await readBusinessApp();
const timeoutMs=20_000;
const layerUrl=path=>/^https?:\/\//i.test(path)?path:CFG.org+path;

/* Transport failure is retried on a bounded backoff; anything the service says
   about its own data is not. An ArcGIS error body is a rejected query — a
   contract finding, not a bad connection — so it is raised as one and reported
   on the first attempt. See scripts/service-contract-core.mjs. */
/* Long queries go the same way the pages send them. A parcel boundary can push a
   query URL past the roughly 2,048 bytes the hosted service accepts, and it
   answers HTTP 404 above that. The pages now post those; if the monitor kept
   sending them as GET it would fail parcels the pages load fine, and — worse the
   other way round — a check that passed as GET would prove nothing about the
   transport a resident actually gets. transportFor() is the pages' own rule,
   read from the page's own CFG.request.maxUrlBytes. */
async function json(url){
  const {value}=await withRetry(async()=>{
    const mark=String(url).indexOf("?");
    const post=mark>=0&&transportFor(url,CFG)==="POST";
    const response=await fetch(post?String(url).slice(0,mark):url,
      {signal:AbortSignal.timeout(timeoutMs),
        headers:{Accept:"application/json",
          ...(post?{"Content-Type":"application/x-www-form-urlencoded"}:{})},
        ...(post?{method:"POST",body:String(url).slice(mark+1)}:{})});
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
    checks.push({key,ok:false,detail,
      failure:{kind:classifyCheckFailure(error),message:error?.message||String(error),
        attempts:error?.attempts||1}});
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
  {key:"parcel",url:CFG.parcel.url,fields:parcelFieldList(CFG)},
  ...CFG.LAYERS.map(layer=>({key:layer.key,url:layer.url,fields:layerFieldList(layer)})),
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
  const parcelParams=new URLSearchParams({f:"json",returnGeometry:"true",outSR:"4326",
    outFields:parcelFieldList(CFG).join(","),
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
  const oidField=layer.oidField||"OBJECTID";
  const spatialParams=new URLSearchParams({f:"json",returnGeometry:"false",
    outFields:layerFieldList(layer).join(","),
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
  if(layer.attachments&&result.features[0]?.attributes?.[oidField]!=null){
    const objectId=result.features[0].attributes[oidField];
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
    const queryParams=new URLSearchParams({f:"json",returnGeometry:"false",
      outFields:layerFieldList(layer).join(","),
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

/* A parcel whose boundary does not fit in a URL.
   -----------------------------------------------------------------------
   Verified 10 September 2026: parcel 16273550010000 encodes to a ~3,700-byte
   query, and every hosted polygon layer answered HTTP 404 to it as a GET while
   the identical parameters answered 200 as a form-urlencoded POST. About 12 of
   every 1,000 Millcreek parcels are over the limit, and for each of them the
   page showed "Temporarily unavailable" on every polygon-queried layer.

   This is a contract check, not a smoke test: it must never be retried or
   softened. An empty feature array is a real answer — it is the parcel not
   intersecting that layer — so what is required is that every polygon layer
   answers at all, and that at least one of them returns a feature, which is
   what a 404 could never do. */
const longGeometryParcelId="16273550010000";
const polygonLayers=CFG.LAYERS.filter(layer=>layer.geometryMode==="parcel");
let longGeometry=null;
await contract("long-geometry-parcel",longGeometryParcelId,async()=>{
  const longParams=new URLSearchParams({f:"json",returnGeometry:"true",outSR:"4326",
    outFields:"parcel_id,prop_location",where:CFG.parcel.idField+"='"+longGeometryParcelId+"'"});
  const longParcel=await json(layerUrl(CFG.parcel.url)+"/query?"+longParams);
  longGeometry=longParcel.features?.[0]?.geometry;
  if(!longGeometry)
    throw contractFailure("the long-geometry test parcel is no longer published");
  // A1-R02: settle every polygon layer instead of racing them in one Promise.all.
  // The old fail-fast race meant that when a transport error on one layer landed
  // at the same time as a malformed response on another, only whichever rejected
  // first was ever recorded — the other vanished, and which one survived depended
  // on timing. settleLayerChecks() waits for all of them, so every layer's own
  // failure is recorded here, under its own name and classification, before this
  // check says anything aggregate.
  const {failures,values}=await settleLayerChecks(polygonLayers,
    layer=>"long-geometry-parcel:"+layer.key,async layer=>{
      const longQueryParams=new URLSearchParams({f:"json",returnGeometry:"false",outFields:layerFieldList(layer).join(","),
        geometry:JSON.stringify(longGeometry),geometryType:"esriGeometryPolygon",inSR:"4326",
        spatialRel:"esriSpatialRelIntersects"});
      const result=await json(layerUrl(layer.url)+"/query?"+longQueryParams);
      if(!Array.isArray(result.features))
        throw contractFailure(layer.key+" returned no feature array for the long-geometry parcel");
      return result.features.length;
    });
  for(const failure of failures) checks.push({...failure,detail:longGeometryParcelId});
  if(failures.length)
    return failures.length+" of "+polygonLayers.length+
      " polygon layers failed - see the per-layer long-geometry-parcel: results above";
  if(!values.some(count=>count>0))
    throw contractFailure("no polygon layer returned a feature for the long-geometry parcel, "+
      "so an outage and a genuine 'no' cannot be told apart here");
  return polygonLayers.length+" polygon layers answered, "+
    values.reduce((total,count)=>total+count,0)+" features";
});

/* The boundary the check above depends on. If the test parcel's query stopped
   being long enough to need a POST — a re-drawn boundary, a shorter service
   path — the check would still pass while proving nothing, so say so instead.

   A1-R01: this only runs once the prerequisite above actually retrieved a
   geometry. When that fetch instead exhausted its retries on a transport
   failure, longGeometry stays null and this check used to run anyway, throwing
   its own contractFailure over data nothing had inspected — turning a service
   outage into what a reader saw as "Contract drift". The prerequisite's own
   check already carries the correct (transport) classification for that
   failure, so a missing geometry here is skipped, not re-reported as drift. */
if(longGeometry) await contract("long-geometry-transport",longGeometryParcelId,async()=>{
  const layer=polygonLayers[0];
  const boundaryParams=new URLSearchParams({f:"json",returnGeometry:"false",
    outFields:layerFieldList(layer).join(","),
    geometry:JSON.stringify(longGeometry),geometryType:"esriGeometryPolygon",inSR:"4326",
    spatialRel:"esriSpatialRelIntersects"});
  const fullUrl=layerUrl(layer.url)+"/query?"+boundaryParams;
  const bytes=new TextEncoder().encode(fullUrl).length;
  if(transportFor(fullUrl,CFG)!=="POST")
    throw contractFailure("the long-geometry parcel no longer exceeds CFG.request.maxUrlBytes ("+
      bytes+" bytes vs "+CFG.request.maxUrlBytes+"), so this parcel no longer tests the POST path");
  const limit=CFG.request.maxUrlBytes;
  const atLimit="https://example.test/"+"a".repeat(limit-"https://example.test/".length);
  if(transportFor(atLimit,CFG)!=="GET"||transportFor(atLimit+"a",CFG)!=="POST")
    throw contractFailure("transportFor no longer switches at exactly CFG.request.maxUrlBytes");
  return bytes+" bytes, over the "+limit+"-byte limit";
});
else skip("long-geometry-transport",
  "the long-geometry parcel prerequisite failed, so its geometry was never retrieved");

/* ==== ZONING COVERAGE (A3, 10 September 2026) =========================
   The page stopped reading zoning from the parcel's stored point and started
   reporting every designation that actually covers the property. Four things it
   now relies on are properties of the live services rather than of this code,
   so they are pinned here as contracts: never retried, never softened.

   Each check names the real parcel that motivated it, so a failure says which
   resident-facing sentence is now wrong. */
async function parcelRecord(id,fields="parcel_id,parcel_latitude,parcel_longitude"){
  const recordParams=new URLSearchParams({f:"json",returnGeometry:"true",outSR:"4326",
    outFields:fields,where:CFG.parcel.idField+"='"+String(id).replaceAll("'","''")+"'"});
  return (await json(layerUrl(CFG.parcel.url)+"/query?"+recordParams)).features?.[0]||null;
}
const zoneLayer=CFG.LAYERS.find(layer=>layer.key==="zone");
const zoneKeyField=zoneLayer.designationKey;
const zoneOidField=zoneLayer.oidField||"OBJECTID";
async function zoneQuery(extra){
  const zoneParams=new URLSearchParams({f:"json",returnGeometry:"false",inSR:"4326",...extra});
  const result=await json(layerUrl(zoneLayer.url)+"/query?"+zoneParams);
  if(!Array.isArray(result.features))
    throw contractFailure("the zoning layer returned no feature array");
  return result.features.map(feature=>feature.attributes);
}
const zoneKeys=features=>new Set(features
  .map(attributes=>String(attributes[zoneKeyField]||"").trim()).filter(Boolean));
const zoneOids=features=>new Set(features.map(attributes=>String(attributes[zoneOidField])));

/* The ordinary case, and the one the page's plainest sentence rests on: one
   district, containing the whole property. If Within stopped answering here,
   "All of this property is in the R-1-8 zoning district." would silently become
   "This property is in ..." for every parcel in the city. */
const coverageParcelId="16261060200000";
await contract("zoning-coverage-known-parcel",coverageParcelId,async()=>{
  const feature=await parcelRecord(coverageParcelId);
  if(!feature?.geometry) throw contractFailure("the zoning coverage test parcel is no longer published");
  const geometry=JSON.stringify(feature.geometry);
  const intersects=await zoneQuery({geometry,geometryType:"esriGeometryPolygon",
    spatialRel:"esriSpatialRelIntersects",outFields:zoneKeyField+","+zoneOidField});
  const within=await zoneQuery({geometry,geometryType:"esriGeometryPolygon",
    spatialRel:"esriSpatialRelWithin",outFields:zoneOidField});
  const keys=zoneKeys(intersects);
  if(keys.size!==1)
    throw contractFailure("this parcel now touches "+keys.size+
      " zoning designations, not one: "+[...keys].join(", "));
  if(within.length!==1)
    throw contractFailure("Within no longer returns exactly one district containing "+
      "this parcel ("+within.length+"), so the whole-parcel sentence is unfounded");
  const [containedOid]=[...zoneOids(within)];
  if(!zoneOids(intersects).has(containedOid))
    throw contractFailure("the district Within returned is not among the districts "+
      "Intersects returned, so the object-id join no longer holds");
  return [...keys][0]+" contains the whole parcel";
});

/* The boundary case that this whole feature exists for. The zoning map draws a
   C-2 boundary along this parcel; a stored point can only ever name one of the
   two, and the edge touch must be reported as an unconfirmed touch rather than
   as a second district or as nothing at all. Two candidates, one probe-confirmed
   and none containing the whole parcel is exactly the evidence the page reads as
   `present` with one unconfirmed candidate. */
const overlapParcelId="16263780070000";
await contract("zoning-boundary-overlap",overlapParcelId,async()=>{
  const feature=await parcelRecord(overlapParcelId);
  if(!feature?.geometry) throw contractFailure("the boundary-overlap test parcel is no longer published");
  const geometry=JSON.stringify(feature.geometry);
  const probes=probePoints(feature.geometry,CFG.coverage,
    [feature.attributes[CFG.parcel.lonField],feature.attributes[CFG.parcel.latField]]);
  if(!probes.length)
    throw contractFailure("no probe point falls inside the boundary-overlap parcel, "+
      "so this parcel no longer exercises the polygon path");
  const intersects=await zoneQuery({geometry,geometryType:"esriGeometryPolygon",
    spatialRel:"esriSpatialRelIntersects",outFields:zoneKeyField+","+zoneOidField});
  const probed=await zoneQuery({geometry:JSON.stringify({points:probes,
    spatialReference:{wkid:4326}}),geometryType:"esriGeometryMultipoint",
    spatialRel:"esriSpatialRelIntersects",outFields:zoneOidField});
  const within=await zoneQuery({geometry,geometryType:"esriGeometryPolygon",
    spatialRel:"esriSpatialRelWithin",outFields:zoneOidField});
  const candidates=zoneKeys(intersects);
  if(candidates.size!==2)
    throw contractFailure("this parcel now touches "+candidates.size+
      " zoning designations, not two: "+[...candidates].join(", "));
  const keyByOid=new Map(intersects.map(attributes=>
    [String(attributes[zoneOidField]),String(attributes[zoneKeyField]||"").trim()]));
  const confirmed=new Set([...zoneOids(probed)].map(oid=>keyByOid.get(oid)).filter(Boolean));
  if(confirmed.size!==1)
    throw contractFailure("the probes now confirm "+confirmed.size+
      " of the two designations, not one, so the unconfirmed-touch sentence no longer applies");
  if(within.length!==0)
    throw contractFailure("Within now returns "+within.length+
      " districts for a parcel the zoning boundary crosses");
  return [...confirmed][0]+" confirmed, "+
    [...candidates].filter(key=>!confirmed.has(key))[0]+" an unconfirmed touch";
});

/* The parcel that used to read "Not in this area". Its stored point falls in a
   gap in the zoning map while the parcel itself plainly intersects a district.
   Both halves are asserted: if the point started matching, this parcel would
   stop proving that the point-based answer was wrong. */
const gapParcelId="15353000130000";
await contract("zoning-gap-parcel",gapParcelId,async()=>{
  const feature=await parcelRecord(gapParcelId);
  if(!feature?.geometry) throw contractFailure("the zoning-gap test parcel is no longer published");
  const lonValue=feature.attributes[CFG.parcel.lonField];
  const latValue=feature.attributes[CFG.parcel.latField];
  const atPoint=await zoneQuery({geometry:String(lonValue)+","+String(latValue),
    geometryType:"esriGeometryPoint",spatialRel:"esriSpatialRelIntersects",
    outFields:zoneKeyField+","+zoneOidField});
  const overParcel=await zoneQuery({geometry:JSON.stringify(feature.geometry),
    geometryType:"esriGeometryPolygon",spatialRel:"esriSpatialRelIntersects",
    outFields:zoneKeyField+","+zoneOidField});
  if(atPoint.length!==0)
    throw contractFailure("the stored point of this parcel now matches a zoning "+
      "district, so it no longer demonstrates the gap the polygon query fixes");
  const keys=zoneKeys(overParcel);
  if(keys.size<1)
    throw contractFailure("the parcel boundary no longer intersects any zoning district, "+
      "so this parcel would still have no zoning answer");
  return "point 0, polygon "+keys.size+" ("+[...keys].join(", ")+")";
});

/* Which way esriSpatialRelWithin points.

   The REST reference does not say, and getting it backwards would invert the
   page's most confident sentence: "All of this property is in X" would be
   published for districts that merely sit inside the parcel. A 4 m square inside
   a known parcel settles it against the live service - the parcel comes back
   under Within (the geometry sent is within the feature returned) and not under
   Contains. The square is built from the parcel's own stored point and verified
   to be inside the boundary before it is used, so a re-drawn parcel reports a
   contract failure rather than proving nothing. */
await contract("spatial-relation-direction",coverageParcelId,async()=>{
  const feature=await parcelRecord(coverageParcelId);
  if(!feature?.geometry) throw contractFailure("the spatial-relation test parcel is no longer published");
  const lonValue=Number(feature.attributes[CFG.parcel.lonField]);
  const latValue=Number(feature.attributes[CFG.parcel.latField]);
  if(!(Number.isFinite(lonValue)&&Number.isFinite(latValue)))
    throw contractFailure("the spatial-relation test parcel has no usable stored point");
  const round=value=>Number(value.toFixed(CFG.coverage.coordDecimals));
  let square=null;
  for(const metres of [2,1,0.5]){
    const halfLat=metres/111320;
    const halfLon=metres/(111320*Math.cos(latValue*Math.PI/180));
    const corners=[[round(lonValue-halfLon),round(latValue-halfLat)],
      [round(lonValue+halfLon),round(latValue-halfLat)],
      [round(lonValue+halfLon),round(latValue+halfLat)],
      [round(lonValue-halfLon),round(latValue+halfLat)]];
    if(corners.every(([x,y])=>pointInRings(feature.geometry.rings,x,y))){
      square={rings:[[...corners,corners[0]]],spatialReference:{wkid:4326}};
      break;
    }
  }
  if(!square)
    throw contractFailure("no small square around the stored point falls inside this "+
      "parcel any more, so the relation direction cannot be tested here");
  const parcelRelation=async relation=>{
    const relationParams=new URLSearchParams({f:"json",returnGeometry:"false",inSR:"4326",
      geometry:JSON.stringify(square),geometryType:"esriGeometryPolygon",
      spatialRel:relation,outFields:CFG.parcel.idField});
    const result=await json(layerUrl(CFG.parcel.url)+"/query?"+relationParams);
    if(!Array.isArray(result.features))
      throw contractFailure(relation+" returned no feature array");
    return result.features.map(f=>String(f.attributes[CFG.parcel.idField]));
  };
  const [within,contains]=await Promise.all([
    parcelRelation("esriSpatialRelWithin"),parcelRelation("esriSpatialRelContains")]);
  if(!within.includes(coverageParcelId))
    throw contractFailure("esriSpatialRelWithin no longer returns the parcel a small "+
      "square inside it sits in, so the whole-parcel query means something else now");
  if(contains.includes(coverageParcelId))
    throw contractFailure("esriSpatialRelContains now also returns that parcel, so the "+
      "two relations no longer distinguish the direction the page depends on");
  return "Within returns the containing parcel; Contains does not";
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
    const positiveQueryParams=new URLSearchParams({f:"json",returnGeometry:"false",
      outFields:layerFieldList(layer).join(","),
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
   service-contract-core.mjs — the parcel query above still explicitly requests
   ownerField and careOfField, so owner names pass through this process and must
   never reach the file. */
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
