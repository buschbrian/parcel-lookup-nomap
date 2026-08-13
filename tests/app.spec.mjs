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

const layerFeatures={
  Zone_Update_2025___Related_Master:[{ZONE_:"R-1-8",ZONE_DESC:"Residential",
    Zone_Desc1:"https://example.test/zoning"}],
  FutureLandUse_2024_Millcreek:[{LandUse:"Neighborhood 1",GENPLAN_WEBSITE:"https://example.test/plan",
    GENPLAN_DOCUMENT:"https://example.test/document"}],
  HistoricDistricts:[], Zone_TCOZ:[], WUI:[], Sensitive_Land_Areas__Feb24:[],
  Subdivision_Dissovle_3:[{OBJECTID:7,SUB_PLAT:"EL SERRITO 2",PLAT_NUM:"22"}],
  FEMA_NFHL:[
    {FLD_ZONE:"X",ZONE_SUBTY:"AREA OF MINIMAL FLOOD HAZARD",SFHA_TF:"F",
      STATIC_BFE:-9999,LEN_UNIT:"Feet",SOURCE_CIT:"Mock FIRM"},
    {FLD_ZONE:"AE",ZONE_SUBTY:"FLOODWAY",SFHA_TF:"T",
      STATIC_BFE:4387,LEN_UNIT:"Feet",SOURCE_CIT:"Mock FIRM"}
  ],
  Flood_Hazard_Zones_Final_Update:[
    {FLD_ZONE:"AE",ZONE_SUBTY:"Floodway",SFHA_TF:"T"}
  ],
  Fault_Study_Area:[],
  LiquefactionPotential:[
    {POTENTIAL:"Moderate",Lqf_Desc:"Moderate published potential."},
    {POTENTIAL:"High",Lqf_Desc:"High published potential."}
  ],
  DebrisFlow_WasatchFront_ClipBuffer:[{OBJECTID:31,Hazard:"Debris Flow"}],
  AlluvialFans:[{OBJECTID:41,GEODESCSHORT:"Fan alluvium"}],
  Millcreek_City_Council_Dist_2022:[{DIST:"1",COUNCILMEMBER:"Example Member",
    WEB:"https://example.test/council"}],
  TrashPickupDays:[{PickupDay:"Tuesday",phonenumberfix:"385-468-6325",
    websitelink:"https://example.test/waste"}],
  SewerDistrictsUpdated:[{District:"Mount Olympus Improvement District",Phone:"801-262-2904"}],
  Water_Services_2021:[{DWNAME:"Salt Lake City Water System",phone:"801-483-6900",
    webpublic:"https://example.test/water"}],
  Electrical_Service:[{PROVIDER:"Rocky Mountain Power",TELEPHONE:"1-888-221-7070",
    WEBLINK:"https://example.test/power",NOTES:""}]
};

function serviceName(pathname){
  if(pathname.includes("/public/NFHL/MapServer/28")) return "FEMA_NFHL";
  if(pathname.includes("Millcreek_Wildland_Urban_Interface")) return "WUI";
  const match=pathname.match(/\/services\/([^/]+)\/FeatureServer/i);
  return match?.[1]||"";
}

async function mockArcGIS(page,state={}){
  await page.route("**/arcgis/rest/services/**",async route=>{
    const url=new URL(route.request().url());
    const path=url.pathname;
    const name=serviceName(path);
    const json=body=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});

    if(path.endsWith("/attachments")){
      if(state.attachmentFailure) return route.fulfill({status:500,body:"temporary failure"});
      // Some services omit `size`. Math.round(undefined/1024) renders "NaN KB".
      if(state.attachmentWithoutSize)
        return json({attachmentInfos:[{id:9,name:"El Serrito 2.pdf",contentType:"application/pdf"}]});
      return json({attachmentInfos:[{id:9,name:"El Serrito 2.pdf",contentType:"application/pdf",size:2472960}]});
    }
    if(path.endsWith("/query")){
      if(name==="Address_Points"){
        // ArcGIS caps a result set at resultRecordCount and reports the cap with
        // exceededTransferLimit. Real streets exceed the cap: "Santa Rosa" matches 49.
        if(state.addressOverflow) return json({
          features:Array.from({length:10},(unused,index)=>({attributes:{...address,
            FullAdd:"33"+index+"0 E SANTA ROSA AVE",
            ParcelID:"1626457003000"+index}})),
          exceededTransferLimit:true
        });
        if(state.cappedToOneUsableMatch) return json({
          features:[{attributes:address},
            ...Array.from({length:9},()=>({attributes:{...address,ParcelID:null}}))],
          exceededTransferLimit:true
        });
        return json({features:[{attributes:address}]});
      }
      if(name==="Millcreek_Parcels"){
        if(state.delayParcel) await new Promise(resolve=>setTimeout(resolve,state.delayParcel));
        const feature={attributes:parcel(state.parcel)};
        if(!state.omitParcelGeometry) feature.geometry={rings:[[
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
        features.push({DWNAME:"Overlapping Provider",phone:"801-555-0100",webpublic:"https://example.test/overlap"});
      return json({features:features.map(attributes=>({attributes}))});
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
  expect(copied).toContain("not a zoning verification letter");
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
  await expect(card).toContainText("do not drive a Millcreek ordinance");
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

test("full-parcel layers are unavailable when parcel geometry is missing",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{omitParcelGeometry:true});
  await page.reload();
  await page.evaluate(()=>{ CFG.request.retryDelayMs=1; });
  await loadKnownProperty(page);
  await expect(page.locator(".pair",{hasText:"FEMA flood hazard"}))
    .toContainText("Temporarily unavailable");
  await expect(page.locator("#status")).toContainText("data source issue");
});

test("full-parcel layers still run when parcel centroid coordinates are missing",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{parcel:{parcel_latitude:null,parcel_longitude:null}});
  await page.reload();
  await loadKnownProperty(page);
  await expect(page.locator(".pair",{hasText:"In FEMA Special Flood Hazard Area"}))
    .toContainText("Yes");
  await expect(page.locator(".pair",{hasText:"Base zoning"}))
    .toContainText("Temporarily unavailable");
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
