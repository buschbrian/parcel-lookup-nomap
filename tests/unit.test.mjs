import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "index.html contains an inline script");

function pureApp(){
  const cfgStart = script.indexOf("const CFG =");
  const cfgEnd = script.indexOf("/* ==================================================================\n   No further edits");
  const helperStart = script.indexOf("const decode");
  const helperEnd = script.indexOf("/* Tiered search");
  return vm.runInNewContext(
    script.slice(cfgStart,cfgEnd)+"\n"+script.slice(helperStart,helperEnd)+
    "\n;({CFG,parseAddress,decode,floodRank,selectHighestFlood});"
  );
}

test("the inline production JavaScript parses",()=>{
  assert.doesNotThrow(()=>new Function(script));
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

test("hazards use live source layers and select the highest FEMA subtype",()=>{
  const {CFG,floodRank,selectHighestFlood}=pureApp();
  assert.deepEqual([...CFG.PARCEL_FLAGS],[]);
  assert.match(CFG.LAYERS.find(layer=>layer.kind==="femaFlood").url,/hazards\.fema\.gov/);
  assert.match(CFG.LAYERS.find(layer=>layer.kind==="ugsFaultProximity").url,/geology\.utah\.gov/);
  const minimal={FLD_ZONE:"X",ZONE_SUBTY:"AREA OF MINIMAL FLOOD HAZARD",SFHA_TF:"F"};
  const floodway={FLD_ZONE:"AE",ZONE_SUBTY:"FLOODWAY",SFHA_TF:"T"};
  assert.ok(floodRank(floodway)>floodRank(minimal));
  assert.equal(selectHighestFlood([minimal,floodway]),floodway);
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
  assert.match(headers,/connect-src[^\n]+https:\/\/webmaps\.geology\.utah\.gov/);
  assert.match(html,/Planning &amp; Zoning[\s\S]{0,200}801-214-2700/);
  assert.doesNotMatch(html,/Planning and Development Services[\s\S]{0,100}801-214-2754/);
});

test("current documentation does not advertise removed features or stale deployment state",async()=>{
  const readme=await readFile(new URL("../README.md",import.meta.url),"utf8");
  const changes=await readFile(new URL("../CHANGES-2026-08-06.md",import.meta.url),"utf8");
  assert.doesNotMatch(readme,/firework restrictions/i);
  assert.match(changes,/resolved/i);
});
