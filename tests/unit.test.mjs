import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "index.html contains an inline script");
const licensingHtml = await readFile(new URL("../business-licensing.html", import.meta.url), "utf8");
const licensingScript = licensingHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(licensingScript, "business-licensing.html contains an inline script");

function pureApp(){
  const cfgStart = script.indexOf("const CFG =");
  const cfgEnd = script.indexOf("/* ==================================================================\n   No further edits");
  const helperStart = script.indexOf("const decode");
  const helperEnd = script.indexOf("/* Tiered search");
  return vm.runInNewContext(
    script.slice(cfgStart,cfgEnd)+"\n"+script.slice(helperStart,helperEnd)+
    "\n;({CFG,parseAddress,decode,floodRank,selectHighestFlood,selectHighestCategory,floodClassSet,"+
    "sameSet,matchSummary});"
  );
}

function businessConfig(){
  const start=licensingScript.indexOf("const CFG =");
  const end=licensingScript.indexOf("/* ==================================================================\n   No further edits");
  return vm.runInNewContext(licensingScript.slice(start,end)+"\n;CFG;");
}

/* Two pages, one request layer, held byte-identical on purpose.

   ADR-0001 replaces both inline scripts with shared modules. Divergent copies would
   force a merge decision per difference during that migration, with no tests on the
   differences; identical copies extract mechanically and the diff proves parity.
   This is the guard that keeps them from drifting apart again in the meantime. */
function sharedRegion(src,name){
  const start=src.indexOf("/* ==== SHARED "+name);
  const end=src.indexOf("/* ==== END SHARED "+name);
  assert.ok(start>=0,name+" region has no opening marker");
  assert.ok(end>start,name+" region has no closing marker after its opening marker");
  return src.slice(start,end);
}

test("both pages carry one byte-identical request layer",()=>{
  assert.equal(sharedRegion(licensingScript,"REQUEST LAYER"),sharedRegion(script,"REQUEST LAYER"));
});

test("the shared request layer classifies errors and retries only transient ones",()=>{
  const region=sharedRegion(script,"REQUEST LAYER");
  assert.match(region,/function svcError/);
  assert.match(region,/\["network","busy","server","timeout"\]\.includes/);
  assert.match(region,/function explain/);
  // Both pages need a contact number for explain() to offer the staffed route.
  assert.match(pureApp().CFG.contact.phone,/^\d{3}-\d{3}-\d{4}$/);
  assert.match(businessConfig().contact.phone,/^\d{3}-\d{3}-\d{4}$/);
});

test("the inline production JavaScript parses",()=>{
  assert.doesNotThrow(()=>new Function(script));
  assert.doesNotThrow(()=>new Function(licensingScript));
});

test("address normalization handles words, locality suffixes, and units",()=>{
  const {parseAddress}=pureApp();
  const expected={num:"3300",street:"SANTA ROSA",normalized:"3300 E SANTA ROSA AVE"};
  assert.deepEqual({...parseAddress("3300 East Santa Rosa Avenue")},expected);
  assert.deepEqual({...parseAddress("3300 E Santa Rosa Ave, Millcreek, UT 84109")},expected);
  assert.deepEqual({...parseAddress("3300 E Santa Rosa Ave #3")},expected);
  assert.deepEqual({...parseAddress("3300 E Santa Rosa Ave Apt 4")},expected);
  assert.deepEqual({...parseAddress("2760 South 2100 East")},
    {num:"2760",street:"2100",normalized:"2760 S 2100 E"});
});

test("an uncapped suggestion list is announced as a complete count",()=>{
  const {matchSummary}=pureApp();
  assert.match(matchSummary(1,false),/^1 address match\./);
  assert.match(matchSummary(1,false),/Down arrow/);
  assert.match(matchSummary(4,false),/^4 address matches\./);
  assert.doesNotMatch(matchSummary(4,false),/first|narrow/i);
});

test("a capped suggestion list says it is partial and how to narrow it",()=>{
  const {matchSummary}=pureApp();
  const capped=matchSummary(10,true);
  // "10 address matches" is a lie when the service capped 49 matches at 10, and
  // the resident's own address may not be among the ten shown.
  assert.match(capped,/first 10/);
  assert.match(capped,/More addresses match/);
  assert.match(capped,/narrow/i);
  assert.doesNotMatch(capped,/^10 address matches/);
});

// A hardcoded debounce makes the "stale selection" and "superseded lookup" races
// untestable: a slow CI run lets the timer fire and the test passes for the wrong
// reason. Both pages expose the delay so tests can hold the window open.
test("both pages expose the suggestion debounce delay as configuration",()=>{
  const {CFG}=pureApp();
  assert.equal(typeof CFG.request.suggestDebounceMs,"number");
  assert.ok(CFG.request.suggestDebounceMs>0);
  assert.equal(typeof businessConfig().request.suggestDebounceMs,"number");
});

test("hazards use the requested source layers and cross-check FEMA classifications",()=>{
  const {CFG,floodRank,selectHighestFlood,selectHighestCategory,floodClassSet,sameSet}=pureApp();
  assert.deepEqual([...CFG.PARCEL_FLAGS],[]);
  assert.match(CFG.LAYERS.find(layer=>layer.kind==="femaFlood").url,/hazards\.fema\.gov/);
  assert.match(CFG.LAYERS.find(layer=>layer.key==="flood_local").url,/Flood_Hazard_Zones_Final_Update/);
  assert.match(CFG.LAYERS.find(layer=>layer.key==="fault").url,/Fault_Study_Area/);
  const minimal={FLD_ZONE:"X",ZONE_SUBTY:"AREA OF MINIMAL FLOOD HAZARD",SFHA_TF:"F"};
  const floodway={FLD_ZONE:"AE",ZONE_SUBTY:"FLOODWAY",SFHA_TF:"T"};
  const localFloodway={FLD_ZONE:"AE",ZONE_SUBTY:"Floodway",SFHA_TF:"T"};
  assert.ok(floodRank(floodway)>floodRank(minimal));
  assert.equal(selectHighestFlood([minimal,floodway]),floodway);
  assert.equal(sameSet(floodClassSet([minimal,floodway],{omitMinimal:true}),
    floodClassSet([localFloodway],{omitMinimal:true})),true);
  const high={POTENTIAL:"High"},moderate={POTENTIAL:"Moderate"};
  assert.equal(selectHighestCategory([moderate,high],"POTENTIAL",["Very Low","Moderate","High"]),high);
});

test("informational hazards stay separate from regulatory hazard results",()=>{
  const {CFG}=pureApp();
  const info=CFG.LAYERS.filter(layer=>layer.group==="Informational hazard screening");
  assert.deepEqual([...info.map(layer=>layer.key)],["liquefaction","debris_flow","alluvial_fan"]);
  assert.ok(info.every(layer=>layer.geometryMode==="parcel"));
  assert.match(CFG.GROUP_NOTES["Informational hazard screening"],/do not drive a Millcreek ordinance/i);
});

test("the licensing page is limited to published STR parcels and buffers",()=>{
  const CFG=businessConfig();
  assert.match(CFG.rental.url,/Short_Term_Rentals_June_2026\/FeatureServer\/0/);
  assert.match(CFG.buffer.url,/Short_Term_Rentals_June_2026\/FeatureServer\/1/);
  assert.equal(CFG.buffer.distanceField,"BUFF_DIST");
  assert.doesNotMatch(licensingHtml,/own_name|own_addr|zoning district|FEMA flood/i);
  assert.match(licensingHtml,/801-214-2759/);
  assert.doesNotMatch(licensingHtml,/801-214-2754/);
});

test("zoning follows the public map and does not display density",()=>{
  const {CFG}=pureApp();
  const zone=CFG.LAYERS.find(layer=>layer.key==="zone");
  const future=CFG.LAYERS.find(layer=>layer.key==="futureland");
  assert.match(zone.url,/Zone_Update_2025___Related_Master/);
  assert.equal(Object.hasOwn(zone.fields,"Res_Max_De"),false);
  assert.match(future.url,/FutureLandUse_2024_Millcreek/);
});

test("configured fields retain valid numeric zero values",()=>{
  const {CFG}=pureApp();
  const area=CFG.PARCEL_FACTS.find(([field])=>field==="total_sq_ft");
  const units=CFG.PARCEL_FACTS.find(([field])=>field==="num_housing_units");
  assert.equal(area[2](0),"0");
  assert.equal(units[2](0),"0");
});

test("every displayed layer carries source-governance metadata",()=>{
  const {CFG}=pureApp();
  for(const layer of CFG.LAYERS.filter(layer=>!layer.hidden)){
    assert.ok(layer.sourceOwner,layer.key+" source owner");
    assert.match(layer.reviewedOn,/^\d{4}-\d{2}-\d{2}$/,layer.key+" review date");
    assert.ok(["one","many"].includes(layer.cardinality),layer.key+" cardinality");
  }
});

test("security policy permits authoritative sources and Planning uses its own contact",async()=>{
  const headers=await readFile(new URL("../_headers",import.meta.url),"utf8");
  assert.match(headers,/connect-src[^\n]+https:\/\/hazards\.fema\.gov/);
  assert.match(html,/Planning &amp; Zoning[\s\S]{0,200}801-214-2700/);
  assert.doesNotMatch(html,/Planning and Development Services[\s\S]{0,100}801-214-2754/);
});

test("current documentation does not advertise removed features or stale deployment state",async()=>{
  const readme=await readFile(new URL("../README.md",import.meta.url),"utf8");
  const changes=await readFile(new URL("../CHANGES-2026-08-06.md",import.meta.url),"utf8");
  assert.doesNotMatch(readme,/firework restrictions/i);
  assert.match(changes,/resolved/i);
});
