import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const address={
  FullAdd:"3300 E SANTA ROSA AVE", ParcelID:"16264570030000",
  City:"MILLCREEK", ZipCode:"84109", UnitType:null, UnitID:null
};

function parcel(overrides={}){
  return {
    parcel_id:address.ParcelID, prop_location:address.FullAdd,
    parcel_latitude:40.699, parcel_longitude:-111.815,
    parcel_acres:0.25, property_type_code:"RES", year_built:1978,
    total_sq_ft:0, num_housing_units:0, tax_dist:"MC", prop_zip:"84109",
    own_name:"ALEX EXAMPLE (JT); CASEY EXAMPLE (JT)", care_of:"",
    flood_zone:"X", in_wui:"No", sensitive_land:"No", is_historic:"No",
    slc_link:"https://example.test/assessor", ...overrides
  };
}

/* Every fixture feature carries a stable, distinct object id under its layer's
   configured id field (A8). The coverage queries join Q2 and Q3 back to Q1 by
   object id alone, so fixtures that all answered to id 1 would make every join
   succeed and every coverage assertion vacuous. */
const layerFeatures={
  Zone_Update_2025___Related_Master:[{OBJECTID:101,ZONE_:"R-1-8",
    Category:"Single-Household Residential",
    Zone_Desc1:"R-1-8 zoning is designated for low density, single-household development "+
      "within Millcreek.",
    CodeRef:"18.36",
    CodebookURL:"https://millcreek.municipalcodeonline.com/book?type=planzone#name=18.36_R-1-8_Zone"}],
  FutureLandUse_2024_Millcreek:[{OBJECTID:201,LandUse:"Neighborhood 1",
    GENPLAN_WEBSITE:"https://example.test/plan",
    GENPLAN_DOCUMENT:"https://example.test/document"}],
  HistoricDistricts:[], Zone_TCOZ:[], WUI:[], Sensitive_Land_Areas__Feb24:[],
  Subdivision_Dissovle_3:[{OBJECTID:7,SUB_PLAT:"EL SERRITO 2",PLAT_NUM:"22"}],
  FEMA_NFHL:[
    {OBJECTID:301,FLD_ZONE:"X",ZONE_SUBTY:"AREA OF MINIMAL FLOOD HAZARD",SFHA_TF:"F",
      STATIC_BFE:-9999,LEN_UNIT:"Feet",SOURCE_CIT:"Mock FIRM"},
    {OBJECTID:302,FLD_ZONE:"AE",ZONE_SUBTY:"FLOODWAY",SFHA_TF:"T",
      STATIC_BFE:4387,LEN_UNIT:"Feet",SOURCE_CIT:"Mock FIRM"}
  ],
  Flood_Hazard_Zones_Final_Update:[
    {OBJECTID:311,FLD_ZONE:"AE",ZONE_SUBTY:"Floodway",SFHA_TF:"T"}
  ],
  Fault_Study_Area:[],
  LiquefactionPotential:[
    {OBJECTID:401,POTENTIAL:"Moderate",Lqf_Desc:"Moderate published potential."},
    {OBJECTID:402,POTENTIAL:"High",Lqf_Desc:"High published potential."}
  ],
  DebrisFlow_WasatchFront_ClipBuffer:[{OBJECTID:31,Hazard:"Debris Flow"}],
  AlluvialFans:[{OBJECTID:41,GEODESCSHORT:"Fan alluvium"}],
  // OBJECTID_12 -> this layer's object id field is not the ArcGIS default;
  // see OID_FIELD_BY_SERVICE.
  Millcreek_City_Council_Dist_2022:[{OBJECTID_12:12,DIST:"1",COUNCILMEMBER:"Example Member",
    WEB:"https://example.test/council"}],
  TrashPickupDays:[{OBJECTID:501,PickupDay:"Tuesday",phonenumberfix:"385-468-6325",
    websitelink:"https://example.test/waste"}],
  SewerDistrictsUpdated:[{OBJECTID:502,District:"Mount Olympus Improvement District",
    Phone:"801-262-2904"}],
  Water_Services_2021:[{OBJECTID:503,DWNAME:"Salt Lake City Water System",phone:"801-483-6900",
    webpublic:"https://example.test/water"}],
  Electrical_Service:[{OBJECTID:504,PROVIDER:"Rocky Mountain Power",TELEPHONE:"1-888-221-7070",
    WEBLINK:"https://example.test/power",NOTES:""}]
};

/* The three coverage services, by fixture name, so a scenario can be written
   against the layer a reader recognises. */
const ZONE="Zone_Update_2025___Related_Master";
const FUTURE="FutureLandUse_2024_Millcreek";
const CCOZ="Zone_TCOZ";

/* Which of a coverage layer's three queries a request is.

   The page asks each coverage layer the same layer URL three times and the only
   difference is in the parameters, so the mock has to read them: the multipoint
   geometry is the probe query, `esriSpatialRelWithin` is the whole-parcel query,
   and everything else is the candidate query. A point geometry is the fallback
   the page uses when there is no usable boundary. */
function queryRole(params){
  const geometryType=params.get("geometryType")||"";
  const spatialRel=params.get("spatialRel")||"";
  if(geometryType==="esriGeometryMultipoint") return "probe";
  if(spatialRel==="esriSpatialRelWithin") return "within";
  if(geometryType==="esriGeometryPoint") return "point";
  return "intersects";
}

/* A layer's answers per role, with the defaults that keep every pre-existing
   test meaning what it meant: the probe query returns what the candidate query
   returns, and the whole-parcel query returns the single candidate when there is
   exactly one and nothing when the map is ambiguous. */
function roleFeaturesFor(name,base,state){
  const scenario=(state.coverage||{})[name]||{};
  const candidates=scenario.intersects?[...scenario.intersects]:base;
  return {
    scenario,
    intersects:candidates,
    probe:scenario.probe?[...scenario.probe]:candidates,
    within:scenario.within?[...scenario.within]:(candidates.length===1?candidates:[]),
    point:scenario.point?[...scenario.point]:candidates
  };
}

function serviceName(pathname){
  if(pathname.includes("/public/NFHL/MapServer/28")) return "FEMA_NFHL";
  if(pathname.includes("Millcreek_Wildland_Urban_Interface")) return "WUI";
  const match=pathname.match(/\/services\/([^/]+)\/FeatureServer/i);
  return match?.[1]||"";
}

/* The two layers whose object id field is not the ArcGIS default "OBJECTID" —
   verified 10 September 2026 against the live service metadata, same as the
   `oidField` entries in index.html's CFG.LAYERS. Kept here too so the mock and
   the assertions below agree on what each layer's query must ask for. */
const OID_FIELD_BY_SERVICE={Zone_TCOZ:"OBJECTID_1",Millcreek_City_Council_Dist_2022:"OBJECTID_12"};
const oidFieldFor=name=>OID_FIELD_BY_SERVICE[name]||"OBJECTID";

// What a /query request actually asked for, GET or POST alike.
function outFieldsOf(request){
  const params=request.method==="POST"
    ? new URLSearchParams(request.body)
    : new URL(request.url).searchParams;
  return params.get("outFields")||"";
}

/* The real ArcGIS service only returns what outFields asked for. Filtering the
   fixture the same way turns "the page rendered a field it never requested"
   into a failing test instead of a silent pass — outFields=* is exactly what
   used to hide that.

   By default a fixture feature that omits its object id still gets one here
   (`?? 1`), so most fixtures do not have to spell out an id they do not care
   about. A3-R01 specifically needs the opposite: a feature the live service
   returned with no readable object id, or no readable attributes at all, so
   that the page's own handling of an unidentifiable match can be exercised
   rather than the mock quietly making every match identifiable. Passing
   `{synthesizeOid:false}` (wired to `state.noOidSynthesis` below) turns that
   synthesis off. */
function filterAttributes(attributes,outFieldsParam,oidField,{synthesizeOid=true}={}){
  const requested=new Set(String(outFieldsParam||"").split(",").map(field=>field.trim()).filter(Boolean));
  const filtered={};
  for(const [field,value] of Object.entries(attributes))
    if(requested.has(field)) filtered[field]=value;
  if(synthesizeOid&&requested.has(oidField)&&!(oidField in filtered))
    filtered[oidField]=attributes[oidField]??1;
  return filtered;
}

/* The hosted ArcGIS service answers HTTP 404 to a GET whose full URL passes about
   2,048 bytes — verified against the live service on 10 September 2026 — so the
   fixture does too. Without this the mock would answer a request the real service
   refuses, and the transport tests below would pass on a broken page. */
const SERVICE_URL_LIMIT=2048;

async function mockArcGIS(page,state={}){
  const requests=state.requests||(state.requests=[]);
  await page.route("**/arcgis/rest/services/**",async route=>{
    const request=route.request();
    const method=request.method();
    const body=request.postData()||"";
    requests.push({method,url:request.url(),body});
    if(method==="GET"&&Buffer.byteLength(request.url(),"utf8")>SERVICE_URL_LIMIT)
      return route.fulfill({status:404,body:"URL too long"});
    const url=new URL(request.url());
    const path=url.pathname;
    const name=serviceName(path);
    const json=body=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
    // A2: no query anywhere may ask for outFields=*, so the fixture only
    // returns what was actually requested — see filterAttributes() above.
    const outFieldsParam=(method==="POST"?new URLSearchParams(body):url.searchParams).get("outFields");

    if(path.endsWith("/attachments")){
      if(state.attachmentFailure) return route.fulfill({status:500,body:"temporary failure"});
      // Some services omit `size`. Math.round(undefined/1024) renders "NaN KB".
      if(state.attachmentWithoutSize)
        return json({attachmentInfos:[{id:9,name:"El Serrito 2.pdf",contentType:"application/pdf"}]});
      return json({attachmentInfos:[{id:9,name:"El Serrito 2.pdf",contentType:"application/pdf",size:2472960}]});
    }
    if(path.endsWith("/query")){
      // One named layer answers with a server error, so a degraded result set can be
      // exercised: the other layers still render and the page reports the gap.
      if(state.layerFailure&&name===state.layerFailure)
        return route.fulfill({status:500,body:"temporary layer failure"});
      if(name==="Address_Points"){
        // Address suggestion and parcel record queries are exempt from the
        // per-layer object id rule (they are asserted separately below), so
        // "OBJECTID" here only matters if a fixture happens to carry one.
        const filterAddress=attributes=>filterAttributes(attributes,outFieldsParam,"OBJECTID");
        // ArcGIS caps a result set at resultRecordCount and reports the cap with
        // exceededTransferLimit. Real streets exceed the cap: "Santa Rosa" matches 49.
        if(state.addressOverflow) return json({
          features:Array.from({length:10},(unused,index)=>({attributes:filterAddress({...address,
            FullAdd:"33"+index+"0 E SANTA ROSA AVE",
            ParcelID:"1626457003000"+index})})),
          exceededTransferLimit:true
        });
        if(state.cappedToOneUsableMatch) return json({
          features:[{attributes:filterAddress(address)},
            ...Array.from({length:9},()=>({attributes:filterAddress({...address,ParcelID:null})}))],
          exceededTransferLimit:true
        });
        return json({features:[{attributes:filterAddress(address)}]});
      }
      if(name==="Millcreek_Parcels"){
        if(state.delayParcel) await new Promise(resolve=>setTimeout(resolve,state.delayParcel));
        if(state.parcelNotFound) return json({features:[]});
        const feature={attributes:filterAttributes(parcel(state.parcel),outFieldsParam,"OBJECTID")};
        if(!state.omitParcelGeometry) feature.geometry=state.geometry||{rings:[[
          [-111.816,40.698],[-111.814,40.698],[-111.814,40.700],
          [-111.816,40.700],[-111.816,40.698]
        ]],spatialReference:{wkid:4326}};
        return json({features:[feature]});
      }
      let features=[...(layerFeatures[name]||[])];
      if(name==="FEMA_NFHL" && state.femaFeatures) features=[...state.femaFeatures];
      if(name==="Flood_Hazard_Zones_Final_Update" && state.cityFloodFeatures)
        features=[...state.cityFloodFeatures];
      if(name==="HistoricDistricts" && state.historicFeatures) features=[...state.historicFeatures];
      if(name==="Fault_Study_Area" && state.faultFeatures) features=[...state.faultFeatures];
      if(name==="Water_Services_2021" && state.multipleWater)
        features.push({OBJECTID:599,DWNAME:"Overlapping Provider",phone:"801-555-0100",
          webpublic:"https://example.test/overlap"});
      const oidField=oidFieldFor(name);
      const queryParams=method==="POST"?new URLSearchParams(body):url.searchParams;
      const role=queryRole(queryParams);
      const roles=roleFeaturesFor(name,features,state);
      const scenario=roles.scenario;
      /* A fixture entry of `null` is a feature the service returned with no
         `attributes` object at all — `{features:[{}]}`, the response COV-001 was
         found on. Every other entry is shaped the usual way. Without this the
         mock could not express an unreadable match, only an empty one, and the
         page's handling of the difference could not be tested at all. */
      const shape=list=>list.map(attributes=>
        attributes===null?{}:({attributes:filterAttributes(attributes,outFieldsParam,oidField,
          {synthesizeOid:!state.noOidSynthesis})}));
      // A query the service rejects outright.
      if(scenario.delayMs&&(scenario.delayRole||"intersects")===role)
        await new Promise(resolve=>setTimeout(resolve,scenario.delayMs));
      if((scenario.fail||{})[role])
        return route.fulfill({status:500,body:"temporary "+role+" failure"});
      // A 200 whose body carries no `features` array. The page must read this as
      // a failed query, never as "no features" — that is the false negative the
      // whole feature exists to prevent.
      if((scenario.malformed||{})[role])
        return json({objectIdFieldName:oidField,fields:[]});
      // Truncated responses. Each entry is one page: {features, more}. `more`
      // sets exceededTransferLimit, which is what makes the page ask again.
      const pages=(scenario.pages||{})[role];
      if(pages){
        const counts=state.pageCounts||(state.pageCounts={});
        const countKey=name+":"+role;
        const index=counts[countKey]||0;
        counts[countKey]=index+1;
        const page=pages[Math.min(index,pages.length-1)];
        return json({features:shape(page.features||[]),
          exceededTransferLimit:page.more!==false});
      }
      return json({features:shape(roles[role])});
    }

    if(name==="Millcreek_Parcels"&&state.parcelSchemaFailure)
      return route.fulfill({status:500,body:"temporary metadata failure"});

    const sample=name==="Address_Points" ? address :
      (name==="Millcreek_Parcels" ? parcel(state.parcel) : (layerFeatures[name]?.[0]||{OBJECTID:1}));
    const extra=["OBJECTID","FullAdd","ParcelID","AddNum","StreetName","City","ZipCode","UnitType","UnitID",
      "parcel_id","parcel_latitude","parcel_longitude","prop_location","parcel_acres","property_type_code",
      "year_built","total_sq_ft","num_housing_units","tax_dist","prop_zip","flood_zone","in_wui",
      "sensitive_land","is_historic","own_name","care_of","slc_link"];
    const names=[...new Set([...Object.keys(sample),...extra])];
    return json({fields:names.map(field=>({name:field,alias:field,domain:null}))});
  });
  return requests;
}

async function loadKnownProperty(page){
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await expect(page.locator("#sugg")).toBeVisible();
  await page.locator("#q").press("ArrowDown");
  await page.locator("#q").press("Enter");
  await expect(page.locator("#results")).toBeVisible();
}

test.beforeEach(async({page})=>{
  await mockArcGIS(page,{});
  await page.goto("/index.html");
  await page.evaluate(()=>{ CFG.request.retryDelayMs=1; });
});

test("shows the official Millcreek identity and city homepage link",async({page})=>{
  await expect(page.locator(".brand-logo")).toHaveAttribute("alt","Millcreek city logo");
  expect(await page.locator(".brand-logo").evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  await expect(page.getByRole("link",{name:"Millcreek city homepage"}))
    .toHaveAttribute("href","https://millcreekut.gov/");
});

test("initial and populated views have no detectable axe violations",async({page})=>{
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await loadKnownProperty(page);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
});

test("lookup preserves zeroes and copy includes links, notes, and disclaimer",async({page})=>{
  await loadKnownProperty(page);
  await expect(page.locator("#results-body")).toContainText("Building area (sq ft)0");
  await expect(page.locator("#results-body")).toContainText("About this data.");
  await page.locator("#copy").click();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  expect(copied).toContain("Building area (sq ft): 0");
  expect(copied).toContain("About this data.");
  expect(copied).toContain("https://example.test/water");
  expect(copied).toContain("DISCLAIMER");
  // The point of this assertion is that the copied output carries the disclaimer, not
  // that it carries one particular sentence. "not a zoning verification letter" was
  // replaced on 13 August by a list — official determination, permit decision, survey,
  // title report, zoning verification, flood determination — so pin the clause that
  // governs the whole list.
  expect(copied).toContain("an official determination");
});

/* The Assessor stores several owners in one field, separated by semicolons, with
   tenancy codes like "(JT)". A screen reader reads that as one run-on string, so it
   becomes a real list with the codes expanded. Nothing asserted this, which is also
   what let the field itself go unverified. */
test("multiple owners of record become a list with tenancy codes expanded",async({page})=>{
  await loadKnownProperty(page);
  const owners=page.locator(".pair",{hasText:"Owners of record"});
  await expect(owners.locator("li")).toHaveCount(2);
  await expect(owners.locator("li").first()).toHaveText("ALEX EXAMPLE — joint tenants");
  await expect(owners.locator("li").last()).toHaveText("CASEY EXAMPLE — joint tenants");
  await expect(page.getByRole("link",{name:"Salt Lake County Assessor"}))
    .toHaveAttribute("href","https://example.test/assessor");
});

test("a single owner is labelled in the singular and care-of is shown",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{parcel:{own_name:"ALEX EXAMPLE (TR)",care_of:"EXAMPLE TRUST"}});
  await page.reload();
  await loadKnownProperty(page);
  const owner=page.locator(".pair",{hasText:"Owner of record"});
  await expect(owner).toContainText("ALEX EXAMPLE — trustee");
  await expect(owner).toContainText("Care of: EXAMPLE TRUST");
  await expect(owner.locator("li")).toHaveCount(0);
});

// A vanished owner field must not take the rest of the result down with it.
test("a missing owner field leaves the remaining parcel record intact",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{parcel:{own_name:null,care_of:null,slc_link:null}});
  await page.reload();
  await loadKnownProperty(page);
  await expect(page.locator("#results-body")).toContainText("3300 E SANTA ROSA AVE");
  await expect(page.locator("#results-body")).not.toContainText("Owner of record");
  await expect(page.getByRole("link",{name:"Salt Lake County Assessor"})).toHaveCount(0);
});

test("a missing FEMA classification is Unknown rather than No",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{femaFeatures:[]});
  await page.reload();
  await loadKnownProperty(page);
  const row=page.locator(".pair",{hasText:"In FEMA Special Flood Hazard Area"});
  await expect(row).toContainText("Unknown — verify with staff");
});

test("FEMA results display the highest intersecting flood subtype",async({page})=>{
  await loadKnownProperty(page);
  await expect(page.locator(".pair",{hasText:"Highest FEMA flood zone"})).toContainText("AE");
  await expect(page.locator(".pair",{hasText:"Highest FEMA flood subtype"})).toContainText("FLOODWAY");
  await expect(page.locator(".pair",{hasText:"In FEMA Special Flood Hazard Area"})).toContainText("Yes");
  await expect(page.locator(".pair",{hasText:"Millcreek flood layer matches live FEMA"})).toContainText("Yes");
  await expect(page.locator("#results-body")).toContainText("AREA OF MINIMAL FLOOD HAZARD");
});

test("FEMA and Millcreek flood discrepancies are visible",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{cityFloodFeatures:[
    {FLD_ZONE:"X",ZONE_SUBTY:"0.2 Percent Annual Chance Flood Hazard",SFHA_TF:"F"}
  ]});
  await page.reload();
  await loadKnownProperty(page);
  await expect(page.locator(".pair",{hasText:"Millcreek flood layer matches live FEMA"})).toContainText("No");
  await expect(page.locator("#results-body")).toContainText("Review this flood mapping discrepancy");
  await expect(page.locator("#status")).toContainText("data source issue");
});

test("fault hazard reports the special study area rather than fault proximity",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{faultFeatures:[{OBJECTID:1,SFRHazardLabel:"Surface Fault Rupture"}]});
  await page.reload();
  await loadKnownProperty(page);
  const fault=page.locator(".pair",{hasText:"In the UGS surface fault rupture special study area"});
  await expect(fault).toContainText("Yes");
  await expect(page.locator("#results-body")).not.toContainText("mapped Quaternary fault");
});

test("informational hazards are full-parcel screens and highest liquefaction is shown",async({page})=>{
  await loadKnownProperty(page);
  const card=page.locator(".card",{has:page.locator("h3",{hasText:"Informational hazard screening"})});
  await expect(card).toContainText("Highest mapped liquefaction potential — CategoryHigh");
  await expect(card.locator(".pair",{hasText:"Intersects a mapped debris-flow screening area"})).toContainText("Yes");
  await expect(card.locator(".pair",{hasText:"Intersects mapped alluvial-fan deposits"})).toContainText("Yes");
  // Short on purpose — disclaimer prose is under legal review and was reworded twice
  // on 13 August. See the matching note in tests/unit.test.mjs.
  await expect(card).toContainText("for information only");
  await expect(card).toContainText("highest configured category is displayed");
});

test("historic results distinguish local ordinance and National Register status",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{historicFeatures:[{name:"Mountair Acres Subdivision Historic District",
    designation_type:"Federal",local_ordinance:"No",listyear:2025,
    maplink:"https://example.test/mountair"}]});
  await page.reload();
  await loadKnownProperty(page);
  const historic=page.locator(".card",{has:page.locator("h3",{hasText:"Historic designation"})});
  await expect(historic).toContainText("Designation typeFederal");
  await expect(historic).toContainText("Local ordinance appliesNo");
  await expect(historic).toContainText("National Register listing year2025");

  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{historicFeatures:[{name:"Evergreen Avenue Historic District",
    designation_type:"Federal and Local",local_ordinance:"Yes",listyear:2007,
    maplink:"https://example.test/evergreen"}]});
  await page.reload();
  await loadKnownProperty(page);
  const localHistoric=page.locator(".card",{has:page.locator("h3",{hasText:"Historic designation"})});
  await expect(localHistoric).toContainText("Designation typeFederal and Local");
  await expect(localHistoric).toContainText("Local ordinance appliesYes");
  await expect(localHistoric).toContainText("National Register listing year2007");
});

test("leaving the combobox closes its suggestions",async({page})=>{
  await page.locator("#q").fill("3300 East");
  await expect(page.locator("#sugg")).toBeVisible();
  await page.locator("#q").press("Tab");
  await expect(page.locator("#sugg")).toBeHidden();
  await expect(page.locator("#q")).toHaveAttribute("aria-expanded","false");
});

test("a capped address list is announced as partial, with how to narrow it",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{addressOverflow:true});
  await page.reload();
  await page.locator("#q").fill("Santa Rosa");
  await expect(page.locator("#sugg li")).toHaveCount(10);
  await expect(page.locator("#status")).toContainText("Showing the first 10 matches");
  await expect(page.locator("#status")).toContainText("More addresses match");
  await expect(page.locator("#status")).toContainText("narrow the list");
});

test("an uncapped address list is not announced as partial",async({page})=>{
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await expect(page.locator("#sugg li")).toHaveCount(1);
  await expect(page.locator("#status")).toContainText("1 address match");
  await expect(page.locator("#status")).not.toContainText("Showing the first");
});

// Submitting free text auto-loads a lone match. When the service capped the result
// and only one row survived the parcel-ID filter, that lone row is not "the" match.
test("submitting does not auto-load a lone survivor of a capped result",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{cappedToOneUsableMatch:true});
  await page.reload();
  await page.evaluate(()=>{ CFG.request.suggestDebounceMs=60_000; });
  await page.locator("#q").fill("Santa Rosa");
  await page.locator("#go").click();
  await expect(page.locator("#status")).toContainText("More addresses match");
  await expect(page.locator("#results")).toBeHidden();
});

// A hardcoded 250 ms makes timing-sensitive races untestable: on slow CI the timer
// fires and the assertion passes for the wrong reason.
test("the suggestion debounce delay honours its configuration",async({page})=>{
  await page.evaluate(()=>{ CFG.request.suggestDebounceMs=60_000; });
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await page.waitForTimeout(750);
  await expect(page.locator("#sugg")).toBeHidden();
  await expect(page.locator("#q")).toHaveAttribute("aria-expanded","false");
});

test("a pointer click on an address suggestion loads that property",async({page})=>{
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await expect(page.locator("#sugg li")).toHaveCount(1);
  await page.locator("#sugg li").click();
  await expect(page.locator("#results")).toBeVisible();
  await expect(page.locator("#r-head")).toContainText("3300 E SANTA ROSA AVE");
});

/* This page already owns its ticket correctly — the input event claims it, not the
   debounced search. These two characterize that so the behaviour survives the move
   to shared modules; the identical tests failed on the licensing page before it was
   restructured to match. */
test("a suggestion pending when an address is chosen by keyboard does not abort the lookup",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{delayParcel:1500});
  await page.reload();
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await expect(page.locator("#sugg li")).toHaveCount(1);
  await page.evaluate(()=>{
    CFG.request.suggestDebounceMs=50;
    const q=document.querySelector("#q");
    const key=name=>q.dispatchEvent(new KeyboardEvent("keydown",{key:name,bubbles:true,cancelable:true}));
    q.value=q.value+" ";
    q.dispatchEvent(new Event("input",{bubbles:true}));
    key("ArrowDown");
    key("Enter");
  });
  await expect(page.locator("#results")).toBeVisible({timeout:8000});
  await expect(page.locator("#status")).toContainText("Results ready");
});

test("a request whose task was already superseded is never sent",async({page})=>{
  let requests=0;
  await page.route("**/superseded-probe**",route=>{
    requests++;
    return route.fulfill({status:200,contentType:"application/json",body:"{}"});
  });
  const outcome=await page.evaluate(async()=>{
    const controller=new AbortController();
    controller.abort();
    try{ await fetchJson(new URL(location.origin+"/superseded-probe"),controller.signal); return "resolved"; }
    catch(error){ return error.kind; }
  });
  expect(outcome).toBe("aborted");
  expect(requests).toBe(0);
});

test("Clear invalidates a slow property response",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{delayParcel:350});
  await page.reload();
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await expect(page.locator("#sugg")).toBeVisible();
  await page.locator("#q").press("ArrowDown");
  await page.locator("#q").press("Enter");
  await expect(page.locator("#status")).toContainText("Looking up");
  await page.locator("#clear").click();
  await page.waitForTimeout(500);
  await expect(page.locator("#results")).toBeHidden();
  await expect(page.locator("#q")).toHaveValue("");
});

test("attachment failures and singular-layer overlaps are visible",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{attachmentFailure:true,multipleWater:true});
  await page.reload();
  await page.evaluate(()=>{ CFG.request.retryDelayMs=1; });
  await loadKnownProperty(page);
  await expect(page.locator("#results-body")).toContainText("Recorded platTemporarily unavailable");
  await expect(page.locator("#results-body")).toContainText("multiple source polygons matched");
  await expect(page.locator("#status")).toContainText("data source issue");
});

test("an attachment without a reported size omits the size rather than showing NaN",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{attachmentWithoutSize:true});
  await page.reload();
  await loadKnownProperty(page);
  const plat=page.getByRole("link",{name:/Recorded plat/});
  await expect(plat).toHaveCount(1);
  await expect(plat).not.toContainText("NaN");
  await expect(plat).toContainText("PDF");
});

test("results reflow without horizontal page scrolling at 320 CSS pixels",async({page})=>{
  await page.setViewportSize({width:320,height:900});
  await loadKnownProperty(page);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("forced colors, reduced motion, and print retain usable content",async({page})=>{
  await page.emulateMedia({forcedColors:"active",reducedMotion:"reduce"});
  await loadKnownProperty(page);
  await expect(page.locator("#results")).toBeVisible();
  await page.emulateMedia({media:"print"});
  await expect(page.locator("#lookup")).toBeHidden();
  await expect(page.locator("footer")).toBeVisible();
  await expect(page.locator("#public-disclaimer")).toContainText("not");
});

test("parcel values remain available when only schema metadata fails",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{parcelSchemaFailure:true});
  await page.reload();
  await page.evaluate(()=>{ CFG.request.retryDelayMs=1; });
  await loadKnownProperty(page);
  await expect(page.locator("#results-body")).toContainText("3300 E SANTA ROSA AVE");
  await expect(page.locator("#results-body")).toContainText("field descriptions were temporarily unavailable");
  await expect(page.locator("#status")).toContainText("data source issue");
});

/* Missing boundary: the polygon layers report unavailable, but a coverage layer
   falls back to a real query at the stored point and says out loud that only the
   centre was checked. Reporting a centre-only answer as if the whole property had
   been checked is the failure this sentence exists to prevent. */
test("full-parcel layers are unavailable when parcel geometry is missing",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{omitParcelGeometry:true});
  await page.reload();
  await page.evaluate(()=>{ CFG.request.retryDelayMs=1; });
  await loadKnownProperty(page);
  await expect(page.locator(".pair",{hasText:"FEMA flood hazard"}))
    .toContainText("Temporarily unavailable");
  await expect(page.locator("#results-body")).toContainText("Base zoning district — CodeR-1-8");
  await expect(page.locator("#results-body"))
    .toContainText("We could only check the centre of this property.");
  await expect(page.locator("#results-body"))
    .toContainText("We do not know whether the edges of the property are covered.");
  await expect(page.locator("#status")).toContainText("data source issue");
});

/* Inverted on 10 September 2026 (A3). Zoning used to be read from the stored
   point and reported "Temporarily unavailable" without one; it is now read from
   the parcel boundary and answers perfectly well. Culinary water is the layer
   that genuinely needs the stored point, so it is the one that must report the
   gap — and something still has to, or a missing centroid would fail silently. */
test("coverage layers still answer when parcel centroid coordinates are missing",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{parcel:{parcel_latitude:null,parcel_longitude:null}});
  await page.reload();
  await loadKnownProperty(page);
  await expect(page.locator(".pair",{hasText:"In FEMA Special Flood Hazard Area"}))
    .toContainText("Yes");
  await expect(page.locator("#results-body")).toContainText("Base zoning district — CodeR-1-8");
  await expect(page.locator("#results-body"))
    .toContainText("All of this property is in the R-1-8 zoning district.");
  await expect(page.locator(".pair",{hasText:"Culinary water"}))
    .toContainText("Temporarily unavailable");
});

/* ===========================================================================
   Polygon coverage for zoning, future land use and the City Center Overlay
   (A3, 10 September 2026).

   These specs are about what a resident is told, so they assert the published
   sentence rather than a class name or an internal state. Each one names the
   evidence the fixture supplies, because the sentence is only correct for that
   evidence: a fixture edited without the assertion is how an overclaim ships.
   =========================================================================== */
const R18={OBJECTID:101,ZONE_:"R-1-8",Category:"Single-Household Residential",
  Zone_Desc1:"R-1-8 zoning is designated for low density, single-household development "+
    "within Millcreek.",
  CodeRef:"18.36",
  CodebookURL:"https://millcreek.municipalcodeonline.com/book?type=planzone#name=18.36_R-1-8_Zone"};
const R18_ADJACENT={OBJECTID:103,ZONE_:"R-1-8",Category:"Single-Household Residential",
  Zone_Desc1:"R-1-8 zoning is designated for low density, single-household development "+
    "within Millcreek.",
  CodeRef:"18.36",
  CodebookURL:"https://millcreek.municipalcodeonline.com/book?type=planzone#name=18.36_R-1-8_Zone"};
const C2={OBJECTID:102,ZONE_:"C-2",Category:"Neighborhood Commercial",
  Zone_Desc1:"C-2 zoning is designated for general commercial development along arterial "+
    "streets within Millcreek.",
  CodeRef:"18.40",
  CodebookURL:"https://millcreek.municipalcodeonline.com/book?type=planzone#name=18.40_C-2_Zone"};
const CCOZ_FEATURE={OBJECTID_1:701};
const PLANNING="801-214-2700";

// A boundary with a hole around the parcel's stored point and a detached second
// part, so the probe rule is exercised on geometry it must not mishandle.
const MULTIPART_WITH_HOLE={rings:[
  [[-111.816,40.698],[-111.814,40.698],[-111.814,40.700],[-111.816,40.700],[-111.816,40.698]],
  [[-111.8154,40.6989],[-111.8146,40.6989],[-111.8146,40.6991],[-111.8154,40.6991],
    [-111.8154,40.6989]],
  [[-111.812,40.698],[-111.810,40.698],[-111.810,40.700],[-111.812,40.700],[-111.812,40.698]]
],spatialReference:{wkid:4326}};
// A closed ring with no interior at all: every probe would land on the boundary,
// so none survives and the layer has to fall back to the stored point.
const DEGENERATE={rings:[[[-111.816,40.698],[-111.814,40.698],[-111.816,40.698]]],
  spatialReference:{wkid:4326}};

async function coverageLookup(page,state){
  await page.unrouteAll({behavior:"wait"});
  const requests=await mockArcGIS(page,state);
  await page.reload();
  await page.evaluate(()=>{ CFG.request.retryDelayMs=1; });
  await loadKnownProperty(page);
  return requests;
}
const zoningCard=page=>page.locator(".card").filter({has:page.locator("h3",{hasText:"Zoning"})});

test("one district containing the whole parcel is reported as covering all of it",async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[R18],probe:[R18],within:[R18]}}});
  await expect(zoningCard(page))
    .toContainText("All of this property is in the R-1-8 zoning district.");
  await expect(zoningCard(page)).not.toContainText("Not in this area");
});

/* Nothing Q1 found is ever hidden. A district that contains the whole parcel does
   not license suppressing a second one the map also draws on it — the reader is
   told about both, and told which one could not be confirmed. */
test("a contained district still shows every other designation the map touches",async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[R18,C2],probe:[R18],within:[R18]}}});
  await expect(zoningCard(page))
    .toContainText("All of this property is in the R-1-8 zoning district.");
  await expect(zoningCard(page)).toContainText(
    "The zoning map also touches this property with C-2. "+
    "We could not confirm how much of the property it covers.");
  await expect(zoningCard(page)).toContainText("Base zoning district — CodeC-2");
});

test("a probe-confirmed district with no whole-parcel match reads as present",async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[R18],probe:[R18],within:[]}}});
  await expect(zoningCard(page)).toContainText("This property is in the R-1-8 zoning district.");
  await expect(zoningCard(page))
    .not.toContainText("All of this property is in the R-1-8 zoning district.");
});

/* The boundary-overlap case, taken from real parcel 16263780070000: two
   candidates, one probe-confirmed, none containing the parcel. The unconfirmed
   one is neither promoted to a second district nor suppressed. */
test("only one of two candidate object ids confirmed leaves the other an unconfirmed touch",
  async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[R18,C2],probe:[R18],within:[]}}});
  await expect(zoningCard(page)).toContainText("This property is in the R-1-8 zoning district.");
  await expect(zoningCard(page)).toContainText(
    "The zoning map also touches this property with C-2. "+
    "We could not confirm how much of the property it covers.");
});

test("two probe-confirmed districts read as a split property",async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[R18,C2],probe:[R18,C2],within:[]}}});
  await expect(zoningCard(page)).toContainText(
    "This property has more than one zoning district. Part of it is R-1-8. "+
    "Part of it is C-2. Call Planning and Zoning at "+PLANNING+
    " to find out which rules apply to your project.");
});

test("two districts each containing the whole parcel are reported as a map conflict",
  async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[R18,C2],probe:[R18,C2],
    within:[R18,C2]}}});
  await expect(zoningCard(page)).toContainText(
    "The map shows two zoning districts covering this property. Only one can apply. "+
    "Call Planning and Zoning at "+PLANNING+".");
  await expect(page.locator("#status")).toContainText("data source issue");
});

test("one district containing the parcel while another covers part of it is a conflict",
  async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[R18,C2],probe:[R18,C2],within:[R18]}}});
  await expect(zoningCard(page)).toContainText(
    "The map shows all of this property in R-1-8, and it also shows C-2 covering "+
    "part of it. Only one can apply. Call Planning and Zoning at "+PLANNING+".");
});

test("a candidate no probe reached is shown as an unconfirmed touch, never hidden",
  async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[R18],probe:[],within:[]}}});
  await expect(zoningCard(page)).toContainText(
    "The zoning map touches this property with R-1-8, but we could not confirm "+
    "which part of the property it covers. Call Planning and Zoning at "+PLANNING+".");
  await expect(zoningCard(page)).toContainText("Base zoning district — CodeR-1-8");
  await expect(page.locator("#status")).toContainText("data source issue");
});

/* The sentence that replaced "Not in this area" for parcel 15353000130000. A gap
   in the map is a gap in the map; it is not a property without zoning, and the
   difference is the whole point. */
test("no zoning polygon reports a gap in the map, not an absence of zoning",async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[]}}});
  await expect(zoningCard(page)).toContainText(
    "No zoning polygon was found at this property. That is a gap in the map, not a "+
    "statement that this property has no zoning. Call Planning and Zoning at "+PLANNING+".");
  await expect(zoningCard(page)).not.toContainText("Not in this area");
});

test("the optional overlay answers No when a complete query finds nothing",async({page})=>{
  await coverageLookup(page,{});
  await expect(page.locator(".pair",{hasText:"City Center Overlay"})).toContainText("No");
});

/* An edge-only touch is not membership. A resident told "Yes" on that evidence
   would be told to meet overlay standards that may not apply to their property. */
test("an unconfirmed overlay touch answers Unknown rather than Yes",async({page})=>{
  await coverageLookup(page,{coverage:{[CCOZ]:{intersects:[CCOZ_FEATURE],probe:[],within:[]}}});
  await expect(page.locator(".pair",{hasText:"City Center Overlay"})).toContainText("Unknown");
  await expect(zoningCard(page)).toContainText(
    "The City Center Overlay map touches this property, but we could not confirm "+
    "which part of the property it covers.");
});

test("an overlay containing the whole parcel says so, and a partial one does not",
  async({page})=>{
  await coverageLookup(page,{coverage:{[CCOZ]:{intersects:[CCOZ_FEATURE],
    probe:[CCOZ_FEATURE],within:[CCOZ_FEATURE]}}});
  await expect(page.locator(".pair",{hasText:"City Center Overlay"}))
    .toContainText("Yes — all of this property");
  await coverageLookup(page,{coverage:{[CCOZ]:{intersects:[CCOZ_FEATURE],
    probe:[CCOZ_FEATURE],within:[]}}});
  const overlay=page.locator(".pair",{hasText:"City Center Overlay"});
  await expect(overlay).toContainText("Yes");
  await expect(overlay).not.toContainText("all of this property");
});

/* A4, 10 September 2026: the code-section reference and the link to the
   codebook, named after what they hold instead of the old mislabelled
   "Ordinance" row. */
test("the code section and codebook link render alongside the purpose sentence",
  async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[R18],probe:[R18],within:[R18]}}});
  await expect(zoningCard(page)).toContainText("Base zoning district — Code section18.36");
  await expect(zoningCard(page)).toContainText(
    "Base zoning district — Category"+R18.Category);
  await expect(zoningCard(page)).toContainText(
    "Base zoning district — What this district is for"+R18.Zone_Desc1);
  const link=zoningCard(page).getByRole("link",{name:"Read the code section"});
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href",R18.CodebookURL);
  // The link text is the row label, never the bare URL (2.4.4 Link Purpose).
  await expect(link).not.toHaveText(/^https?:\/\//);
});

test("two adjacent features with the same code are one designation",async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[R18,R18_ADJACENT],
    probe:[R18,R18_ADJACENT],within:[]}}});
  await expect(zoningCard(page)).toContainText("This property is in the R-1-8 zoning district.");
  await expect(zoningCard(page)).not.toContainText("more than one zoning district");
  // Exact match, not a substring: "Base zoning district — Code section" (the
  // CodeRef row) would otherwise also match a hasText search for "...— Code".
  await expect(page.locator("#results-body dt",{hasText:/^Base zoning district — Code$/}))
    .toHaveCount(1);
});

/* A check that did not complete is reported beside the answer, never instead of
   it and never silently. */
test("a failed probe query is reported alongside the answer it could not confirm",
  async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[R18],fail:{probe:true},
    within:[R18]}}});
  await expect(zoningCard(page))
    .toContainText("All of this property is in the R-1-8 zoning district.");
  await expect(zoningCard(page))
    .toContainText("We could not confirm which of these covers this property.");
  await expect(page.locator("#status")).toContainText("data source issue");
});

test("a failed whole-parcel query is reported alongside a split answer",async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[R18,C2],probe:[R18,C2],
    fail:{within:true}}}});
  await expect(zoningCard(page)).toContainText("This property has more than one zoning district.");
  await expect(zoningCard(page))
    .toContainText("We could not check whether one district covers all of this property.");
});

test("a body without a features array is a failed query, not an empty answer",async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{malformed:{intersects:true}}}});
  await expect(page.locator(".pair",{hasText:"Base zoning district"}))
    .toContainText("Temporarily unavailable");
  await expect(zoningCard(page)).not.toContainText("No zoning polygon was found");
  // One failed layer never blanks the page.
  await expect(zoningCard(page)).toContainText("Future land use — Designation");
});

test("a truncated response that repeats itself stops after two requests and says so",
  async({page})=>{
  const requests=await coverageLookup(page,{coverage:{[ZONE]:{pages:{intersects:[
    {features:[R18],more:true},{features:[R18],more:true}]}}}});
  const candidateQueries=requests.filter(request=>
    request.url.includes("Zone_Update_2025___Related_Master")&&request.url.includes("/query")&&
    !request.url.includes("spatialRel=esriSpatialRelWithin")&&
    !request.url.includes("esriGeometryMultipoint"));
  expect(candidateQueries.length,"the repeated page stops paging immediately").toBe(2);
  await expect(zoningCard(page)).toContainText("Base zoning district — CodeR-1-8");
  await expect(zoningCard(page)).toContainText(
    "We could not read all of the map for this property. Some information may be "+
    "missing. Call Planning and Zoning at "+PLANNING+".");
});

test("distinct truncated pages stop at the configured page budget and say so",async({page})=>{
  const requests=await coverageLookup(page,{coverage:{[ZONE]:{pages:{intersects:[
    {features:[R18],more:true},{features:[C2],more:true},
    {features:[R18_ADJACENT],more:true}]}}}});
  const candidateQueries=requests.filter(request=>
    request.url.includes("Zone_Update_2025___Related_Master")&&request.url.includes("/query")&&
    !request.url.includes("spatialRel=esriSpatialRelWithin")&&
    !request.url.includes("esriGeometryMultipoint"));
  const budget=await page.evaluate(()=>CFG.coverage.maxPages);
  expect(candidateQueries.length,"paging is bounded by CFG.coverage.maxPages").toBe(budget);
  await expect(zoningCard(page)).toContainText("Base zoning district — CodeR-1-8");
  await expect(zoningCard(page))
    .toContainText("We could not read all of the map for this property.");
});

/* No boundary at all: the layer runs a real query at the stored point and says
   only the centre was checked. It never renders that as "No". */
test("a point-only check that finds nothing says so, and the overlay reads Unknown",
  async({page})=>{
  await coverageLookup(page,{omitParcelGeometry:true,
    coverage:{[ZONE]:{point:[]},[CCOZ]:{point:[]}}});
  await expect(zoningCard(page)).toContainText(
    "We could only check the centre of this property. Nothing was found there. "+
    "We do not know whether the edges of the property are covered.");
  await expect(page.locator(".pair",{hasText:"City Center Overlay"})).toContainText("Unknown");
  await expect(zoningCard(page)).not.toContainText("Not in this area");
});

test("several designations at the stored point are all shown and flagged",async({page})=>{
  await coverageLookup(page,{omitParcelGeometry:true,coverage:{[ZONE]:{point:[R18,C2]}}});
  await expect(zoningCard(page)).toContainText("Base zoning district — CodeR-1-8");
  await expect(zoningCard(page)).toContainText("Base zoning district — CodeC-2");
  await expect(zoningCard(page)).toContainText(
    "The map shows more than one designation at the centre of this property. "+
    "Only one can apply.");
  // A centre-only match is not an "unconfirmed touch": neither the probes nor the
  // whole-parcel check ran, and saying the doubt twice in two different vocabularies
  // is how a reader concludes there are more designations than there are.
  await expect(zoningCard(page)).not.toContainText("also touches this property");
});

/* Multipart geometry with a hole. The stored point sits inside the hole, so it is
   not part of the property and must not be sent as evidence about it — the stored
   point gets no privilege over any other probe. */
test("probe points respect holes and multiple parts, and never privilege the stored point",
  async({page})=>{
  const requests=await coverageLookup(page,{geometry:MULTIPART_WITH_HOLE,
    coverage:{[ZONE]:{intersects:[R18],probe:[R18],within:[]}}});
  const probeQuery=requests.find(request=>
    request.url.includes("Zone_Update_2025___Related_Master")&&
    (request.url+request.body).includes("esriGeometryMultipoint"));
  expect(probeQuery,"the probe query was sent").toBeTruthy();
  const params=probeQuery.method==="POST"
    ? new URLSearchParams(probeQuery.body) : new URL(probeQuery.url).searchParams;
  const points=JSON.parse(params.get("geometry")).points;
  expect(points.length,"probes were generated inside both parts").toBeGreaterThan(1);
  expect(points.length,"the probe cap holds").toBeLessThanOrEqual(25);
  expect(points.some(([x,y])=>x===-111.815&&y===40.699),
    "a stored point inside a hole is not sent as evidence").toBe(false);
  expect(points.every(([x,y])=>x<=-111.814||x>=-111.812),
    "no probe falls in the gap between the two parts").toBe(true);
  await expect(zoningCard(page)).toContainText("This property is in the R-1-8 zoning district.");
});

test("a boundary with no interior falls back to the stored point rather than going quiet",
  async({page})=>{
  const requests=await coverageLookup(page,{geometry:DEGENERATE,
    coverage:{[ZONE]:{point:[R18]}}});
  const multipoint=requests.filter(request=>(request.url+request.body).includes("esriGeometryMultipoint"));
  expect(multipoint.length,"no probe query is sent when no probe survives").toBe(0);
  await expect(zoningCard(page)).toContainText("Base zoning district — CodeR-1-8");
  await expect(zoningCard(page))
    .toContainText("We could only check the centre of this property.");
});

/* ===========================================================================
   A3-R01, A3-R02, A3-R03 (10 September 2026 review findings): absence must
   never be inferred from an unreadable match, a missing stored coordinate must
   never be treated as a real point at (0, 0), and every coverage layer must
   name itself even when it has nothing to show.
   =========================================================================== */

test("an unreadable overlay match never reads as a confirmed No (A3-R01)",async({page})=>{
  // The service returned a real feature the mock deliberately leaves with no
  // object id and no other attributes — exactly the shape of a live response
  // this page cannot join back to anything. That is different from the
  // overlay genuinely finding nothing, and must not render the same way.
  await coverageLookup(page,{noOidSynthesis:true,
    coverage:{[CCOZ]:{intersects:[{}],probe:[{}],within:[]}}});
  const overlay=page.locator(".pair",{hasText:"City Center Overlay"});
  await expect(overlay).toContainText("Unknown — verify with staff");
  await expect(zoningCard(page)).toContainText(
    "We could not confirm which of these covers this property.");
});

test("a readable zoning designation with no object id is shown, never dropped (A3-R01)",
  async({page})=>{
  await coverageLookup(page,{noOidSynthesis:true,
    coverage:{[ZONE]:{intersects:[{ZONE_:"R-1-8",ZONE_DESC:"Residential",
      Zone_Desc1:"https://example.test/zoning"}],probe:[],within:[]}}});
  await expect(zoningCard(page)).toContainText("Base zoning district — CodeR-1-8");
  await expect(zoningCard(page)).toContainText(
    "The zoning map touches this property with R-1-8, but we could not confirm "+
    "which part of the property it covers. Call Planning and Zoning at "+PLANNING+".");
  await expect(zoningCard(page)).not.toContainText("No zoning polygon was found");
});

test("a zoning match with an object id but no readable designation reports unknown, "+
  "not a gap (A3-R01)",async({page})=>{
  await coverageLookup(page,{noOidSynthesis:true,
    coverage:{[ZONE]:{intersects:[{OBJECTID:900}],probe:[],within:[]}}});
  await expect(zoningCard(page)).toContainText(
    "We could not read the zoning map for this property. Call Planning and Zoning at "+
    PLANNING+".");
  await expect(zoningCard(page)).not.toContainText("No zoning polygon was found");
  await expect(zoningCard(page)).not.toContainText("Not in this area");
});

/* ===========================================================================
   COV-001, COV-002, RENDER-001 (Sol stack inspection, 10 September 2026).
   =========================================================================== */

/* `{features:[{}]}`: a 200 carrying one match with no attributes object. The
   entry used to be dropped on the way in, so the overlay saw a complete empty
   result and rendered "No" — the most confident answer this page can give,
   from a body it could not read. */
test("a match with no attributes object never becomes a confident No (COV-001)",
  async({page})=>{
  await coverageLookup(page,{coverage:{[CCOZ]:{intersects:[null],probe:[null],within:[null]}}});
  const overlay=page.locator(".pair",{hasText:"City Center Overlay"});
  await expect(overlay).toContainText("Unknown — verify with staff");
  await expect(overlay).not.toContainText("No");
});

test("a zoning response of unreadable matches reports unknown, not a gap (COV-001)",
  async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[null,null],probe:[],within:[]}}});
  await expect(zoningCard(page)).toContainText(
    "We could not read the zoning map for this property. Call Planning and Zoning at "+
    PLANNING+".");
  await expect(zoningCard(page)).not.toContainText("No zoning polygon was found");
  await expect(zoningCard(page)).not.toContainText("Not in this area");
  // One unreadable layer never blanks the rest of the card.
  await expect(zoningCard(page)).toContainText("Future land use — Designation");
});

/* The point-only path reached the same false negative by its own route: with no
   usable boundary, an unreadable centre response answered "Nothing was found
   there" before the unreadable check ever ran. */
test("an unreadable centre-only response does not say nothing was found (COV-002)",
  async({page})=>{
  await coverageLookup(page,{omitParcelGeometry:true,
    coverage:{[ZONE]:{point:[null]},[CCOZ]:{point:[null]}}});
  await expect(zoningCard(page)).toContainText(
    "We could only check the centre of this property, and we could not read the "+
    "zoning map there. We do not know what covers this property. "+
    "Call Planning and Zoning at "+PLANNING+".");
  await expect(zoningCard(page)).not.toContainText("Nothing was found there");
  await expect(zoningCard(page)).not.toContainText("Not in this area");
  await expect(page.locator(".pair",{hasText:"City Center Overlay"})).toContainText("Unknown");
});

test("a truncated centre-only response does not say nothing was found either (COV-002)",
  async({page})=>{
  const truncated={pages:{point:[{features:[],more:true},{features:[],more:true}]}};
  // The overlay is truncated the same way: it shares the Zoning card, and its own
  // centre-only sentence would otherwise supply the words being asserted against.
  await coverageLookup(page,{omitParcelGeometry:true,
    coverage:{[ZONE]:truncated,[CCOZ]:truncated}});
  await expect(zoningCard(page)).toContainText(
    "We could only check the centre of this property, and we could not read the "+
    "zoning map there.");
  await expect(zoningCard(page)).not.toContainText("Nothing was found there");
});

/* RENDER-001: the labelled fallback row already carries the first sentence, so
   printing the whole sentence list beneath it said the same thing twice in a
   row — on screen and in what the resident pastes into an email. */
test("a fallback outcome sentence is rendered once, not twice (RENDER-001)",async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[],fail:{probe:true}}}});
  const gap="No zoning polygon was found at this property.";
  const alsoSaid="We could not confirm which of these covers this property.";
  const count=(haystack,needle)=>haystack.split(needle).length-1;

  const rendered=await zoningCard(page).evaluate(card=>card.textContent);
  expect(count(rendered,gap),"the gap sentence appears once in the card").toBe(1);
  expect(count(rendered,alsoSaid),"and every later sentence still appears").toBe(1);
  // It is the labelled row that carries it, so the layer still names itself.
  await expect(page.locator(".pair",{hasText:"Base zoning district — Result"}))
    .toContainText(gap);
  expect(await page.locator("#results-body p.meta",{hasText:gap}).count(),
    "no paragraph repeats the row").toBe(0);

  await page.locator("#copy").click();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  expect(count(copied,gap),"and once in the copied text").toBe(1);
  expect(count(copied,alsoSaid)).toBe(1);
});

test("missing geometry and missing coordinates send no spatial query and say so (A3-R02)",
  async({page})=>{
  const requests=await coverageLookup(page,{omitParcelGeometry:true,
    parcel:{parcel_latitude:null,parcel_longitude:null}});
  const zoneQueries=requests.filter(request=>
    request.url.includes("Zone_Update_2025___Related_Master")&&request.url.includes("/query"));
  expect(zoneQueries.length,"no spatial query is sent without geometry or a usable point").toBe(0);
  await expect(zoningCard(page)).toContainText(
    "We could not check this property's location. Call Planning and Zoning at "+PLANNING+".");
  // A3-R03: the fallback still names the layer instead of leaving an unlabelled
  // sentence sitting in the card.
  await expect(page.locator(".pair",{hasText:"Base zoning district — Result"}))
    .toContainText("We could not check this property's location.");
});

test("an out-of-range stored coordinate is treated as missing, not as a real point (A3-R02)",
  async({page})=>{
  const requests=await coverageLookup(page,{omitParcelGeometry:true,
    parcel:{parcel_latitude:200,parcel_longitude:-111.815}});
  const zoneQueries=requests.filter(request=>
    request.url.includes("Zone_Update_2025___Related_Master")&&request.url.includes("/query"));
  expect(zoneQueries.length,"an out-of-range latitude is never sent as a coordinate").toBe(0);
  await expect(zoningCard(page)).toContainText("We could not check this property's location.");
});

test("mixed zoning and future-land-use gaps are distinguishable, not identical "+
  "anonymous text (A3-R03)",async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[]},[FUTURE]:{intersects:[]}}});
  await expect(page.locator(".pair",{hasText:"Base zoning district — Result"})).toContainText(
    "That is a gap in the map, not a statement that this property has no zoning.");
  await expect(page.locator(".pair",{hasText:"Future land use — Result"})).toContainText(
    "That is a gap in the map, not a statement that this property has no future land "+
    "use designation.");
});

test("a coverage query in flight is abandoned when the search is cleared",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{coverage:{[ZONE]:{delayMs:600}}});
  await page.reload();
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await expect(page.locator("#sugg")).toBeVisible();
  await page.locator("#q").press("ArrowDown");
  await page.locator("#q").press("Enter");
  await page.locator("#clear").click();
  await page.waitForTimeout(900);
  await expect(page.locator("#results")).toBeHidden();
  await expect(page.locator("#q")).toHaveValue("");
});

/* No sentence on this page may describe a proportion. Probes prove that a
   designation covers area inside the property; nothing here measures how much,
   so "most", "small" and "too small" are not available words. */
test("no coverage answer describes how much of the property a designation covers",
  async({page})=>{
  for(const scenario of [
    {[ZONE]:{intersects:[R18,C2],probe:[R18],within:[]}},
    {[ZONE]:{intersects:[R18],probe:[],within:[]}},
    {[ZONE]:{intersects:[]}},
    {[ZONE]:{intersects:[R18,C2],probe:[R18,C2],within:[R18]}}
  ]){
    await coverageLookup(page,{coverage:scenario});
    const text=await zoningCard(page).innerText();
    expect(text,"a coverage answer must not claim a proportion")
      .not.toMatch(/\bmost\b|\bsmall\b/i);
    expect(text).not.toContain("Not in this area");
  }
});

test("coverage sentences reach the copied text",async({page})=>{
  await coverageLookup(page,{coverage:{[ZONE]:{intersects:[R18,C2],probe:[R18],within:[]}}});
  await page.locator("#copy").click();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  expect(copied).toContain("This property is in the R-1-8 zoning district.");
  expect(copied).toContain("The zoning map also touches this property with C-2.");
});

/* ===========================================================================
   Zoning first, and one plain-language sentence for zoning and future land use
   (A7, 10 September 2026).
   =========================================================================== */

/* Read the actual heading text off the page rather than assuming it, so this
   test fails honestly if a card's own h3 wording ever drifts. */
test("Zoning leads the report, then Property record, in the full fixed section order",
  async({page})=>{
  await loadKnownProperty(page);
  const headings=await page.locator("#results-body .card h3").allTextContents();
  expect(headings).toEqual([
    "Zoning","Property record","Historic designation","Hazard and special designations",
    "Subdivision and plat","Natural hazards","Informational hazard screening",
    "Representation","Services","Location"
  ]);
});

test("zoning and future land use each explain what they are, beside their own rows and in the copy",
  async({page})=>{
  await loadKnownProperty(page);
  await expect(zoningCard(page)).toContainText(
    "Zoning is the law now. It sets what you may build on this property and how you may use it today.");
  await expect(zoningCard(page)).toContainText(
    "Future land use is the city's plan for later. It is policy in the General Plan. "+
    "It does not change what you may build today.");
  await page.locator("#copy").click();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  expect(copied).toContain("Zoning is the law now.");
  expect(copied).toContain("Future land use is the city's plan for later.");
});

/* ===========================================================================
   Attribution: who owns this data, and when was it last checked (A5,
   10 September 2026). Every rendered card — every configured group, plus the
   Property record and Location cards that are not built from CFG.LAYERS at
   all — names an owner and a spoken-word review date. Layers sharing an
   identical owner and review date collapse into one "Sources:" sentence
   rather than repeating the same fact once per layer.
   =========================================================================== */

// "Sources: <owner>, checked <spoken date> — <label>[, <label>...]."
const SOURCES_SENTENCE=/Sources: [^,]+, checked \d{1,2} [A-Z][a-z]+ \d{4} — [^.]+\./;

test("every rendered card names its data owner and a spoken review date",async({page})=>{
  await loadKnownProperty(page);
  const cards=page.locator("#results-body .card");
  const count=await cards.count();
  expect(count).toBeGreaterThan(0);
  for(let i=0;i<count;i++){
    const card=cards.nth(i);
    const heading=await card.locator("h3").innerText();
    await expect(card,heading+" card names its data owner and review date")
      .toContainText(SOURCES_SENTENCE);
  }
  // Property record and Location are not built from CFG.LAYERS at all — call
  // them out by name so a future refactor that drops their attribution does
  // not hide behind the loop above passing on every other card.
  const headings=await page.locator("#results-body .card h3").allTextContents();
  expect(headings).toContain("Property record");
  expect(headings).toContain("Location");
});

/* Zoning's three layers (zone, futureland, ccoz) are all configured with the
   identical sourceOwner and reviewedOn, so the collapse rule must produce
   exactly one sentence naming all three labels — not one sentence per layer. */
test("layers sharing an owner and review date collapse into one Sources sentence",async({page})=>{
  await loadKnownProperty(page);
  const text=await zoningCard(page).innerText();
  const matches=text.match(/Sources:/g)||[];
  expect(matches.length).toBe(1);
  expect(text).toContain(
    "Sources: Millcreek Planning and GIS, checked 9 August 2026 — "+
    "Base zoning district, Future land use, In the City Center Overlay (CCOZ).");
});

test("attribution sentences reach the copied text",async({page})=>{
  await loadKnownProperty(page);
  await page.locator("#copy").click();
  const copied=await page.evaluate(()=>navigator.clipboard.readText());
  expect(copied).toContain(
    "Sources: Millcreek Planning and GIS, checked 9 August 2026 — "+
    "Base zoning district, Future land use, In the City Center Overlay (CCOZ).");
  // Property record's and Location's attribution use CFG.parcel, not a layer.
  expect(copied).toContain(
    "Sources: Millcreek GIS; parcel records originate with Salt Lake County, "+
    "checked 9 August 2026 — Property record.");
  expect(copied).toContain(
    "Sources: Millcreek GIS; parcel records originate with Salt Lake County, "+
    "checked 9 August 2026 — Location.");
});

/* ---------------------------------------------------------------------------
   Reflow and focus-visibility regressions.

   These cover two defects the axe pass above structurally cannot detect:
   axe does not evaluate layout at a reduced viewport, and it does not evaluate
   whether a programmatic focus target has a visible indicator. Both were found
   by manual audit on 13 August 2026 and both were present in the shipped build.
   --------------------------------------------------------------------------- */

// 1.4.10 Reflow: 320 CSS px wide, no horizontal scrolling.
test("reflows at 320px with no horizontal scrolling",async({page})=>{
  await page.setViewportSize({width:320,height:900});
  await loadKnownProperty(page);
  const overflow=await page.evaluate(()=>({
    doc:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    wide:[...document.querySelectorAll("body *")]
      .filter(el=>el.offsetParent!==null &&
        el.getBoundingClientRect().width>window.innerWidth+1)
      .map(el=>el.tagName.toLowerCase()+"."+String(el.className||"").split(" ")[0])
  }));
  expect(overflow.wide).toEqual([]);
  expect(overflow.doc).toBeLessThanOrEqual(1);
});

// 1.4.4 Resize Text: enlarged text must not introduce horizontal scrolling.
// The offenders are unbreakable tokens — 14-digit parcel numbers and email
// addresses — which is what the overflow-wrap rules exist to break.
//
// 200% and 400%. 400% was excluded on 13 August because it still overflowed at
// 530px. The cause turned out to be the <fieldset>, not the input: a fieldset
// carries an intrinsic min-width:min-content that width:100% cannot override, so
// it sat at 466px inside a 320px container and every descendant inherited it.
// With fieldset/legend/button sizing constrained, 320px holds through 400%.
for(const scale of [200,400]){
  test(`reflows at 320px with text scaled to ${scale}% and no horizontal scrolling`,
    async({page})=>{
      await page.setViewportSize({width:320,height:900});
      await loadKnownProperty(page);
      await page.evaluate(pct=>{
        document.documentElement.style.fontSize=(16*pct/100)+"px";
      },scale);
      await page.waitForTimeout(150);
      const doc=await page.evaluate(()=>
        document.documentElement.scrollWidth-document.documentElement.clientWidth);
      expect(doc).toBeLessThanOrEqual(1);
    });
}

// The rules themselves, so a future refactor cannot silently drop them.
test("long unbreakable tokens are allowed to break",async({page})=>{
  await loadKnownProperty(page);
  const wrap=await page.evaluate(()=>({
    body:getComputedStyle(document.body).overflowWrap,
    dd:getComputedStyle(document.querySelector("#results-body dd")).overflowWrap,
    dt:getComputedStyle(document.querySelector("#results-body dt")).overflowWrap
  }));
  expect(wrap.body).toBe("break-word");
  expect(wrap.dd).toBe("anywhere");
  expect(wrap.dt).toBe("anywhere");
});

// 2.4.7 Focus Visible for programmatic targets. Focus is moved to #r-head after
// every lookup; :focus-visible does not match programmatic focus on a
// tabindex="-1" element, so an explicit :focus rule is required.
//
// Asserted in two independent halves on purpose. A computed-style check is not
// usable here: when the browser window lacks OS focus, :focus does not match and
// outlineStyle reads "none" even though the rule is present, while outlineWidth
// reads the UA default "medium" (3px) even when no rule exists at all — so the
// obvious test is both flaky and vacuous. Behaviour and declaration are
// therefore checked separately, and both are deterministic.
test("a lookup moves focus to the results heading",async({page})=>{
  await loadKnownProperty(page);
  expect(await page.evaluate(()=>document.activeElement.id)).toBe("r-head");
});

test("programmatic focus targets declare a visible focus outline",async({page})=>{
  const declared=await page.evaluate(()=>
    [...document.styleSheets]
      .flatMap(sheet=>{try{return [...sheet.cssRules]}catch{return []}})
      .filter(rule=>rule.selectorText&&/#(main|r-head):focus\b/.test(rule.selectorText))
      .map(rule=>({selector:rule.selectorText,
        outline:rule.style.outline||rule.style.outlineWidth||""})));
  const targets=declared.map(rule=>rule.selector).join(" ");
  expect(targets,"a :focus rule must exist for #main and #r-head").toContain("#r-head:focus");
  expect(targets,"a :focus rule must exist for #main and #r-head").toContain("#main:focus");
  for(const rule of declared){
    expect(rule.outline,`${rule.selector} must declare an outline`).not.toBe("");
    expect(rule.outline,`${rule.selector} must not suppress the outline`).not.toMatch(/\bnone\b/);
  }
});

// 4.1.3 Status Messages: the whole message is replaced each time, so the whole
// message must be announced rather than only the changed portion.
test("status region announces atomically",async({page})=>{
  await expect(page.locator("#status")).toHaveAttribute("aria-atomic","true");
  await expect(page.locator("#status")).toHaveAttribute("aria-live","polite");
  await expect(page.locator("#status")).toHaveAttribute("role","status");
});

// The fieldset min-width fix is easy to mistake for cosmetic and delete. Without
// it a <fieldset> holds its intrinsic min-content width — 466px inside a 320px
// container — and every descendant inherits it, so reflow fails at 400%.
test("form containers can shrink below their intrinsic width",async({page})=>{
  const sizing=await page.evaluate(()=>({
    fieldset:getComputedStyle(document.querySelector("fieldset")).minWidth,
    input:getComputedStyle(document.querySelector("#q")).minWidth,
    button:getComputedStyle(document.querySelector("#go")).whiteSpace
  }));
  expect(sizing.fieldset).toBe("0px");
  expect(sizing.input).toBe("0px");
  expect(sizing.button).toBe("normal");
});

// Same trap as the fieldset, in the header. The logo is sized in rem, so at 400%
// text it grew to 288px — past a 320px viewport before any text — and flex:0 0
// auto forbids shrinking. It carries no information, so the px cap is correct
// rather than a workaround. Asserted at 400% because at ordinary sizes the rem
// width is below the cap and the bug is invisible.
//
// Verified discriminating: with the caps removed this reports 288px and the 400%
// reflow test reports 32px of overflow. The flex-wrap assertion is the weaker of
// the two — reflow passes without it — and is here to stop a layout regression,
// not to carry the criterion. The caps carry it.
test("the brand logo does not scale with text past the viewport",async({page})=>{
  await page.setViewportSize({width:320,height:900});
  await page.evaluate(()=>{document.documentElement.style.fontSize="64px"});
  const header=await page.evaluate(()=>({
    wrap:getComputedStyle(document.querySelector(".brand-lockup")).flexWrap,
    logo:document.querySelector(".brand-logo").getBoundingClientRect().width
  }));
  expect(header.wrap).toBe("wrap");
  expect(header.logo).toBeLessThanOrEqual(88);
});

/* Bounded request concurrency — production readiness Task 7.

   A single lookup fanned out to every configured layer at once, each layer asking
   for its features and its schema: 36 simultaneous requests to ArcGIS and FEMA,
   measured on the live site. Nothing was wrong with the results, but a public
   municipal service should not burst a third-party API that hard on one resident's
   search, and the browser's own per-host limits mean the last requests queue in the
   network stack where nothing can reason about them.

   Peak is measured inside the page rather than at the mock, so it reflects what the
   application scheduled rather than how fast the fixture answered. */
async function measurePeak(page,run){
  await page.evaluate(()=>{
    window.__peak=0;
    let inFlight=0;
    const real=window.fetch;
    window.fetch=(...args)=>{
      inFlight++;
      window.__peak=Math.max(window.__peak,inFlight);
      return real(...args).finally(()=>{inFlight--;});
    };
  });
  await run();
  return page.evaluate(()=>window.__peak);
}

test("a lookup does not burst more than the configured number of requests",async({page})=>{
  const limit=await page.evaluate(()=>CFG.request.maxConcurrent);
  expect(limit,"the concurrency limit is configuration, not a constant in the code")
    .toBeGreaterThan(0);
  const peak=await measurePeak(page,()=>loadKnownProperty(page));
  expect(peak,"peak simultaneous requests during one property lookup")
    .toBeLessThanOrEqual(limit);
  // Guard against passing by doing nothing: the lookup must really have fanned out.
  expect(peak).toBeGreaterThan(1);
});

test("bounded concurrency preserves configured layer order in the results",async({page})=>{
  await loadKnownProperty(page);
  const order=await page.evaluate(()=>{
    const labels=CFG.LAYERS.map(layer=>layer.label);
    const rendered=[...document.querySelectorAll("#results-body dt")]
      .map(node=>node.textContent.trim())
      .filter(text=>labels.includes(text));
    return {expected:labels.filter(label=>rendered.includes(label)),rendered};
  });
  expect(order.rendered.length,"configured layers rendered").toBeGreaterThan(3);
  /* Completion order is nondeterministic once requests are queued behind a limit —
     more so than with an unbounded burst. Display order must stay the configured
     order regardless, which is what a resident reading down the page relies on. */
  expect(order.rendered).toEqual(order.expected);
});

test("a degraded result set keeps configured layer order too",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  // Liquefaction sits in the middle of the configured order, so a failure there
  // would reorder the page rather than truncate it if ordering were by completion.
  await mockArcGIS(page,{layerFailure:"LiquefactionPotential"});
  await page.reload();
  await page.evaluate(()=>{ CFG.request.retryDelayMs=1; });
  await loadKnownProperty(page);
  const order=await page.evaluate(()=>{
    const labels=CFG.LAYERS.map(layer=>layer.label);
    const rendered=[...document.querySelectorAll("#results-body dt")]
      .map(node=>node.textContent.trim()).filter(text=>labels.includes(text));
    return {expected:labels.filter(label=>rendered.includes(label)),rendered};
  });
  expect(order.rendered.length,"the surviving layers still render").toBeGreaterThan(3);
  expect(order.rendered).toEqual(order.expected);
  await expect(page.locator("#status")).toContainText("Results ready");
});

test("queued requests are abandoned when the search is superseded",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{delayParcel:400});
  await page.reload();
  await page.evaluate(()=>{
    window.__started=0;
    const real=window.fetch;
    window.fetch=(...args)=>{ window.__started++; return real(...args); };
  });
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await expect(page.locator("#sugg")).toBeVisible();
  await page.locator("#q").press("ArrowDown");
  await page.locator("#q").press("Enter");
  await page.locator("#clear").click();
  const afterClear=await page.evaluate(()=>window.__started);
  await page.waitForTimeout(600);
  const settled=await page.evaluate(()=>window.__started);
  expect(settled,"no queued request may be issued after the search was cleared")
    .toBe(afterClear);
  await expect(page.locator("#results")).toBeHidden();
});

/* Oversized queries reach the service as POST — 10 September 2026.
   -----------------------------------------------------------------------
   Every ArcGIS query went out as a GET with the parcel boundary in the query
   string, and the hosted service answers HTTP 404 once the full URL passes
   about 2,048 bytes. Parcel 16273550010000 encodes to a ~3,700-byte query: GET
   404, the identical parameters as a form-urlencoded POST 200. About 12 of
   every 1,000 Millcreek parcels are over the limit, and for each of them every
   polygon-queried layer read "Temporarily unavailable" — indistinguishable, to
   a resident, from a genuine "No".

   The vertex counts below are measurements against the configured layer paths
   AND their explicit outFields (A2, 10 September 2026 — no query may carry
   outFields=*, so every layer query's field list adds its own fixed number of
   bytes to every polygon query): at 40 vertices the longest query URL (the
   "hist" layer, 1,889 bytes) is a few bytes under CFG.request.maxUrlBytes and
   at 44 the shortest (the "alluvial_fan" layer, 1,967 bytes) is over it. If a
   layer path or a layer's configured `fields` changes length, these fixtures
   stop straddling the boundary, and the byte assertions say so rather than
   quietly testing nothing. */
const VERTICES_JUST_UNDER=40;
const VERTICES_JUST_OVER=44;

/* A closed ring of `vertices` points. Coordinates keep full precision on
   purpose: nothing in the request path may round geometry to shorten a URL,
   because precision is what decides whether a parcel touches a flood zone. */
function ringOf(vertices){
  const points=Array.from({length:vertices-1},(unused,index)=>{
    const angle=(index/(vertices-1))*Math.PI*2;
    return [Number((-111.815+0.0012345678*Math.cos(angle)).toFixed(9)),
      Number((40.699+0.0012345678*Math.sin(angle)).toFixed(9))];
  });
  return {rings:[[...points,points[0]]],spatialReference:{wkid:4326}};
}

// What the service sees, whichever way it was sent.
const fullUrlOf=request=>request.method==="POST"?request.url+"?"+request.body:request.url;
const byteLength=text=>Buffer.byteLength(text,"utf8");
const polygonQueries=requests=>requests.filter(request=>
  fullUrlOf(request).includes("geometryType=esriGeometryPolygon"));

async function lookupWithGeometry(page,geometry){
  await page.unrouteAll({behavior:"wait"});
  const requests=await mockArcGIS(page,geometry?{geometry}:{});
  await page.reload();
  await page.evaluate(()=>{ CFG.request.retryDelayMs=1; });
  await loadKnownProperty(page);
  return requests;
}

test("an ordinary parcel is still sent as GET",async({page})=>{
  const requests=await lookupWithGeometry(page,null);
  expect(polygonQueries(requests).length,"the lookup really queried polygon layers")
    .toBeGreaterThan(3);
  expect(requests.filter(request=>request.method!=="GET")).toEqual([]);
});

test("a parcel boundary just under the limit is still sent as GET",async({page})=>{
  const limit=await page.evaluate(()=>CFG.request.maxUrlBytes);
  expect(limit,"the URL limit is configuration, not a constant in the code").toBe(1900);
  const requests=await lookupWithGeometry(page,ringOf(VERTICES_JUST_UNDER));
  const longest=Math.max(...polygonQueries(requests).map(request=>byteLength(fullUrlOf(request))));
  expect(longest,"the fixture must sit just under the limit to prove anything")
    .toBeGreaterThan(limit-150);
  expect(longest).toBeLessThanOrEqual(limit);
  expect(requests.filter(request=>request.method!=="GET")).toEqual([]);
  await expect(page.locator("#results-body")).not.toContainText("Temporarily unavailable");
});

test("a parcel boundary over the limit is posted, and the answers still render",async({page})=>{
  const limit=await page.evaluate(()=>CFG.request.maxUrlBytes);
  const requests=await lookupWithGeometry(page,ringOf(VERTICES_JUST_OVER));
  const spatial=polygonQueries(requests);
  expect(spatial.length,"the lookup really queried polygon layers").toBeGreaterThan(3);
  const shortest=Math.min(...spatial.map(request=>byteLength(fullUrlOf(request))));
  expect(shortest,"the fixture must sit over the limit to prove anything").toBeGreaterThan(limit);
  for(const request of spatial){
    expect(request.method,fullUrlOf(request).slice(0,120)).toBe("POST");
    expect(request.body).toContain("geometry=");
    // The geometry moved out of the URL rather than being duplicated into both.
    expect(request.url).not.toContain("geometry=");
    expect(request.url.endsWith("/query"),"the POST goes to the same endpoint").toBe(true);
  }
  // The defect in one line: this is what the resident used to be told instead.
  await expect(page.locator("#results-body")).not.toContainText("Temporarily unavailable");
  await expect(page.locator("#results-body")).toContainText("In the 2026 Wildland-Urban Interface");
});

test("a 200-vertex parcel posts every polygon query and renders a real answer",async({page})=>{
  const requests=await lookupWithGeometry(page,ringOf(200));
  const spatial=polygonQueries(requests);
  expect(spatial.length).toBeGreaterThan(3);
  expect(spatial.every(request=>request.method==="POST")).toBe(true);
  await expect(page.locator("#results-body")).not.toContainText("Temporarily unavailable");
  // A polygon layer's real answer, carried through the POST branch.
  await expect(page.locator("#results-body"))
    .toContainText("In FEMA Special Flood Hazard Area (SFHA)");
  await expect(page.locator(".pair",{hasText:"In FEMA Special Flood Hazard Area"}))
    .toContainText("Yes");
});

test("no GET request in any lookup exceeds the configured URL limit",async({page})=>{
  const limit=await page.evaluate(()=>CFG.request.maxUrlBytes);
  for(const geometry of [null,ringOf(VERTICES_JUST_UNDER),ringOf(VERTICES_JUST_OVER),ringOf(200)]){
    const requests=await lookupWithGeometry(page,geometry);
    const oversized=requests.filter(request=>request.method==="GET"&&
      byteLength(request.url)>limit).map(request=>byteLength(request.url));
    expect(oversized,"GET request URLs over the limit are what the service 404s").toEqual([]);
  }
});

/* No query anywhere requests outFields=* (A2, 10 September 2026). Every layer
   query names exactly the fields it renders plus its object id; the parcel
   record and address suggestion queries name their own already-explicit
   lists and are exempt from the object id requirement below — a resident's
   address point and parcel record are not identified by ArcGIS object id
   anywhere in the page. mockArcGIS() now honours whatever outFields a request
   actually sent (see filterAttributes above), so a rendered-but-unrequested
   field fails the page's own content assertions rather than passing silently. */
test("every query names its fields explicitly, and every layer query includes its object id field",
  async({page})=>{
  const requests=await lookupWithGeometry(page,null);
  const queryRequests=requests.filter(request=>new URL(request.url).pathname.endsWith("/query"));
  expect(queryRequests.length,"the lookup issues real /query requests").toBeGreaterThan(10);

  for(const request of queryRequests){
    const outFields=outFieldsOf(request);
    expect(outFields,"a /query request must name its fields: "+fullUrlOf(request)).toBeTruthy();
    expect(outFields.split(","),"no /query request may carry outFields=*: "+fullUrlOf(request))
      .not.toContain("*");
  }

  const serviceOf=request=>serviceName(new URL(request.url).pathname);
  const layerRequests=queryRequests.filter(request=>{
    const service=serviceOf(request);
    return service!=="Address_Points"&&service!=="Millcreek_Parcels";
  });
  expect(layerRequests.length,"the lookup queries configured layers").toBeGreaterThan(8);
  for(const request of layerRequests){
    const oid=oidFieldFor(serviceOf(request));
    expect(outFieldsOf(request).split(","),
      "layer query for "+serviceOf(request)+" must request its object id field "+oid+
      ": "+fullUrlOf(request)).toContain(oid);
  }

  // Address suggestion and parcel record queries are exempt from the object
  // id rule above; assert their own already-known explicit field lists here.
  const addressRequests=queryRequests.filter(request=>serviceOf(request)==="Address_Points");
  expect(addressRequests.length,"the lookup queries address suggestions").toBeGreaterThan(0);
  for(const request of addressRequests)
    expect(outFieldsOf(request)).toBe("FullAdd,ParcelID,City,ZipCode,UnitType,UnitID");

  const parcelRequests=queryRequests.filter(request=>serviceOf(request)==="Millcreek_Parcels");
  expect(parcelRequests.length,"the lookup queries the parcel record").toBeGreaterThan(0);
  for(const request of parcelRequests){
    const fields=outFieldsOf(request).split(",");
    expect(new Set(fields).size,"the parcel query's field list has no duplicates").toBe(fields.length);
    expect(fields).toEqual(expect.arrayContaining([
      "parcel_id","parcel_latitude","parcel_longitude",
      "own_name","care_of","slc_link",
      "prop_location","parcel_acres","property_type_code","year_built",
      "total_sq_ft","num_housing_units","tax_dist","prop_zip"
    ]));
  }
});

/* Deep links (A6). A link from the planning map's own Property information
   popup can open this page by parcel id or by address, and a successful
   lookup makes the URL itself shareable — replaceState only, parcel id only.
   See SECURITY.md and CODE.md for why a typed address is never written. */

test("a parcel deep link loads the report with no typing and announces readiness",async({page})=>{
  await page.goto("/index.html?parcel=16264570030000");
  await expect(page.locator("#q")).toHaveValue("");
  await expect(page.locator("#status")).toContainText("Results ready");
  await expect(page.locator("#results")).toBeVisible();
  await expect(page.locator("#r-head")).toContainText("3300 E SANTA ROSA AVE");
});

test("an address deep link runs the same tiered search as typing it",async({page})=>{
  await page.goto("/index.html?address=3300%20E%20Santa%20Rosa%20Ave");
  await expect(page.locator("#q")).toHaveValue("3300 E Santa Rosa Ave");
  await expect(page.locator("#results")).toBeVisible();
  await expect(page.locator("#status")).toContainText("Results ready");
});

test("a normal lookup replaces the URL with the loaded parcel id",async({page})=>{
  await loadKnownProperty(page);
  await expect.poll(()=>new URL(page.url()).search).toBe("?parcel=16264570030000");
});

test("a failed lookup leaves the URL alone",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{parcelNotFound:true});
  await page.reload();
  // Starts from a plain URL, not a deep link, so a wrongly-added ?parcel=
  // would be unmistakable rather than coinciding with a query string already
  // there (the deep-linked parcel id and the loaded parcel id are the same
  // value, which would otherwise mask a bug that fires replaceState anyway).
  expect(new URL(page.url()).search).toBe("");
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await expect(page.locator("#sugg")).toBeVisible();
  await page.locator("#q").press("ArrowDown");
  await page.locator("#q").press("Enter");
  await expect(page.locator("#status")).toContainText("No parcel found");
  expect(new URL(page.url()).search).toBe("");
});

test("lookup, Clear, and reload leaves the form empty",async({page})=>{
  await loadKnownProperty(page);
  await expect.poll(()=>new URL(page.url()).search).toBe("?parcel=16264570030000");
  await page.locator("#clear").click();
  expect(new URL(page.url()).search).toBe("");
  await page.reload();
  await expect(page.locator("#q")).toHaveValue("");
  await expect(page.locator("#results")).toBeHidden();
});

test("Clear on an address deep link removes the query parameter",async({page})=>{
  await page.goto("/index.html?address=3300%20E%20Santa%20Rosa%20Ave");
  await expect(page.locator("#results")).toBeVisible();
  await page.locator("#clear").click();
  expect(new URL(page.url()).search).toBe("");
  await expect(page.locator("#q")).toHaveValue("");
});

test("the map link carries lon, lat and scale for the loaded property",async({page})=>{
  await loadKnownProperty(page);
  const href=await page.getByRole("link",{name:"interactive zoning map"}).getAttribute("href");
  const url=new URL(href);
  expect(url.origin+url.pathname).toBe("https://planning.gis.millcreekut.gov/");
  expect(url.searchParams.get("lon")).toBe("-111.815000");
  expect(url.searchParams.get("lat")).toBe("40.699000");
  expect(url.searchParams.get("scale")).toBe("2000");
});

/* MAP-001: a parcel the County stores with no point. The link used to carry
   ?lon=0.000000&lat=0.000000, sending a resident who wanted to see their
   property to a spot in the Gulf of Guinea. */
test("a parcel with no stored coordinates links to the map's default view (MAP-001)",
  async({page})=>{
  await coverageLookup(page,{parcel:{parcel_latitude:null,parcel_longitude:null}});
  const href=await page.getByRole("link",{name:"interactive zoning map"}).getAttribute("href");
  expect(href).toBe("https://planning.gis.millcreekut.gov/");
  expect(href).not.toContain("lon=");
  expect(href).not.toContain("0.000000");
  // The coordinate row answers from the same validated pair, so it does not
  // print a false zero either.
  await expect(page.locator(".pair",{hasText:"Latitude, longitude"})).toHaveCount(0);
  // The rest of the report is unaffected: a missing point is not a failed page.
  await expect(page.locator("#results-body")).toContainText("Parcel number");
});

test("a blank or out-of-range stored coordinate does not become a map link either (MAP-001)",
  async({page})=>{
  for(const parcel of [{parcel_latitude:"",parcel_longitude:""},
    {parcel_latitude:40.699,parcel_longitude:"   "},
    {parcel_latitude:200,parcel_longitude:-111.815}]){
    await coverageLookup(page,{parcel});
    const href=await page.getByRole("link",{name:"interactive zoning map"}).getAttribute("href");
    expect(href,JSON.stringify(parcel)).toBe("https://planning.gis.millcreekut.gov/");
  }
});

test("a parcel deep link produces no detectable axe violations",async({page})=>{
  await page.goto("/index.html?parcel=16264570030000");
  await expect(page.locator("#results")).toBeVisible();
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
});
