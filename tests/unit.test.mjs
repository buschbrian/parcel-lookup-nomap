import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

/* Entry HTML moved from `public/` to the repository root in ADR-0001 step 1,
   because Vite copies `publicDir` verbatim and would have bypassed the build.
   Read through the shared resolver rather than a hardcoded path, so this file
   does not have to change again at the next structural step. */
import { readApp, readBusinessApp } from "../scripts/app-config.mjs";

const { html } = await readApp();
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, "index.html contains an inline script");
const { html: licensingHtml } = await readBusinessApp();
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
    "sameSet,matchSummary,esc,likeOperand,outFieldsFor,parcelOutFields,"+
    "pointInRings,probePoints,validCoordinate,coverageIdentity,readFeatureRows,groupByDesignation,"+
    "coverageState,"+
    "coverageSentences,coverageFlag,parcelFromQuery,addressFromQuery,mapLinkUrl,spokenDate});"
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

/* The shared block, evaluated on its own against stubbed platform globals.

   transportFor() decides whether a resident's query reaches the service at all,
   and the decision turns on a single byte, which no browser test can place
   precisely. It has to live inside the byte-identical region because both pages
   call it, so it cannot move into the pureApp() region; this extractor reaches
   into the region instead. A fresh vm context has none of the web globals the
   block closes over, so they are supplied here. */
function sharedBlock(){
  const region=sharedRegion(script,"REQUEST LAYER");
  return vm.runInNewContext(region+"\n;({transportFor,layerUrl,svcError,explain});",{
    CFG:{org:"https://services9.arcgis.com/XRrSFvEwSsReIxuA/arcgis/rest/services",
      request:{timeoutMs:12000,retryDelayMs:1,maxConcurrent:12,maxUrlBytes:1900},
      contact:{phone:"801-214-2759"}},
    location:{protocol:"https:"},
    fetch:async()=>({ok:true,status:200,json:async()=>({})}),
    AbortController,URL,URLSearchParams,TextEncoder,setTimeout,clearTimeout
  });
}

/* Verified 10 September 2026 against the live service: parcel 16273550010000
   encodes to a ~3,700-byte query, every hosted polygon layer answered HTTP 404
   to it as a GET, and the identical parameters answered 200 as a POST. About 12
   of every 1,000 parcels are over the limit, so those residents saw
   "Temporarily unavailable" on every polygon-queried layer. */
test("the shared transport rule switches to POST past the configured URL byte limit",()=>{
  const {transportFor}=sharedBlock();
  const cfg={request:{maxUrlBytes:1900}};
  const urlOfBytes=(prefix,bytes)=>prefix+"a".repeat(bytes-Buffer.byteLength(prefix));
  // Two service paths of different lengths: the limit is on the whole URL, so a
  // longer path must leave less room for the geometry rather than shifting the
  // switch point.
  const shortPath="https://services9.arcgis.com/x/FeatureServer/0/query?geometry=";
  const longPath="https://services9.arcgis.com/XRrSFvEwSsReIxuA/arcgis/rest/services/"+
    "Sensitive_Land_Areas__Feb24/FeatureServer/0/query?f=json&returnGeometry=false&geometry=";
  for(const prefix of [shortPath,longPath]){
    assert.equal(transportFor(urlOfBytes(prefix,1899),cfg),"GET");
    assert.equal(transportFor(urlOfBytes(prefix,1900),cfg),"GET","the limit itself still fits");
    assert.equal(transportFor(urlOfBytes(prefix,1901),cfg),"POST");
  }
  // Bytes, not characters. A URL counted in characters would be let through at
  // 1,900 characters and rejected by the service at 1,901 bytes.
  const multibyte=urlOfBytes(shortPath,1899).slice(0,-1)+"é";
  assert.equal(Buffer.byteLength(multibyte),1900);
  assert.equal(multibyte.length,1899);
  assert.equal(transportFor(multibyte,cfg),"GET");
  assert.equal(transportFor(multibyte+"a",cfg),"POST");
  // No limit configured is the old behaviour, not a page that posts everything.
  assert.equal(transportFor(urlOfBytes(shortPath,4000),{request:{}}),"GET");
});

test("both pages configure the URL byte limit the shared layer reads",()=>{
  for(const cfg of [pureApp().CFG,businessConfig()]){
    assert.equal(typeof cfg.request.maxUrlBytes,"number");
    // Under the service's ~2,048-byte ceiling, with room for proxies in between.
    assert.ok(cfg.request.maxUrlBytes>0&&cfg.request.maxUrlBytes<=2000);
  }
  assert.match(sharedRegion(script,"REQUEST LAYER"),
    /Requires from CFG:[\s\S]*?request\.maxUrlBytes/,
    "the shared block's Requires-from-CFG list names every key it reads");
});

/* The monitor has to reach the services the way the pages do. If it sent long
   geometries as GET while the pages posted them, it would fail parcels that work
   and, worse, could pass a transport no resident actually gets. */
test("the service monitor carries the page's transport rule verbatim",async()=>{
  const core=await readFile(new URL("../scripts/service-contract-core.mjs",import.meta.url),"utf8");
  const transportSource=(source,where)=>{
    const start=source.indexOf("function transportFor");
    assert.ok(start>=0,where+" has no transportFor");
    const end=source.indexOf("\n}\n",start);
    assert.ok(end>start,where+" transportFor has no closing brace");
    return source.slice(start,end+3);
  };
  assert.equal(transportSource(core,"service-contract-core.mjs"),
    transportSource(sharedRegion(script,"REQUEST LAYER"),"the shared request layer"));
});

/* No query anywhere requests outFields=* (A2, 10 September 2026). Every layer
   query asks for exactly the fields it renders plus the layer's object id;
   the parcel record query asks for exactly the parcel facts, owner fields and
   coordinates the page displays. scripts/service-contract-core.mjs carries
   the same formula for the live monitor — this compares the page's inline
   duplicate against it field for field, the same discipline as the
   transportFor comparison above. */
test("the page's explicit field lists agree with the live monitor's",async()=>{
  const {layerFieldList,parcelFieldList}=
    await import("../scripts/service-contract-core.mjs");
  const {CFG,outFieldsFor,parcelOutFields}=pureApp();
  assert.equal(parcelOutFields(),parcelFieldList(CFG).join(","),
    "the parcel query's field list must match what check-services.mjs verifies against "+
    "the live service");
  for(const L of CFG.LAYERS)
    assert.equal(outFieldsFor(L),layerFieldList(L).join(","),
      L.key+": the layer query's field list must match what check-services.mjs verifies "+
      "against the live service");
});

/* Verified 10 September 2026 against the live service metadata
   (<url>?f=json -> objectIdField): these two layers are the only ones whose
   object id field is not the ArcGIS default "OBJECTID". Getting this wrong
   would make outFieldsFor() ask for a field the service does not have, and
   check-services.mjs's schema contract for that layer would fail. */
test("the two layers whose object id field is not OBJECTID are configured",()=>{
  const {CFG}=pureApp();
  const byKey=key=>CFG.LAYERS.find(L=>L.key===key);
  assert.equal(byKey("ccoz").oidField,"OBJECTID_1");
  assert.equal(byKey("council").oidField,"OBJECTID_12");
  // Every other layer relies on the default, so it must not declare an override
  // that was never verified.
  for(const L of CFG.LAYERS)
    if(L.key!=="ccoz"&&L.key!=="council")
      assert.equal(L.oidField,undefined,L.key+" has an unverified oidField override");
});

/* The self-configuring fallback (first three non-JUNK attributes) exists for a
   layer added without `fields`, and it is how an irrelevant Salt Lake County
   contact once appeared under Services (USAGE.md). Every currently configured
   non-boolean layer names `fields` explicitly, so the fallback renders for
   none of them today. This keeps that fact asserted rather than assumed, so a
   layer added later without `fields` is a deliberate, visible choice. */
test("the unconfigured-layer fallback renderer is currently unreachable",()=>{
  const {CFG}=pureApp();
  // CFG.LAYERS is an array from pureApp()'s own vm sandbox realm, so compare
  // its length rather than deepEqual it against a host-realm array literal —
  // deepStrictEqual treats same-shaped arrays from different realms as unequal.
  const unconfigured=CFG.LAYERS.filter(L=>!L.boolean&&!L.fields).map(L=>L.key);
  assert.equal(unconfigured.length,0,
    "every non-boolean layer must configure `fields`, or the self-configuring fallback "+
    "renders for it silently — see USAGE.md's fireworks-layer warning. Unconfigured: "+
    Array.prototype.join.call(unconfigured,", "));
});

/* ===========================================================================
   Polygon coverage (A3, 10 September 2026).

   These layers stopped answering from the parcel's stored point and started
   answering from the whole boundary. The state model below decides what a
   resident is told about their own zoning, so it is asserted case by case
   rather than through the rendered page: an overclaim here would be confident,
   plausible and wrong.
   =========================================================================== */
const SQUARE=[[[0,0],[10,0],[10,10],[0,10],[0,0]]];
const SQUARE_WITH_HOLE=[...SQUARE,[[4,4],[6,4],[6,6],[4,6],[4,4]]];
const TWO_PARTS=[...SQUARE,[[20,0],[30,0],[30,10],[20,10],[20,0]]];

test("a point is inside a polygon only when it is inside a ring and outside every hole",()=>{
  const {pointInRings}=pureApp();
  assert.equal(pointInRings(SQUARE,5,5),true);
  assert.equal(pointInRings(SQUARE,15,5),false,"outside the ring");
  assert.equal(pointInRings(SQUARE_WITH_HOLE,5,5),false,"inside the hole is outside the polygon");
  assert.equal(pointInRings(SQUARE_WITH_HOLE,2,2),true,"inside the ring, outside the hole");
  assert.equal(pointInRings(TWO_PARTS,25,5),true,"inside the second part");
  assert.equal(pointInRings(TWO_PARTS,15,5),false,"between the two parts");
  // On the ring is rejected, not counted. A probe on a boundary is equally
  // consistent with the district covering the property and with it touching the
  // edge, and the edge touch is exactly what must not be reported as coverage.
  assert.equal(pointInRings(SQUARE,0,0),false,"on a vertex");
  assert.equal(pointInRings(SQUARE,5,0),false,"on an edge");
  assert.equal(pointInRings(SQUARE_WITH_HOLE,4,5),false,"on a hole's edge");
});

test("probe points are inside the boundary, rounded first, capped and deterministic",()=>{
  const {probePoints}=pureApp();
  const cfg={probeGrid:5,maxProbes:25,coordDecimals:6};
  const points=probePoints({rings:SQUARE},cfg,[5,5]);
  assert.equal(points.length,25,"the stored point plus the grid, capped at maxProbes");
  assert.ok(points.every(([x,y])=>x>0&&x<10&&y>0&&y<10),"every probe is inside the boundary");
  assert.deepEqual(probePoints({rings:SQUARE},cfg,[5,5]),points,"the same parcel probes the same way");
  // The cap is a real limit, not an aspiration: 25 grid centres plus a stored
  // point is 26 candidates.
  assert.ok(points.length<=cfg.maxProbes);
  // Rounded to coordDecimals BEFORE the inside test, so what is sent is what was
  // proven inside.
  assert.ok(probePoints({rings:SQUARE},{...cfg,coordDecimals:2},null)
    .every(([x,y])=>Number(x.toFixed(2))===x&&Number(y.toFixed(2))===y));
});

test("the stored point is a probe like any other and is dropped when it fails",()=>{
  const {probePoints}=pureApp();
  const cfg={probeGrid:2,maxProbes:25,coordDecimals:6};
  const has=(points,x,y)=>points.some(([px,py])=>px===x&&py===y);
  assert.equal(has(probePoints({rings:SQUARE},cfg,[50,50]),50,50),false,"exterior stored point");
  assert.equal(has(probePoints({rings:SQUARE_WITH_HOLE},cfg,[5,5]),5,5),false,
    "a stored point inside a hole");
  assert.equal(has(probePoints({rings:SQUARE},cfg,[0,0]),0,0),false,"a stored point on the ring");
  assert.equal(has(probePoints({rings:SQUARE},cfg,[2,2]),2,2),true,"a usable stored point is kept");
  // A grid centre that rounds onto a ring is excluded too: rounding happens
  // first, so the rounded point is the one tested.
  assert.equal(has(probePoints({rings:[[[0,0],[10,0],[10,10],[0,10],[0,0]]]},
    {probeGrid:1,maxProbes:25,coordDecimals:0},null),5,5),true);
  assert.equal(probePoints({rings:[[[0,0],[10,0],[0,0]]]},cfg,null).length,0,
    "a boundary with no interior generates no probe");
  assert.equal(probePoints(null,cfg,null).length,0,"no geometry generates no probe");
});

test("designations are grouped by value, not by feature",()=>{
  const {groupByDesignation,coverageIdentity,CFG}=pureApp();
  const identity=coverageIdentity(CFG.LAYERS.find(layer=>layer.key==="zone"));
  const grouped=groupByDesignation([
    {OBJECTID:1,ZONE_:"R-1-8"},{OBJECTID:2,ZONE_:"R-1-8"},{OBJECTID:3,ZONE_:"C-2"}
  ],identity);
  assert.deepEqual([...grouped.groups.keys()],["R-1-8","C-2"],
    "two adjacent features with the same code are one designation");
  assert.equal(grouped.groups.get("R-1-8").length,2);
  assert.equal(grouped.keyByOid.get("2"),"R-1-8","the object-id join covers every feature");
  assert.equal(grouped.missing,0);
  assert.equal(grouped.unidentified,0);
  assert.equal(groupByDesignation([{OBJECTID:4,ZONE_:"  "}],identity).missing,1);
  // The overlay has no designation field: every feature maps to one constant key.
  const overlay=coverageIdentity(CFG.LAYERS.find(layer=>layer.key==="ccoz"));
  const overlayGroups=groupByDesignation([{OBJECTID_1:9},{OBJECTID_1:10}],overlay);
  assert.deepEqual([...overlayGroups.groups.keys()],["ccoz"]);
});

/* A3-R01 truth table: absence must never be inferred from a match this page
   simply could not read. A genuinely empty response is different from a
   response full of features nobody could identify, and the two must not
   collapse into the same "nothing here" outcome. */
test("unreadable Q1 matches are counted separately from a genuinely empty response",()=>{
  const {groupByDesignation,coverageIdentity,CFG}=pureApp();
  const identity=coverageIdentity(CFG.LAYERS.find(layer=>layer.key==="zone"));

  // Attributes-less feature: the service returned a match, but nothing about
  // it — a body without any usable attributes. Counted as unidentified, and
  // NOT silently equivalent to zero matches.
  const blank=groupByDesignation([{}],identity);
  assert.equal(blank.groups.size,0);
  assert.equal(blank.unidentified,1,"a match with no readable content is not 'nothing found'");

  // A designation with no object id: readable, so it is kept as a real
  // candidate — it can never be probe-confirmed (nothing to join Q2/Q3
  // against), but it must still be shown, never dropped.
  const noOid=groupByDesignation([{ZONE_:"R-1-8"}],identity);
  assert.deepEqual([...noOid.groups.keys()],["R-1-8"],
    "a readable designation is kept even without a joinable object id");
  assert.equal(noOid.keyByOid.size,0,"nothing to join, so nothing is ever confirmed");
  assert.equal(noOid.unidentified,0);

  // An object id with no readable designation: a real feature exists, but this
  // page cannot say what it is. Counted as unidentified, not dropped as if it
  // were zero matches, and not grouped under an empty-string key.
  const oidOnly=groupByDesignation([{OBJECTID:9}],identity);
  assert.equal(oidOnly.groups.size,0);
  assert.equal(oidOnly.unidentified,1,"an identified feature with no readable designation");

  // A genuinely empty Q1 response is still exactly that: zero candidates,
  // zero unidentified matches.
  const empty=groupByDesignation([],identity);
  assert.equal(empty.groups.size,0);
  assert.equal(empty.unidentified,0);
});

/* COV-001: `{features:[{}]}` — a 200 whose entries carry no `attributes` object
   at all. The row filter used to drop those, so a non-empty response became a
   complete empty one, `coverageState` read the empty candidate set as an
   established absence, and the City Center Overlay rendered a confident "No"
   over a body nobody could read. */
test("features with no attributes object are counted, never dropped (COV-001)",()=>{
  const {readFeatureRows,groupByDesignation,coverageIdentity,coverageState,coverageFlag,CFG}=pureApp();

  const blank=readFeatureRows([{}]);
  assert.equal(blank.rows.length,0,"there is nothing readable to group");
  assert.equal(blank.unreadable,1,"but the match itself is not forgotten");

  // Mixed: what can be read is kept, what cannot is counted.
  const mixed=readFeatureRows([{attributes:{OBJECTID:1,ZONE_:"R-1-8"}},{},null,
    {geometry:{rings:[]}}]);
  assert.deepEqual([...mixed.rows].map(row=>({...row})),[{OBJECTID:1,ZONE_:"R-1-8"}]);
  assert.equal(mixed.unreadable,3,"no attributes object, null, and a geometry-only entry");

  // An empty response is still genuinely empty; a missing array is not a match.
  for(const empty of [readFeatureRows([]),readFeatureRows(undefined)]){
    assert.equal(empty.rows.length,0);
    assert.equal(empty.unreadable,0,"an empty response is genuinely empty");
  }

  // `attributes:{}` is readable — the object is there, it just says nothing —
  // so it reaches groupByDesignation and is counted there instead. Either way
  // it is evidence, and either way it must not be counted twice.
  const present=readFeatureRows([{attributes:{}}]);
  assert.equal(present.unreadable,0);
  assert.equal(groupByDesignation(present.rows,
    coverageIdentity(CFG.LAYERS.find(layer=>layer.key==="zone"))).unidentified,1);

  // End to end through the state machine, the way coverageHits() composes them.
  const identity=coverageIdentity(CFG.LAYERS.find(layer=>layer.key==="ccoz"));
  const read=readFeatureRows([{}]);
  const grouped=groupByDesignation(read.rows,identity);
  const unidentified=grouped.unidentified+read.unreadable;
  assert.equal(unidentified,1,"the unreadable entry is the evidence the state needs");
  const state=coverageState(evidence({candidates:new Set(grouped.groups.keys()),unidentified}));
  assert.equal(state.state,"unknown","never 'none' from a response that could not be read");
  assert.equal(coverageFlag(state.state),"unknown","and never a confident No");
});

test("coverageState never reads unreadable Q1 matches as an established absence (A3-R01)",()=>{
  const {coverageState}=pureApp();

  // Q1 completed and returned nothing at all: absence IS established.
  assert.equal(coverageState(evidence({unidentified:0})).state,"none");

  // Q1 completed but every feature it returned was unreadable (no attributes,
  // or an object id with no designation): absence is NOT established. This is
  // the exact shape of a CCOZ `attributes:{}` response and of a zoning feature
  // that carries an object id but no readable ZONE_ value.
  const unreadable=coverageState(evidence({unidentified:1}));
  assert.equal(unreadable.state,"unknown","never 'none' when the response could not be read");

  // The same holds when several matches came back and none were identifiable.
  assert.equal(coverageState(evidence({unidentified:3})).state,"unknown");

  // A readable candidate takes priority over any unidentified stragglers —
  // once something IS identified, the answer is about what was found, not
  // about what could not be read.
  const set=(...keys)=>new Set(keys);
  assert.equal(coverageState(evidence({candidates:set("R-1-8"),confirmed:set("R-1-8"),
    unidentified:2})).state,"present");
});

test("validCoordinate rejects the values that used to convert to a false zero (A3-R02)",()=>{
  const {validCoordinate}=pureApp();
  // Number(null) === 0 and Number("") === 0: both are finite, so a naive
  // isFinite check would accept a missing coordinate as a real point at 0.
  assert.equal(validCoordinate(null,-180,180),false);
  assert.equal(validCoordinate(undefined,-180,180),false);
  assert.equal(validCoordinate("",-180,180),false);
  assert.equal(validCoordinate("   ",-180,180),false);
  assert.equal(validCoordinate("not-a-number",-180,180),false);
  assert.equal(validCoordinate({},-180,180),false);
  // Out of range is rejected even though it converts cleanly.
  assert.equal(validCoordinate(200,-180,180),false,"longitude out of range");
  assert.equal(validCoordinate(95,-90,90),false,"latitude out of range");
  // Real values, numeric or string, are accepted.
  assert.equal(validCoordinate(-111.815,-180,180),true);
  assert.equal(validCoordinate("40.699",-90,90),true);
  assert.equal(validCoordinate(0,-180,180),true,"a real point at zero is still valid");
});

const evidence=overrides=>({
  candidates:new Set(),confirmed:new Set(),whole:new Set(),
  q1:"ok",q2:"ok",q3:"ok",identity:"ok",polygon:"usable",probes:9,
  storedPoint:"valid",pointHits:null,unidentified:0,...overrides
});

test("coverage evidence maps to exactly one state",()=>{
  const {coverageState}=pureApp();
  const state=overrides=>coverageState(evidence(overrides)).state;
  const set=(...keys)=>new Set(keys);

  // A 100x100 parcel with a 9-unit strip of a second district along the bottom.
  // The 5x5 grid's lowest row of centres sits at y=10, so no probe lands in the
  // strip. The strip is still a candidate, and it is still shown — it is simply
  // not confirmed. It is never suppressed and never described by size.
  assert.equal(state({candidates:set("R-1-8","C-2"),confirmed:set("R-1-8")}),"present");
  // A district covering only the central 20x20 of the parcel: probes confirm it,
  // Within returns nothing. "Present" is the honest word; the page cannot say
  // how much of the property it covers, so it does not.
  assert.equal(state({candidates:set("R-1-8"),confirmed:set("R-1-8")}),"present");
  // Two adjacent same-code features have already collapsed to one key upstream.
  assert.equal(state({candidates:set("R-1-8"),confirmed:set("R-1-8"),whole:set()}),"present");
  assert.equal(state({candidates:set(),confirmed:set()}),"none");
  assert.equal(state({candidates:set("R-1-8")}),"unconfirmedOnly",
    "a candidate no probe reached and no Within match");
  assert.equal(state({candidates:set("R-1-8","C-2"),confirmed:set("R-1-8"),whole:set("R-1-8")}),
    "whole");
  assert.equal(state({candidates:set("R-1-8","C-2"),confirmed:set("R-1-8","C-2")}),"split");
  assert.equal(state({candidates:set("R-1-8","C-2"),confirmed:set("R-1-8","C-2"),
    whole:set("R-1-8","C-2")}),"overlap");
  assert.equal(state({candidates:set("R-1-8","C-2"),confirmed:set("R-1-8","C-2"),
    whole:set("R-1-8")}),"conflict",
    "one district contains the parcel while another demonstrably covers part of it");
  assert.equal(state({q1:"failed"}),"failed");
});

test("a failed or truncated check is reported without withdrawing the evidence",()=>{
  const {coverageState}=pureApp();
  const set=(...keys)=>new Set(keys);

  // Probes failed, Within returned one district. The district still contains the
  // whole parcel; what could not be done is reported separately.
  const probesFailed=coverageState(evidence({candidates:set("R-1-8"),whole:set("R-1-8"),
    q2:"failed"}));
  assert.equal(probesFailed.state,"whole");
  assert.equal(probesFailed.health.probesFailed,true);

  // Two districts confirmed, the whole-parcel check failed. Both are said.
  const wholeFailed=coverageState(evidence({candidates:set("R-1-8","C-2"),
    confirmed:set("R-1-8","C-2"),q3:"failed"}));
  assert.equal(wholeFailed.state,"split");
  assert.equal(wholeFailed.health.wholeCheckFailed,true);

  // Q1 complete, Q2 failed, Q3 cut short after returning one district. What Q3
  // did return is still evidence, so the answer falls to `present` rather than
  // to `whole` — an incomplete check cannot conclude that one district contains
  // the whole parcel — and both warnings are reported.
  const partial=coverageState(evidence({candidates:set("R-1-8","C-2"),whole:set("R-1-8"),
    q2:"failed",q3:"incomplete"}));
  assert.equal(partial.state,"present");
  assert.equal(partial.health.probesFailed,true);
  assert.equal(partial.health.incomplete,true);

  // An incomplete Q1 that retained nothing is `unknown`, never `none`: the page
  // has not established that there is no polygon here.
  const nothingRead=coverageState(evidence({q1:"incomplete"}));
  assert.equal(nothingRead.state,"unknown");
  assert.equal(nothingRead.health.incomplete,true);

  // An incomplete Q2 that confirmed nothing still describes the evidence
  // received rather than proving an absence.
  const partialProbes=coverageState(evidence({candidates:set("R-1-8"),q2:"incomplete"}));
  assert.equal(partialProbes.state,"unconfirmedOnly");
  assert.equal(partialProbes.health.incomplete,true);

  // A response whose identity could not be joined never confirms anything.
  assert.equal(coverageState(evidence({candidates:set("R-1-8"),identity:"missing"}))
    .health.identityMissing,true);
});

test("the polygon path is preferred, and the point-only path says what it checked",()=>{
  const {coverageState}=pureApp();
  const set=(...keys)=>new Set(keys);
  // An invalid stored point does not push a usable polygon onto the point path;
  // the point is simply left out of the probes.
  assert.equal(coverageState(evidence({candidates:set("R-1-8"),confirmed:set("R-1-8"),
    storedPoint:"invalid"})).state,"present");
  const pointOnly=overrides=>coverageState(evidence({polygon:"unusable",probes:0,...overrides})).state;
  assert.equal(pointOnly({pointHits:new Set()}),"pointOnly-none");
  assert.equal(pointOnly({pointHits:new Set(["R-1-8"])}),"pointOnly-one");
  assert.equal(pointOnly({pointHits:new Set(["R-1-8","C-2"])}),"pointOnly-many");
  assert.equal(pointOnly({storedPoint:"invalid",pointHits:new Set()}),"pointOnly-unusable");
  /* COV-002: the point-only branch used to answer before the unreadable and
     incomplete checks ran, so a centre query that could not be read reported
     "Nothing was found there" — the A3-R01 false negative, reached by the other
     path. Retaining nothing from evidence that could not be read is unknown,
     here as everywhere else. */
  assert.equal(pointOnly({pointHits:new Set(),unidentified:1}),"pointOnly-unknown",
    "a centre match nothing could identify is not 'nothing found there'");
  assert.equal(pointOnly({pointHits:new Set(),q1:"incomplete"}),"pointOnly-unknown",
    "a truncated centre query has not established an absence either");
  assert.equal(pointOnly({pointHits:new Set(),q1:"incomplete",unidentified:2}),
    "pointOnly-unknown");
  // A real match at the centre is still the answer, whatever else came back
  // unreadable; the identity warning carries that separately.
  assert.equal(pointOnly({pointHits:new Set(["R-1-8"]),unidentified:1}),"pointOnly-one");
  // An unusable stored point is still reported as such, not as unknown evidence.
  assert.equal(pointOnly({storedPoint:"invalid",pointHits:new Set(),unidentified:1}),
    "pointOnly-unusable");
  assert.equal(coverageState(evidence({polygon:"unusable",probes:0,pointHits:new Set(),
    q1:"incomplete"})).health.incomplete,true,"and the truncation is still reported");
  // A usable polygon that generated no probe also falls back to the point.
  assert.equal(coverageState(evidence({polygon:"usable",probes:0,pointHits:new Set(["R-1-8"])}))
    .state,"pointOnly-one");
});

test("every coverage state has a sentence, and none of them claims a proportion",()=>{
  const {coverageSentences,CFG}=pureApp();
  const zone=CFG.LAYERS.find(layer=>layer.key==="zone");
  const say=(state,overrides={})=>coverageSentences({
    state,health:{},named:true,
    noun:zone.coverageNoun,nounPlural:zone.coverageNounPlural,
    wholeNoun:zone.coverageWholeNoun,mapName:zone.coverageMapName,
    polygonNoun:zone.coveragePolygonNoun,gapTail:zone.coverageGapTail,
    expectedCoverage:true,whole:[],covered:[],unconfirmed:[],
    phone:CFG.planning.phone,...overrides});

  assert.deepEqual([...say("whole",{whole:["R-1-8"],covered:["R-1-8"]})],
    ["All of this property is in the R-1-8 zoning district."]);
  assert.deepEqual([...say("present",{covered:["R-1-8"]})],
    ["This property is in the R-1-8 zoning district."]);
  assert.deepEqual([...say("split",{covered:["R-1-8","C-2"]})],
    ["This property has more than one zoning district. Part of it is R-1-8. "+
     "Part of it is C-2. Call Planning and Zoning at 801-214-2700 to find out "+
     "which rules apply to your project."]);
  assert.deepEqual([...say("overlap",{whole:["R-1-8","C-2"],covered:["R-1-8","C-2"]})],
    ["The map shows two zoning districts covering this property. Only one can apply. "+
     "Call Planning and Zoning at 801-214-2700."]);
  assert.deepEqual([...say("conflict",{whole:["R-1-8"],covered:["R-1-8","C-2"]})],
    ["The map shows all of this property in R-1-8, and it also shows C-2 covering "+
     "part of it. Only one can apply. Call Planning and Zoning at 801-214-2700."]);
  assert.deepEqual([...say("unconfirmedOnly",{unconfirmed:["R-1-8"]})],
    ["The zoning map touches this property with R-1-8, but we could not confirm "+
     "which part of the property it covers. Call Planning and Zoning at 801-214-2700."]);
  assert.deepEqual([...say("none")],
    ["No zoning polygon was found at this property. That is a gap in the map, not a "+
     "statement that this property has no zoning. Call Planning and Zoning at 801-214-2700."]);
  assert.deepEqual([...say("pointOnly-none")],
    ["We could only check the centre of this property. Nothing was found there. "+
     "We do not know whether the edges of the property are covered."]);
  assert.deepEqual([...say("pointOnly-unknown")],
    ["We could only check the centre of this property, and we could not read the "+
     "zoning map there. We do not know what covers this property. "+
     "Call Planning and Zoning at 801-214-2700."]);
  // The sentence a resident must never be given on this evidence.
  for(const line of say("pointOnly-unknown"))
    assert.doesNotMatch(line,/Nothing was found/,
      "an unreadable centre query never asserts that nothing is there");
  assert.deepEqual([...say("pointOnly-unusable")],
    ["We could not check this property's location. Call Planning and Zoning at 801-214-2700."]);
  assert.deepEqual([...say("unknown")],
    ["We could not read the zoning map for this property. "+
     "Call Planning and Zoning at 801-214-2700."]);

  // An unconfirmed candidate is shown in EVERY state, never suppressed.
  const contained=[...say("whole",{whole:["R-1-8"],covered:["R-1-8"],unconfirmed:["C-2"]})];
  assert.equal(contained.length,2);
  assert.equal(contained[1],"The zoning map also touches this property with C-2. "+
    "We could not confirm how much of the property it covers.");

  // Health warnings render whatever the state, and never replace it.
  const degraded=[...coverageSentences({state:"whole",whole:["R-1-8"],covered:["R-1-8"],
    unconfirmed:[],named:true,noun:zone.coverageNoun,wholeNoun:zone.coverageWholeNoun,
    mapName:zone.coverageMapName,phone:CFG.planning.phone,
    health:{probesFailed:true,wholeCheckFailed:true,incomplete:true}})];
  assert.equal(degraded[0],"All of this property is in the R-1-8 zoning district.");
  assert.ok(degraded.includes("We could not confirm which of these covers this property."));
  assert.ok(degraded.includes(
    "We could not check whether one district covers all of this property."));
  assert.ok(degraded.includes("We could not read all of the map for this property. "+
    "Some information may be missing. Call Planning and Zoning at 801-214-2700."));

  /* No sentence may describe a proportion. Probes prove that a designation
     covers area inside the property; nothing measures how much, so "most",
     "small" and "too small" are not available words here. */
  const everyState=["failed","pointOnly-none","pointOnly-one","pointOnly-many",
    "pointOnly-unusable","pointOnly-unknown","none","conflict","whole","overlap","split",
    "present","unknown","unconfirmedOnly"];
  for(const state of everyState){
    const lines=say(state,{whole:["R-1-8"],covered:["R-1-8","C-2"],unconfirmed:["C-2"]});
    for(const line of lines){
      assert.doesNotMatch(line,/\bmost\b/i,state+": no sentence may claim a proportion");
      assert.doesNotMatch(line,/\bsmall\b/i,state+": no sentence may claim a size");
      assert.doesNotMatch(line,/Not in this area/,state+": a coverage layer has no such state");
    }
  }
});

test("the optional overlay reads Yes, No or Unknown, and an edge touch is Unknown",()=>{
  const {coverageFlag}=pureApp();
  assert.equal(coverageFlag("none"),"no","a complete query that found nothing");
  assert.equal(coverageFlag("whole"),"yes");
  assert.equal(coverageFlag("present"),"yes");
  assert.equal(coverageFlag("unconfirmedOnly"),"unknown",
    "an edge-only touch is not membership");
  assert.equal(coverageFlag("pointOnly-none"),"unknown","never No on a centre-only miss");
  assert.equal(coverageFlag("pointOnly-unusable"),"unknown");
  assert.equal(coverageFlag("pointOnly-unknown"),"unknown",
    "an unreadable centre query is never a Yes and never a No");
  assert.equal(coverageFlag("unknown"),"unknown");
  assert.equal(coverageFlag("failed"),"unknown");
});

test("the three coverage layers are configured to answer from the whole parcel",()=>{
  const {CFG}=pureApp();
  const byKey=key=>CFG.LAYERS.find(layer=>layer.key===key);
  for(const key of ["zone","futureland","ccoz"]){
    const layer=byKey(key);
    assert.equal(layer.coverage,true,key+" is a coverage layer");
    assert.equal(layer.geometryMode,"parcel",key+" uses the parcel boundary");
    assert.equal(layer.cardinality,"many",key+" may legitimately return several polygons");
    assert.ok(layer.coverageNoun&&layer.coverageMapName,key+" names what it reports");
  }
  // Zoning and future land use should cover every parcel in the city, so nothing
  // found is a gap in the map. The City Center Overlay is optional, so nothing
  // found is a real "No".
  assert.equal(byKey("zone").expectedCoverage,true);
  assert.equal(byKey("futureland").expectedCoverage,true);
  assert.equal(byKey("ccoz").expectedCoverage,undefined);
  assert.equal(byKey("zone").designationKey,"ZONE_");
  assert.equal(byKey("futureland").designationKey,"LandUse");
  assert.equal(byKey("ccoz").designationConstant,true,
    "the overlay has no designation field: membership is the whole answer");
  // The designation field has to be requested, or the grouping key would be
  // absent from every response.
  const {outFieldsFor}=pureApp();
  assert.match(outFieldsFor(byKey("zone")),/(^|,)ZONE_(,|$)/);
  assert.match(outFieldsFor(byKey("futureland")),/(^|,)LandUse(,|$)/);
  assert.match(outFieldsFor(byKey("ccoz")),/(^|,)OBJECTID_1(,|$)/);
  // The probe budget stays small enough that a probe query is never the request
  // that has to be posted.
  assert.equal(CFG.coverage.probeGrid,5);
  assert.equal(CFG.coverage.maxProbes,25);
  assert.equal(CFG.coverage.coordDecimals,6);
  assert.ok(CFG.coverage.maxPages>=1&&CFG.coverage.maxPages<=5);
});

/* The monitor has to build the same probe points the page builds. If it probed
   differently it would confirm designations the page cannot, or miss ones it
   can, and the live contract would be checking something no resident receives.
   Same discipline as the transportFor comparison above. */
test("the service monitor carries the page's probe geometry verbatim",async()=>{
  const core=await readFile(new URL("../scripts/service-contract-core.mjs",import.meta.url),"utf8");
  const functionSource=(source,name,where)=>{
    const start=source.indexOf("function "+name);
    assert.ok(start>=0,where+" has no "+name);
    const end=source.indexOf("\n}\n",start);
    assert.ok(end>start,where+" "+name+" has no closing brace");
    return source.slice(start,end+3);
  };
  for(const name of ["pointInRings","probePoints"])
    assert.equal(functionSource(core,name,"service-contract-core.mjs"),
      functionSource(script,name,"index.html"),
      name+" has drifted between the page and the live monitor");
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

// Deep links (A6). parcelFromQuery/addressFromQuery gate what a URL a resident
// did not type can do to the page: anything that is not a usable 9-14 digit
// parcel id, or a short enough trimmed address, must come back null rather
// than being passed through to a lookup.
test("parcelFromQuery accepts a 9-14 digit parcel id, pads it to 14, and rejects everything else",()=>{
  const {parcelFromQuery}=pureApp();
  assert.equal(parcelFromQuery("?parcel=16264570030000"),"16264570030000");
  assert.equal(parcelFromQuery("?parcel=123456789"),"00000123456789");  // 9 digits, the floor
  assert.equal(parcelFromQuery("?parcel=12345678"),null);                // 8 digits, under the floor
  assert.equal(parcelFromQuery("?parcel=123456789012345"),null);         // 15 digits, over the ceiling
  assert.equal(parcelFromQuery("?parcel=abc"),null);
  assert.equal(parcelFromQuery("?parcel=%3Cscript%3E"),null);
  assert.equal(parcelFromQuery("?parcel=1626457003000x"),null);          // digits plus a trailing letter
  assert.equal(parcelFromQuery("?address=16264570030000"),null);         // wrong parameter name
  assert.equal(parcelFromQuery(""),null);
});

test("addressFromQuery trims, and rejects text over 120 characters",()=>{
  const {addressFromQuery}=pureApp();
  assert.equal(addressFromQuery("?address=3300%20E%20Santa%20Rosa%20Ave"),"3300 E Santa Rosa Ave");
  assert.equal(addressFromQuery("?address=%20%203300%20Main%20%20"),"3300 Main");
  assert.equal(addressFromQuery("?address="+encodeURIComponent("A".repeat(120))),"A".repeat(120));
  assert.equal(addressFromQuery("?address="+encodeURIComponent("A".repeat(121))),null);
  assert.equal(addressFromQuery("?address="),null);
  assert.equal(addressFromQuery("?address=%20%20"),null);
  assert.equal(addressFromQuery(""),null);
});

test("mapLinkUrl appends lon/lat rounded to six decimals plus scale, or returns the bare base",()=>{
  const {mapLinkUrl,CFG}=pureApp();
  const base="https://planning.gis.millcreekut.gov/";
  assert.equal(mapLinkUrl(base,{lon:-111.8149999,lat:40.6990001,scale:2000}),
    base+"?lon=-111.815000&lat=40.699000&scale=2000");
  assert.equal(mapLinkUrl(base,{lon:-111.815,lat:40.699,scale:CFG.mapLinkScale}),
    base+"?lon=-111.815000&lat=40.699000&scale=2000");
  assert.equal(mapLinkUrl(base,{lon:null,lat:40.699,scale:2000}),base);      // missing lon
  assert.equal(mapLinkUrl(base,{lon:-111.815,lat:undefined,scale:2000}),base); // missing lat
  assert.equal(mapLinkUrl(base,{lon:NaN,lat:40.699,scale:2000}),base);
  assert.equal(mapLinkUrl(base),base);
});

/* MAP-001: the helper's guard is not the whole rule, because the caller decides
   what reaches the guard. `Number(null)` is 0 and 0 is a finite, in-range
   coordinate, so a parcel with no stored point produced a confident deep link to
   (0, 0). The helper tests above pass `null` straight in and cannot see that;
   this one tests the composition draw() actually performs. */
test("a missing coordinate cannot reach the map link as a false zero (MAP-001)",()=>{
  const {mapLinkUrl,validCoordinate,CFG}=pureApp();
  const base="https://planning.gis.millcreekut.gov/";

  // The defect, stated: an unvalidated conversion sails past the helper's guard.
  assert.equal(mapLinkUrl(base,{lon:Number(null),lat:Number(null),scale:CFG.mapLinkScale}),
    base+"?lon=0.000000&lat=0.000000&scale=2000",
    "converting first defeats the helper's own check, which is why the caller validates");

  // What draw() does now: validate, then convert, then link.
  const link=(lon,lat)=>{
    const mapLon=validCoordinate(lon,-180,180)?Number(lon):null;
    const mapLat=validCoordinate(lat,-90,90)?Number(lat):null;
    return mapLinkUrl(base,mapLon!=null&&mapLat!=null
      ? {lon:mapLon,lat:mapLat,scale:CFG.mapLinkScale} : {});
  };
  for(const [lon,lat,why] of [
    [null,null,"no stored point at all"],
    [null,40.699,"one coordinate missing"],
    [-111.815,null,"the other coordinate missing"],
    ["","","blank strings"],
    ["   ",40.699,"whitespace"],
    ["not-a-number",40.699,"a non-numeric value"],
    [200,40.699,"longitude out of range"],
    [-111.815,95,"latitude out of range"],
    [undefined,undefined,"absent fields"]
  ]) assert.equal(link(lon,lat),base,why+" opens the map at its default view");

  // Real coordinates still land on the property, numeric or as the strings the
  // service sometimes returns. Zero is a real coordinate and is kept.
  assert.equal(link(-111.815,40.699),base+"?lon=-111.815000&lat=40.699000&scale=2000");
  assert.equal(link("-111.815","40.699"),base+"?lon=-111.815000&lat=40.699000&scale=2000");
  assert.equal(link(0,0),base+"?lon=0.000000&lat=0.000000&scale=2000",
    "a parcel genuinely at zero is not the same as a parcel with no point");

  // And the call site itself never converts first again.
  assert.doesNotMatch(script,/mapLinkUrl\([^)]*Number\((?:lon|lat)\)/,
    "draw() must not build the map link from an unvalidated conversion");
});

test("CFG.mapLinkScale is a positive number",()=>{
  assert.equal(typeof pureApp().CFG.mapLinkScale,"number");
  assert.ok(pureApp().CFG.mapLinkScale>0);
});

/* A5: spokenDate() turns a stored reviewedOn/dataReviewedOn value into words
   for a resident. It must be pure string formatting of the ISO value already
   in CFG — never new Date() on the visitor's clock, which can roll the
   calendar date backward or forward depending on the visitor's timezone. */
test("spokenDate formats a stored ISO date in words, and returns anything else unchanged",()=>{
  const {spokenDate}=pureApp();
  assert.equal(spokenDate("2026-08-09"),"9 August 2026");
  assert.equal(spokenDate("2026-01-01"),"1 January 2026");
  assert.equal(spokenDate("2026-12-31"),"31 December 2026");
  assert.equal(spokenDate("bad"),"bad");
  assert.equal(spokenDate(""),"");
  assert.equal(spokenDate("2026-13-01"),"2026-13-01");   // no month 13
  assert.equal(spokenDate(undefined),undefined);
  assert.equal(spokenDate(null),null);
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
  // Pinned deliberately short, and it needs to stay that way. This note is disclaimer
  // prose under active legal review — it was reworded twice on 13 August alone, and a
  // longer pin broke on each pass. What the test is actually for is that the group
  // carries a non-regulatory framing at all, so assert that and let the sentence
  // around it change. Do not re-pin a full clause without a reason.
  const infoNote=CFG.GROUP_NOTES["Informational hazard screening"];
  assert.match(infoNote,/for information only/i);
  assert.match(infoNote,/site investigation/i);
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

/* Every parcel field the page reads has to be named in CFG, because the live
   service-contract check derives what it verifies from CFG. Owner of record, care-of
   and the Assessor link were read straight out of the record by name, so they were
   invisible to that check: a rename at the County would have removed the owner block
   and the valuation link from every result with no failing test and no error — the
   page would simply stop showing them. */
test("parcel fields read by the page are declared in configuration",()=>{
  const {CFG}=pureApp();
  for(const key of ["idField","latField","lonField","ownerField","careOfField",
    "assessorLinkField"]){
    assert.equal(typeof CFG.parcel[key],"string","CFG.parcel."+key+" is declared");
    assert.ok(CFG.parcel[key].length,"CFG.parcel."+key+" is not empty");
  }
});

test("the page reads parcel fields through configuration, not by hardcoded name",()=>{
  const {CFG}=pureApp();
  const configured=[CFG.parcel.ownerField,CFG.parcel.careOfField,CFG.parcel.assessorLinkField];
  const belowConfig=script.slice(script.indexOf("No further edits"));
  for(const field of configured)
    assert.doesNotMatch(belowConfig,new RegExp("rec\\."+field+"\\b"),
      field+" is read by name below the configuration block, so the contract check cannot see it");
});

test("the live service contract derives parcel fields from configuration",async()=>{
  // A2 moved the field-list formula into service-contract-core.mjs's
  // parcelFieldList(), shared with the page's own inline copy (see
  // "the page's explicit field lists agree with the live monitor's" above).
  // check-services.mjs now verifies these fields through that import rather
  // than naming them itself, so both files together are what must still name
  // every one of them literally.
  const source=await readFile(new URL("../scripts/check-services.mjs",import.meta.url),"utf8");
  const core=await readFile(new URL("../scripts/service-contract-core.mjs",import.meta.url),"utf8");
  assert.match(source,/parcelFieldList\(CFG\)/,
    "check-services.mjs must derive the parcel query's fields from parcelFieldList(CFG), "+
    "not reconstruct or hardcode them separately");
  for(const key of ["ownerField","careOfField","assessorLinkField"])
    assert.match(core,new RegExp("CFG\\.parcel\\."+key),
      "service-contract-core.mjs's parcelFieldList verifies CFG.parcel."+key);
});

/* A1-R01 / A1-R02 (2026-09-10): the long-geometry checks' own reasoning turned
   out to blur transport failure and contract drift back together in two ways -
   see scripts/service-contract-core.mjs's settleLayerChecks and the tests
   there for the behavioral coverage. check-services.mjs itself can't be
   imported in a unit test (it makes live network calls at module load), so
   this locks down the two control-flow shapes those fixes depend on. */
test("A1-R02: the long-geometry-parcel check settles every polygon layer instead of racing them",
  async()=>{
    const source=await readFile(new URL("../scripts/check-services.mjs",import.meta.url),"utf8");
    assert.match(source,/settleLayerChecks\(\s*\n?\s*polygonLayers/,
      "polygon layers are settled individually so one layer's transport failure cannot "+
      "hide another layer's contract failure, or vice versa");
    assert.doesNotMatch(source,/Promise\.all\(polygonLayers\.map/,
      "the old fail-fast race over polygon layers is gone");
  });

test("A1-R01: the long-geometry-transport check is skipped, not faked as contract drift, "+
  "when its prerequisite never retrieved a geometry",async()=>{
  const source=await readFile(new URL("../scripts/check-services.mjs",import.meta.url),"utf8");
  const start=source.indexOf('await contract("long-geometry-parcel"');
  const end=source.indexOf("const informationalHazardParcels");
  assert.ok(start>=0&&end>start,"the long-geometry checks are still where this test expects them");
  const region=source.slice(start,end);
  assert.match(region,
    /if\s*\(\s*longGeometry\s*\)\s*await contract\(\s*"long-geometry-transport"/,
    "the dependent check runs only once the prerequisite geometry was actually retrieved");
  assert.match(region,/else\s+skip\(\s*"long-geometry-transport"/,
    "a missing prerequisite skips the dependent check instead of failing it");
  assert.doesNotMatch(region,/the long-geometry parcel geometry is unavailable/,
    "the dependent check no longer fabricates its own contract failure over a missing prerequisite");
});

test("zoning follows the public map and does not display density",()=>{
  const {CFG}=pureApp();
  const zone=CFG.LAYERS.find(layer=>layer.key==="zone");
  const future=CFG.LAYERS.find(layer=>layer.key==="futureland");
  assert.match(zone.url,/Zone_Update_2025___Related_Master/);
  assert.equal(Object.hasOwn(zone.fields,"Res_Max_De"),false);
  assert.match(future.url,/FutureLandUse_2024_Millcreek/);
});

/* A4: the zoning rows are named after what they hold. The all-caps category
   (ZONE_DESC) is dropped for Category, which says the same thing in sentence
   case, and the purpose sentence links to the code section instead of being
   mislabelled "Ordinance". */
test("zoning rows are named after what they hold and link the code section",async()=>{
  const {CFG}=pureApp();
  const zone=CFG.LAYERS.find(layer=>layer.key==="zone");
  assert.equal(Object.hasOwn(zone.fields,"CodeRef"),true);
  assert.equal(Object.hasOwn(zone.fields,"CodebookURL"),true);
  assert.equal(Object.hasOwn(zone.fields,"Res_Max_De"),false);
  assert.equal(Object.hasOwn(zone.fields,"ZONE_DESC"),false);
  assert.equal(zone.nameField,undefined,
    "no nameField on zone — the codebook link text falls back to the row label");
  const source=await readFile(new URL("../index.html",import.meta.url),"utf8");
  assert.doesNotMatch(source,/Ordinance/,
    "the purpose sentence is no longer mislabelled \"Ordinance\"");
});

/* A7: zoning leads the report, and zoning/future land use each carry one plain
   sentence explaining what they are (distinct from coverageSentences(), which
   says what the map found). */
test("zoning and future land use each carry a plain-meaning sentence",()=>{
  const {CFG}=pureApp();
  const zone=CFG.LAYERS.find(layer=>layer.key==="zone");
  const future=CFG.LAYERS.find(layer=>layer.key==="futureland");
  assert.equal(typeof zone.plainMeaning,"string");
  assert.ok(zone.plainMeaning.trim().length>0,"zone.plainMeaning is not empty");
  assert.equal(typeof future.plainMeaning,"string");
  assert.ok(future.plainMeaning.trim().length>0,"future.plainMeaning is not empty");
});

test("CFG.firstGroup names a group that CFG.LAYERS actually has",()=>{
  const {CFG}=pureApp();
  const groups=new Set(CFG.LAYERS.filter(layer=>!layer.hidden).map(layer=>layer.group));
  assert.ok(CFG.firstGroup,"CFG.firstGroup is set");
  assert.ok(groups.has(CFG.firstGroup),
    "CFG.firstGroup ("+CFG.firstGroup+") must equal an existing CFG.LAYERS group");
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

/* ATTR-001: a hidden layer is not displayed, but its data can be. The FEMA card
   renders "Millcreek flood layer matches live FEMA", a comparison against the
   hidden flood_local layer, so that layer's owner and review date have to be
   named too — and can only be named if the visible layer says it depends on it
   and the hidden layer carries the metadata. */
test("a hidden layer feeding a visible result is declared and carries its own metadata",()=>{
  const {CFG}=pureApp();
  const fema=CFG.LAYERS.find(layer=>layer.kind==="femaFlood");
  assert.deepEqual([...(fema.dependsOn||[])],["flood_local"],
    "the derived comparison names the layer it is derived from");
  for(const key of fema.dependsOn){
    const dependency=CFG.LAYERS.find(layer=>layer.key===key);
    assert.ok(dependency,key+" is a configured layer");
    assert.ok(dependency.sourceOwner,key+" names an owner even though it is hidden");
    assert.match(dependency.reviewedOn,/^\d{4}-\d{2}-\d{2}$/,key+" review date");
    assert.ok(dependency.label,key+" has a label to attribute");
    assert.equal(dependency.group,fema.group,
      key+" attributes into the same card as the result it feeds");
  }
  // Every declared dependency anywhere resolves to a real layer.
  for(const layer of CFG.LAYERS)
    for(const key of layer.dependsOn||[])
      assert.ok(CFG.LAYERS.some(other=>other.key===key),
        layer.key+" depends on a configured layer ("+key+")");
});

/* What is deployed is an allowlist, not the repository. Publishing the repository
   root served every engineering file over HTTP — walkthroughs, migration notes,
   review registers, the service-contract script and its known test parcels — none of
   which a resident needs and none of which was reviewed as public writing. Naming
   what ships is durable; denying paths one at a time is not, because the next file
   added to the repository is public by default. */
test("only the public site is published",async()=>{
  const toml=await readFile(new URL("../netlify.toml",import.meta.url),"utf8");
  const publishDir=toml.match(/^\s*publish\s*=\s*"([^"]+)"/m)?.[1];
  assert.ok(publishDir,"netlify.toml declares a publish directory");
  assert.notEqual(publishDir,".","the repository root must not be the publish directory");

  const required=["index.html","business-licensing.html","_headers",
    "staticwebapp.config.json","assets/millcreek-logo.png"];
  const engineering=/^(docs|scripts|tests|node_modules|\.github|src)\//;
  const repoFile=/^(package(-lock)?\.json|playwright\.config\.mjs|vite\.config\.mjs|netlify\.toml|LICENSE|CODE\.md|USAGE\.md|README\.md|MIGRATION\.md|DATA-SOURCES\.md|WEB-MAP-REVIEW\.md|CHANGES-.+\.md)$/;

  let entries=null;
  try{
    entries=await readdir(new URL("../"+publishDir+"/",import.meta.url),{recursive:true});
  }catch(error){
    if(error.code!=="ENOENT") throw error;
  }

  if(entries){
    // The publish directory exists: assert exactly what would be served.
    const served=entries.map(entry=>entry.split(/[\\/]/).join("/"));
    // Neither host config is honoured from anywhere but the publish directory: if
    // `_headers` is left behind every security header silently disappears from
    // Netlify, and if `staticwebapp.config.json` is left behind Azure serves the
    // site with no headers, no cache rules and no `/business-licensing` at all.
    for(const name of required)
      assert.ok(served.includes(name),publishDir+"/ is missing "+name);
    const leaked=served.filter(name=>engineering.test(name)||repoFile.test(name));
    assert.deepEqual(leaked,[],publishDir+"/ would serve engineering files: "+leaked.join(", "));
    /* A note about the logo lived in `public/assets/` and was therefore copied into
       the build and served publicly at /assets/README.md, HTTP 200, for as long as
       the site has existed. It was harmless prose, and it was still a repository
       file on a public site — the one property the publish allowlist exists to
       prevent. The named-file patterns above did not catch it because it was not at
       the root. Nothing published is documentation; assert that directly. */
    const documentation=served.filter(name=>/\.mdx?$/i.test(name));
    assert.deepEqual(documentation,[],
      publishDir+"/ would publish documentation: "+documentation.join(", "));
    return;
  }

  /* The publish directory is a build output that has not been built yet
     (ADR-0001 step 1: `dist/` is generated and gitignored). Assert the INPUTS
     that must end up there instead, so deleting `_headers` or an entry page
     still fails this test rather than passing silently until deploy.

     Entry HTML may sit at the repository root (post `git mv`) or still in
     `public/` (pre-move) — see MIGRATION.md step 1. */
  assert.match(toml,/^\s*command\s*=\s*"(?!\s*")/m,
    publishDir+"/ does not exist, so netlify.toml must declare a build command that creates it");

  const exists=async candidates=>{
    for(const candidate of candidates){
      try{ await readdir(new URL(candidate,import.meta.url)); return true; }
      catch(error){
        if(error.code==="ENOTDIR") return true;          // it is a file: good enough
        if(error.code!=="ENOENT") throw error;
      }
    }
    return false;
  };
  for(const [name,candidates] of [
    ["index.html",["../index.html","../public/index.html"]],
    ["business-licensing.html",["../business-licensing.html","../public/business-licensing.html"]],
    ["_headers",["../public/_headers"]],
    ["staticwebapp.config.json",["../public/staticwebapp.config.json"]],
    ["assets/millcreek-logo.png",["../public/assets/millcreek-logo.png"]]
  ]) assert.ok(await exists(candidates),"no source found that would publish "+name);
});

/* HSTS was being served by the hosting platform rather than declared here, so the
   deployment gate asserted a header that nothing in the repository guaranteed. Move
   the site or change the platform and the gate fails for a reason with no source. */
test("transport security is declared in the repository, not left to the platform",async()=>{
  const headers=await readFile(new URL("../public/_headers",import.meta.url),"utf8");
  const hsts=headers.match(/^\s*Strict-Transport-Security:\s*(.+)$/mi)?.[1].trim();
  assert.ok(hsts,"_headers declares Strict-Transport-Security");
  const maxAge=Number(hsts.match(/max-age=(\d+)/)?.[1]);
  assert.ok(maxAge>=31536000,"max-age is at least one year, got "+maxAge);
});

/* Two hosts, two config files, one set of response headers.
   -----------------------------------------------------------------------
   The Azure port (2026-09-02) added `public/staticwebapp.config.json` beside
   `public/_headers`. Each host reads only its own file and silently ignores the
   other's, so nothing at runtime would ever notice the two drifting apart: an
   edit to the CSP in `_headers` would ship to Netlify and not to Azure, and the
   deployment gate would keep passing against whichever host it was pointed at.

   That is the same failure the test above exists to prevent, one level up — a
   header with no single source. So the two files are compared here, and the
   comparison is what makes either of them safe to edit.

   Mapping notes, both of which are host behaviour rather than choices:

   - Azure resolves `/` through the default document, so the SWA rule on
     `/index.html` is what answers a request for `/`. The `/` block in
     `_headers` therefore has no separate Azure rule and is compared against
     the `/index.html` one. Verified live on the planning map, which uses the
     same pattern.
   - Azure has no equivalent of Netlify consuming `_headers`: the file is
     ordinary build output there and would be served at `/_headers`. The route
     rule that 404s it is asserted below, because losing it publishes a
     repository file — the one property the publish allowlist exists for. */

function parseNetlifyHeaders(text){
  const blocks=new Map();
  let current=null;
  for(const raw of text.split("\n")){
    const line=raw.replace(/\s+$/,"");
    if(!line||line.trimStart().startsWith("#")) continue;
    if(!/^\s/.test(line)){ current=new Map(); blocks.set(line.trim(),current); continue; }
    const match=line.match(/^\s+([A-Za-z0-9-]+):\s*(.+)$/);
    if(match&&current) current.set(match[1].toLowerCase(),match[2].trim());
  }
  return blocks;
}

test("the Netlify and Azure host configs declare the same response headers",async()=>{
  const netlify=parseNetlifyHeaders(
    await readFile(new URL("../public/_headers",import.meta.url),"utf8"));
  const swa=JSON.parse(
    await readFile(new URL("../public/staticwebapp.config.json",import.meta.url),"utf8"));

  const globals=netlify.get("/*");
  assert.ok(globals,"_headers declares a /* block");
  const swaGlobals=new Map(Object.entries(swa.globalHeaders||{})
    .map(([name,value])=>[name.toLowerCase(),value]));

  assert.deepEqual([...swaGlobals.keys()].sort(),[...globals.keys()].sort(),
    "the two host configs declare different global header sets");
  for(const [name,value] of globals)
    assert.equal(swaGlobals.get(name),value,
      name+" differs between _headers and staticwebapp.config.json");

  /* Cache-Control is declared per page, not globally, so it is compared per page.
     `/` maps to the Azure `/index.html` rule for the default-document reason above. */
  const routeFor=path=>(swa.routes||[]).find(route=>route.route===path);
  for(const [netlifyPath,azurePath] of [
    ["/","/index.html"],
    ["/index.html","/index.html"],
    ["/business-licensing.html","/business-licensing.html"],
    ["/business-licensing","/business-licensing"]
  ]){
    const expected=netlify.get(netlifyPath)?.get("cache-control");
    assert.ok(expected,"_headers declares Cache-Control for "+netlifyPath);
    const route=routeFor(azurePath);
    assert.ok(route,"staticwebapp.config.json has no route for "+azurePath);
    assert.equal(route.headers?.["Cache-Control"],expected,
      "Cache-Control for "+netlifyPath+" differs between hosts");
  }

  /* The readable licensing URL is a rewrite on both hosts: same path, same target,
     same 200 — a redirect instead would change the address bar and the gate's
     comparison target. netlify.toml owns the Netlify half. */
  assert.equal(routeFor("/business-licensing")?.rewrite,"/business-licensing.html",
    "Azure must rewrite /business-licensing rather than redirect it");
  const toml=await readFile(new URL("../netlify.toml",import.meta.url),"utf8");
  assert.match(toml,/from\s*=\s*"\/business-licensing"[\s\S]{0,120}?status\s*=\s*200/,
    "netlify.toml must still rewrite /business-licensing with status 200");
});

/* Each host publishes the OTHER host's config file as ordinary static content:
   Netlify consumes `_headers` and would serve `staticwebapp.config.json`, and
   Azure does the reverse. Neither file holds a secret, and both are still
   repository files on a public site, which is exactly what the publish allowlist
   refuses. Each config denies the other's file; assert both halves. */
test("each host denies the other host's config file",async()=>{
  const swa=JSON.parse(
    await readFile(new URL("../public/staticwebapp.config.json",import.meta.url),"utf8"));
  const denied=(swa.routes||[]).find(route=>route.route==="/_headers");

  /* `statusCode: 404` on the route does NOT work here, and the first staging deploy
     is what proved it. Measured 2026-09-02 against the staging Static Web App:
     `/_headers` answered HTTP 200 with all 2339 bytes of the file, while carrying
     the `Cache-Control: no-store` from the very same rule. So the rule matched and
     its headers applied; only the status code was ignored.

     The documented example of a route 404 (`/.auth/login/x`) is a virtual path with
     no file behind it. A real file appears to win, and Azure does not document the
     interaction. Blocking by role is the mechanism that does work on an existing
     file: no visitor holds a role called "denied", anonymous visitors hold only
     `anonymous`, so authorization fails and the file is never reached.

     Authorization failure for a signed-out visitor is a 401, which would be a
     strange answer for a path that should simply not exist — and `check:deployment`
     reads a 401 with an error body as a published file. The responseOverride turns
     it into the 404 it should have been. Nothing else in this application can
     produce a 401: there is no authentication anywhere in it. */
  assert.ok(Array.isArray(denied?.allowedRoles)&&denied.allowedRoles.length>0,
    "Azure must deny /_headers by role; statusCode alone does not block a real file");
  assert.ok(!denied.allowedRoles.some(role=>["anonymous","authenticated"].includes(role)),
    "the role must be one no visitor holds - anonymous and authenticated are built in "+
    "and would grant access to everyone and every signed-in user respectively");
  assert.equal(swa.responseOverrides?.["401"]?.statusCode,404,
    "the role denial surfaces as 401; it has to be reported as 404 or the deployment "+
    "gate reads the error body as a published file");
  assert.equal(denied.statusCode,undefined,
    "no statusCode on this route: it was measured not to work and its presence would "+
    "suggest the block still rests on it");

  /* Independently of the above, a 404 falls through navigationFallback and comes
     back as the app at HTTP 200 unless the path is excluded from it. */
  assert.ok((swa.navigationFallback?.exclude||[]).includes("/_headers"),
    "/_headers must be excluded from navigationFallback or the 404 becomes a 200");

  const toml=await readFile(new URL("../netlify.toml",import.meta.url),"utf8");
  assert.match(toml,/from\s*=\s*"\/staticwebapp\.config\.json"[\s\S]{0,120}?status\s*=\s*404/,
    "netlify.toml must refuse to serve /staticwebapp.config.json");
});

// A LIKE operand is not an equality operand. Escaping wildcards in an equality
// comparison would insert backslashes into a literal value, so they are separate.
test("LIKE operands escape wildcards while equality operands do not",()=>{
  const {esc,likeOperand}=pureApp();
  assert.equal(esc("O'BRIEN"),"O''BRIEN");
  assert.equal(esc("100% MAIN"),"100% MAIN");
  assert.equal(likeOperand("O'BRIEN"),"O''BRIEN");
  assert.equal(likeOperand("100% MAIN"),"100\\% MAIN");
  assert.equal(likeOperand("330_ E"),"330\\_ E");
  assert.equal(likeOperand("A\\B"),"A\\\\B");
});

test("address searches escape typed wildcards in every tier",()=>{
  const belowConfig=script.slice(script.indexOf("No further edits"));
  const tiers=[...belowConfig.matchAll(/LIKE '[^\n]*/g)].map(match=>match[0]);
  assert.ok(tiers.length>=4,"found the tiered LIKE clauses, got "+tiers.length);
  for(const tier of tiers){
    assert.match(tier,/ESCAPE/,"tier declares an ESCAPE character: "+tier);
    assert.doesNotMatch(tier,/\$\{esc\(/,"tier uses likeOperand, not esc: "+tier);
  }
});

test("the release toolchain is pinned consistently",async()=>{
  const packageJson=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
  const lock=JSON.parse(await readFile(new URL("../package-lock.json",import.meta.url),"utf8"));
  const nodeVersion=(await readFile(new URL("../.nvmrc",import.meta.url),"utf8").catch(()=>""))
    .trim();
  const npmVersion=packageJson.packageManager?.match(/^npm@(.+)$/)?.[1];

  assert.match(nodeVersion,/^\d+\.\d+\.\d+$/,".nvmrc pins one exact Node release");
  assert.equal(packageJson.engines?.node,nodeVersion,
    "package.json and .nvmrc pin the same Node release");
  assert.match(npmVersion,/^\d+\.\d+\.\d+$/,"packageManager pins one exact npm release");
  assert.equal(packageJson.engines?.npm,npmVersion,
    "packageManager and engines pin the same npm release");
  /* The literal is deliberate. Dependabot opens dependency bumps on its own, and
     Vite is the one dependency whose output is what residents actually receive, so a
     version change here must fail a test and force somebody to look. Bumping it is
     one line — the point is that the line exists. Whoever changes it should have
     compared the built bytes before and after; a Vite major that alters the output
     is a change to the served pages, not a housekeeping update. */
  assert.equal(packageJson.devDependencies?.vite,"8.2.2","Vite is pinned exactly");
  assert.doesNotMatch(packageJson.devDependencies.vite,/[\^~><*]|\s-\s/,
    "the Vite pin is an exact version, not a range");
  assert.equal(lock.packages?.[""]?.devDependencies?.vite,packageJson.devDependencies.vite,
    "the lockfile root carries the same Vite pin");
  assert.equal(lock.packages?.["node_modules/vite"]?.version,packageJson.devDependencies.vite,
    "the locked Vite package matches the declared version");

  // README states the same contract in prose. Without this it drifts silently while the
  // machine-readable pins stay perfectly consistent with each other.
  const readme=await readFile(new URL("../README.md",import.meta.url),"utf8");
  const documented=readme.match(/\*\*Node (\d+\.\d+\.\d+) with npm (\d+\.\d+\.\d+)\*\*/);
  assert.ok(documented,"README states the required Node and npm releases");
  assert.equal(documented[1],nodeVersion,"README documents the pinned Node release");
  assert.equal(documented[2],npmVersion,"README documents the pinned npm release");
});

test("deterministic CI is reproducible and preserves failure evidence",async()=>{
  const workflow=await readFile(new URL("../.github/workflows/quality.yml",import.meta.url),"utf8");
  const playwrightConfig=await readFile(
    new URL("../playwright.config.mjs",import.meta.url),"utf8");

  assert.match(workflow,/permissions:\s*\n\s+contents:\s*read/,
    "the workflow declares least-privilege repository access");
  assert.match(workflow,/concurrency:[\s\S]*cancel-in-progress:\s*true/,
    "superseded branch runs are cancelled");
  assert.match(workflow,/push:\s*\n\s+branches:\s*\[main\]/,
    "push CI is limited to main");
  /* Deliberately unfiltered. A `branches: [main]` filter here meant a pull request
     stacked on another branch ran no checks, which is how this plan's phases are
     reviewed — Phase 2 opened against the Phase 1 branch and got nothing. */
  assert.doesNotMatch(workflow,/pull_request:\s*\n\s+branches:/,
    "pull-request CI must not be limited by base branch: a stacked pull request "+
    "would run no checks and could land unverified");
  assert.match(workflow,/pull_request:\s*\n\s+workflow_dispatch:/,
    "the pull_request trigger takes no configuration");
  assert.match(workflow,/runs-on:\s*ubuntu-24\.04/,
    "the runner image is fixed rather than floating on ubuntu-latest");

  for(const [action,sha,tag] of [
    ["actions/checkout","3d3c42e5aac5ba805825da76410c181273ba90b1","v7.0.1"],
    ["actions/setup-node","820762786026740c76f36085b0efc47a31fe5020","v7.0.0"],
    ["actions/setup-python","5fda3b95a4ea91299a34e894583c3862153e4b97","v7.0.0"],
    ["actions/upload-artifact","043fb46d1a93c77aae656e7c1c64a875d1fc6a0a","v7.0.1"]
  ]){
    assert.match(workflow,new RegExp(action.replace("/","\\/")+"@"+sha+"\\s+# "+tag),
      action+" is pinned to the reviewed "+tag+" commit");
  }
  assert.doesNotMatch(workflow,/uses:\s*actions\/[\w-]+@v\d/,
    "official actions are never referenced by a mutable major tag");

  assert.match(workflow,/node-version-file:\s*['"]?\.nvmrc/,
    "CI consumes the repository Node version contract");
  for(const [name,command] of [
    ["Install locked dependencies","npm ci"],
    ["Audit production toolchain","npm audit --audit-level=high"],
    ["Run unit tests","npm run test:unit"],
    ["Run Python tests","npm run test:python"],
    ["Build production artifact","npm run build"],
    ["Install Chromium","npx playwright install --with-deps chromium"],
    ["Run browser tests","npx playwright test"]
  ]){
    /* Assert the command lives inside its own named step, rather than within N
       characters of the name. The character budget broke the moment the Chromium
       install grew a retry loop - a change that made the step better while leaving
       the property this test exists for completely intact. */
    const step=workflow.split(/^      - name: /m).slice(1)
      .find(block=>block.startsWith(name));
    assert.ok(step,name+" is a named CI step");
    assert.ok(step.includes(command),name+" runs `"+command+"` in its own step");
  }
  assert.doesNotMatch(workflow,/run:\s*npm test\s*$/m,
    "CI does not hide several suites inside one npm test step");
  assert.match(workflow,/if:\s*failure\(\)[\s\S]{0,300}path:\s*\|[\s\S]{0,120}playwright-report\/[\s\S]{0,120}test-results\//,
    "browser diagnostics are uploaded on failure");
  assert.match(playwrightConfig,/\["html",\{[^}]*outputFolder:"playwright-report"[^}]*open:"never"/,
    "CI generates the Playwright HTML report that the workflow retains");
});

test("live service monitoring is isolated from deterministic merge quality",async()=>{
  const quality=await readFile(new URL("../.github/workflows/quality.yml",import.meta.url),"utf8");
  const monitor=await readFile(
    new URL("../.github/workflows/live-service-monitor.yml",import.meta.url),"utf8")
    .catch(()=>"");

  assert.doesNotMatch(quality,/^\s+schedule:|^on:\s*\[[^\]]*\bschedule\b/m,
    "deterministic quality has no external-service schedule");
  // `check:deployment` probes the deployed site, so it is candidate verification (Task 6),
  // never a merge gate. Guard both live-network scripts by command name and by path.
  assert.doesNotMatch(quality,
    /check:(?:services|deployment)|scripts\/check-(?:services|deployment)\.mjs|live-service-contract/,
    "deterministic quality contains no live-network job");

  assert.match(monitor,/workflow_dispatch:/,"the monitor can be run deliberately");
  assert.match(monitor,/schedule:\s*\n\s+- cron:/,"the monitor observes services on a schedule");
  assert.doesNotMatch(monitor,
    /^\s+push:|^\s+pull_request:|^on:\s*\[[^\]]*\b(?:push|pull_request)\b/m,
    "external availability is not a pull-request or push gate");
  assert.match(monitor,/permissions:\s*\n\s+contents:\s*read/,
    "the monitor declares least-privilege repository access");
  assert.match(monitor,/actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\s+# v7\.0\.1/);
  assert.match(monitor,/actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020\s+# v7\.0\.0/);
  assert.doesNotMatch(monitor,/uses:\s*actions\/[\w-]+@v\d/,
    "monitor actions are pinned to immutable reviewed commits");
  assert.match(monitor,/node-version-file:\s*['"]?\.nvmrc/);
  assert.match(monitor,/npm run check:services/);
  assert.match(monitor,/GITHUB_STEP_SUMMARY/,
    "the monitor writes a concise Actions summary even when a contract fails");
  assert.match(monitor,/PIPESTATUS\[0\]/,
    "the monitor preserves the service command exit code through tee");
  assert.match(monitor,/exit "\$status"/,
    "the monitor remains visibly failed after writing evidence");
});

test("security policy permits authoritative sources and Planning uses its own contact",async()=>{
  const headers=await readFile(new URL("../public/_headers",import.meta.url),"utf8");
  assert.match(headers,/connect-src[^\n]+https:\/\/hazards\.fema\.gov/);
  assert.match(html,/Planning &amp; Zoning[\s\S]{0,200}801-214-2700/);
  assert.doesNotMatch(html,/Planning and Development Services[\s\S]{0,100}801-214-2754/);
});

test("current documentation does not advertise removed features or stale deployment state",async()=>{
  const readme=await readFile(new URL("../README.md",import.meta.url),"utf8");
  const changes=await readFile(new URL("../docs/changes/CHANGES-2026-08-06.md",import.meta.url),"utf8");
  assert.doesNotMatch(readme,/firework restrictions/i);
  assert.match(changes,/resolved/i);
});

/* Deployed-content verification — ADR-0001 / production readiness Task 4.

   `check:deployment` is the only automated proof that what Netlify serves is what
   the build produced. It has never gated anything, because Netlify's Pretty URLs
   post-processing rewrites two links and the check asserted exact bytes and then
   aborted on the first failure, never reaching the header and allowlist gates.

   The rules below are the contract: exact bytes pass, the two rewrites recorded in
   CHANGES-2026-08-13.md §7 pass, and everything else fails with a located
   difference. The comparison is pure so it can be tested without a deployment. */
import { PRETTY_URL_REWRITES, compareDeployedHtml, missingHeaderDirectives,
  stripHostingInjection, stripPreviewDrawer,
  unpublishedPathFailure } from "../scripts/deployment-content.mjs";

const builtFixture=[
  "<!DOCTYPE html>","<html lang=\"en-US\">","<body>",
  "<a href=\"/business-licensing.html\">licensing</a>",
  "<a href=\"/index.html\">back</a>","</body>","</html>"
].join("\n");

test("a deployment that matches the built bytes exactly needs no allowance",()=>{
  const result=compareDeployedHtml(builtFixture,builtFixture,"index.html");
  assert.equal(result.match,true);
  assert.deepEqual(result.rewritesApplied,[]);
});

test("both documented Pretty URLs rewrites are accepted and named",()=>{
  const deployed=builtFixture
    .replace("href=\"/business-licensing.html\"","href='/business-licensing'")
    .replace("href=\"/index.html\"","href='/'");
  const result=compareDeployedHtml(deployed,builtFixture,"index.html");
  assert.equal(result.match,true,result.message);
  assert.equal(result.rewritesApplied.length,PRETTY_URL_REWRITES.length,
    "both rewrite forms are reported, not just the one that happened to match");
});

/* Found by pointing the repaired check at a real deploy preview: Netlify injects
   its preview drawer before </body>, so without this allowance no deploy preview
   could ever pass the content gate — the gate would be useless exactly where a
   release candidate is verified. */
const previewFixture=builtFixture.replace("</body>",
  "<div data-netlify-deploy-id=\"6a8c9aa\" data-netlify-site-id=\"dc0e170\" "+
  "data-vcs=\"github\" style=\"position:fixed\">\n  \n  "+
  "<script async src=\"/.netlify/scripts/cdp\"></script>\n</div>\n</body>");

test("a deploy preview passes the content gate and says what was tolerated",()=>{
  const result=compareDeployedHtml(previewFixture,builtFixture,"index.html");
  assert.equal(result.match,true,result.message);
  assert.ok(result.rewritesApplied.some(name=>/deploy-preview drawer/.test(name)),
    "the tolerated injection is named in the output, not silently removed");
});

test("the preview allowance removes the drawer and nothing else",()=>{
  const sabotaged=previewFixture.replace("<body>","<body><script>alert(1)</script>");
  const result=compareDeployedHtml(sabotaged,builtFixture,"index.html");
  assert.equal(result.match,false,"content injected outside the drawer is still drift");
  assert.equal(stripPreviewDrawer(builtFixture).stripped,null,
    "a page without a drawer is returned untouched");
});

test("a probe answered by a preview's catch-all is not a published file",()=>{
  // The reference page carries the drawer too, because the same deployment served
  // it. Comparing a stripped probe against an unstripped reference reported all
  // twenty allowlist probes as published files on the first real preview run.
  assert.equal(unpublishedPathFailure("/README.md",200,previewFixture,previewFixture),null);
});

/* Tolerated under protest: Netlify injects this into production pages and offers no
   way off it below a paid plan. The allowance is narrow on purpose — all three parts,
   in order — so it cannot widen into cover for real drift. */
const injectionFixture=builtFixture.replace("<html lang=\"en-US\">",
  "<html lang=\"en-US\">\n<!-- This site is hosted on Netlify. Anyone can build and deploy a site\n"+
  "     like this one for free: https://netlify.new/?utm_campaign=ai-legible -->\n"+
  "<meta name=\"hosting-provider\" content=\"Netlify\">\n"+
  "<meta name=\"netlify-deploy\" content=\"https://netlify.new/?utm_campaign=ai-legible\">");

test("the production hosting injection is tolerated and named on every passing run",()=>{
  const result=compareDeployedHtml(injectionFixture,builtFixture,"index.html");
  assert.equal(result.match,true,result.message);
  assert.ok(result.rewritesApplied.some(name=>/hosting-provider/.test(name)),
    "a tolerated injection must be reported, so nobody forgets the allowance is there");
});

test("the hosting allowance needs all three parts and covers nothing else",()=>{
  // Two of the three: the comment and one meta tag. Not the documented injection,
  // so not covered — an allowance that matched partially could cover real drift.
  const partial=injectionFixture.replace(
    "\n<meta name=\"netlify-deploy\" content=\"https://netlify.new/?utm_campaign=ai-legible\">","");
  assert.equal(compareDeployedHtml(partial,builtFixture,"index.html").match,false,
    "a partial match is drift, not the known injection");

  const withDrift=injectionFixture.replace("<body>","<body><script>alert(1)</script>");
  assert.equal(compareDeployedHtml(withDrift,builtFixture,"index.html").match,false,
    "content injected elsewhere is still caught while the allowance applies");

  assert.equal(stripHostingInjection(builtFixture).stripped,null,
    "a page without the injection is returned untouched");
});

test("an undocumented rewrite of the same link is drift, not an allowance",()=>{
  // Same href, different transformation: extension kept, quotes changed. Nothing
  // in the record says Netlify does this, so it must not be waved through.
  const deployed=builtFixture.replace("href=\"/business-licensing.html\"",
    "href='/business-licensing.html'");
  assert.equal(compareDeployedHtml(deployed,builtFixture,"index.html").match,false);
});

test("unexpected drift is reported with the page and the first differing line",()=>{
  const deployed=builtFixture.replace("<body>","<body><script>alert(1)</script>");
  const result=compareDeployedHtml(deployed,builtFixture,"business-licensing.html");
  assert.equal(result.match,false);
  assert.equal(result.firstDifference.line,3,"the injected line is located, not just declared");
  assert.match(result.message,/business-licensing\.html/,"the failing page is named");
  assert.match(result.message,/line 3/);
  assert.match(result.message,/alert\(1\)/,"the actual deployed line is shown");
});

test("truncated deployments are drift rather than a silent match",()=>{
  const result=compareDeployedHtml(builtFixture.split("\n").slice(0,4).join("\n"),
    builtFixture,"index.html");
  assert.equal(result.match,false);
  assert.equal(result.firstDifference.line,5);
});

test("the built pages still contain the links the rewrite allowances describe",async()=>{
  // If a link is renamed, its allowance becomes dead permission to accept a rewrite
  // that can no longer occur. Fail here rather than let the allowance rot.
  for(const rewrite of PRETTY_URL_REWRITES){
    const pages=[html,licensingHtml].filter(page=>page.includes(rewrite.from));
    assert.ok(pages.length>0,
      "no page contains "+rewrite.from+", so its Pretty URLs allowance is now dead");
  }
});

test("every missing security directive is reported, not only the first",()=>{
  const headers=new Map([["referrer-policy","strict-origin-when-cross-origin"],
    ["strict-transport-security","max-age=600"]]);
  const missing=missingHeaderDirectives({get:name=>headers.get(name)??null},{
    "referrer-policy":["strict-origin-when-cross-origin"],
    "strict-transport-security":["max-age=31536000","includeSubDomains"],
    "x-content-type-options":["nosniff"]
  });
  assert.equal(missing.length,3,"a shortened HSTS window, a dropped subdomain flag "+
    "and an absent header are three findings, not one");
  assert.ok(missing.every(finding=>/strict-transport-security|x-content-type-options/.test(finding)));
});

test("a repository path is unpublished when it 404s or answers with the app",()=>{
  const app=builtFixture;
  const served=app.replace("href=\"/index.html\"","href='/'");
  assert.equal(unpublishedPathFailure("/README.md",404,"Not Found",app),null,
    "a 404 proves the file is not published");
  assert.equal(unpublishedPathFailure("/README.md",200,served,app),null,
    "the catch-all rewrite answers with the app, post-processing included");
  assert.match(unpublishedPathFailure("/README.md",200,"# Millcreek Property Lookup",app),
    /README\.md/,"repository content served at 200 is the failure this gate exists for");
});

/* The release-candidate smoke run touches real resident data — production readiness
   Task 5. It looks up a published synthetic address on a deployed candidate, and the
   parcel that comes back is real: owner name, mailing details. Everything that could
   write that to a file has to stay off, and "stay" is the operative word. Turning
   tracing on to debug one failed release would quietly start capturing residents'
   records into a CI artifact. Fail here instead. */
test("the production smoke run cannot capture resident data",async()=>{
  const config=await readFile(new URL("../playwright.production.config.mjs",import.meta.url),"utf8");
  for(const setting of ["trace","screenshot","video"])
    assert.ok(config.includes(setting+': "off"'),
      "the production config must set "+setting+' to "off"');

  const spec=await readFile(new URL("./production.spec.mjs",import.meta.url),"utf8");
  assert.match(spec,/results redacted/,
    "the spec must blank the results body before returning, because Playwright writes "+
    "its error-context page snapshot after the test body ends");
  const bodyReads=spec.split("\n").filter(line=>line.includes("#results-body")&&
    /toContainText|toHaveText|textContent\(\)|innerText/.test(line));
  assert.deepEqual(bodyReads,[],"no assertion may read the content of a live results body");

  const pkg=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
  assert.equal(pkg.scripts["test:production"],
    "playwright test --config playwright.production.config.mjs",
    "test:production must run under the production config, not the default one");
  assert.ok(!pkg.scripts.test.includes("test:production"),
    "`npm test` must not hit live services or a deployment");
  const defaultConfig=await readFile(new URL("../playwright.config.mjs",import.meta.url),"utf8");
  assert.match(defaultConfig,/testIgnore:\s*"production\.spec\.mjs"/,
    "the deterministic browser suite globs **/*.spec.mjs, so it must exclude the "+
    "production spec explicitly or `npm test` runs a live lookup");
  /* A `vite preview` from an unrelated project on this machine was listening on
     4173 — Vite's default preview port — and Playwright reused it. All 63 tests
     ran against a stranger's page and failed with `CFG is not defined`. The suite
     must start its own server, always, on a port nothing else defaults to. */
  assert.match(defaultConfig,/reuseExistingServer:\s*false/,
    "the browser suite must never adopt a server it did not start");
  assert.doesNotMatch(defaultConfig,/127\.0\.0\.1:4173/,
    "4173 is Vite's default preview port and is contended on any machine with "+
    "another Vite project");

  const ignored=await readFile(new URL("../.gitignore",import.meta.url),"utf8");
  for(const path of ["test-results-production/","production-evidence/"])
    assert.ok(ignored.includes(path),path+" must not be committable");
});

/* Candidate verification is the evidence a production promotion rests on — readiness
   Task 6. It must stay a verifier and never become a deployer: no environment, no
   secret, no promotion step. It must also verify the candidate against the artifact
   built from the same commit, or its content gate compares two different versions
   and reports a version gap as deployment drift. */
test("candidate verification produces evidence and cannot promote a release",async()=>{
  const workflow=await readFile(new URL("../.github/workflows/verify-deployment.yml",
    import.meta.url),"utf8");

  assert.match(workflow,/on:\s*[\s\S]*workflow_dispatch:/,"it is run deliberately, by a person");
  assert.match(workflow,/workflow_call:/,"a release workflow can reuse it");
  assert.doesNotMatch(workflow,/^\s*(push|schedule):/m,
    "verification must not be triggered by a push or a timer: it verifies a candidate "+
    "someone has already deployed");

  assert.match(workflow,/candidate_url:/,"the candidate URL is an explicit input");
  assert.match(workflow,/required:\s*true/,"the candidate URL cannot be omitted");
  assert.match(workflow,/permissions:\s*\n\s*contents:\s*read/,"least privilege");
  assert.doesNotMatch(workflow,/environment:/,
    "no environment: an environment is how a deployment credential would reach this");
  assert.doesNotMatch(workflow,/secrets\./,"verification needs no secret");
  assert.doesNotMatch(workflow,/netlify deploy|--prod|gh release create/,
    "verification must not deploy or promote anything");

  assert.match(workflow,/timeout-minutes:/,"the job is bounded");
  assert.doesNotMatch(workflow,/uses:\s*actions\/[\w-]+@v\d/,
    "actions are pinned to immutable reviewed commits, not to moving tags");

  assert.match(workflow,/npm ci/,"the locked dependency graph, not a fresh resolve");
  assert.match(workflow,/npm run build/,
    "the candidate is compared against the artifact this commit builds");
  assert.match(workflow,/npm run check:deployment/,"content, allowlist and header gates");
  assert.match(workflow,/npm run test:production/,"both live user flows");
  assert.match(workflow,/DEPLOY_URL:\s*\$\{\{\s*inputs\.candidate_url\s*\}\}/,
    "both checks are pointed at the candidate rather than at the default site");

  assert.match(workflow,/sha256sum/,"the built artifact hash is part of the release record");
  assert.match(workflow,/upload-artifact/,"evidence is retained");
  assert.match(workflow,/production-evidence\//,"the sanitized smoke evidence is uploaded");
  assert.doesNotMatch(workflow,/test-results-production\//,
    "the Playwright output directory is not uploaded: its failure snapshots are "+
    "redacted but are not release evidence");
});

/* The attorney review material must not be in a public repository.

   One of the two documents was committed on 20 August 2026 while the other was
   ignored by name, and nothing noticed for six days. `.gitignore` listed files, so a
   document with a slightly different filename fell outside the rule meant to cover
   it. That commit has since been purged from history entirely, which cost a rewrite
   of every SHA in the repository — the expensive way to learn that the rule should
   have named the directory rather than the files inside it.

   The directory is ignored now, and this asserts the property that actually matters
   — that nothing under it is tracked — rather than the wording of the rule. */
test("no attorney review document is tracked in this public repository",async()=>{
  const { execFileSync }=await import("node:child_process");
  const root=new URL("../",import.meta.url);
  let tracked;
  try{
    tracked=execFileSync("git",["ls-files","counsel-review"],
      {cwd:root,encoding:"utf8",stdio:["ignore","pipe","ignore"]});
  }catch{
    return;  // not a git checkout (a release tarball, say): nothing to assert
  }
  assert.equal(tracked.trim(),"",
    "counsel-review/ is tracked, and this repository is public on GitHub. The "+
    "documents belong on disk and in the municipal record, not in git history.");
});

/* Repository and release governance — production readiness Task 9.

   Governance files rot in a specific way: written once, with a placeholder where a
   name should go, and nobody notices because nothing reads them. A CODEOWNERS
   naming nobody routes review to nobody; a security contact that is an example
   address means a vulnerability report goes nowhere. These assert that the files
   exist, name real people, and describe the release convention the repository
   actually follows. */

const PLACEHOLDERS=/\b(TODO|TBD|FIXME|your-org|your-name|example\.com|placeholder|CHANGEME)\b/i;

test("the resident-facing version agrees with the repository's own",async()=>{
  /* Three copies, one of which residents paste into emails to staff. They
     disagreed — 2026.8.13 against 2026.08.13 — for long enough that both were
     quoted in different documents. RELEASE.md fixes the format as zero-padded
     CalVer; this is what makes that stick. */
  const pkg=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
  const {CFG:appConfig}=await readApp();
  const {CFG:licensingConfig}=await readBusinessApp();
  const versions={
    "package.json":pkg.version,
    "index.html":appConfig.release.version,
    "business-licensing.html":licensingConfig.release.version
  };
  for(const [where,version] of Object.entries(versions))
    assert.match(version,/^\d{4}\.\d{2}\.\d{2}$/,
      where+" must carry a zero-padded CalVer version, got "+version);
  assert.equal(new Set(Object.values(versions)).size,1,
    "the three version fields disagree: "+JSON.stringify(versions));
});

test("the release convention is documented and matches what is published",async()=>{
  const release=await readFile(new URL("../RELEASE.md",import.meta.url),"utf8");
  assert.match(release,/YYYY\.MM\.DD/,"the version convention is stated");
  assert.match(release,/v<version>|v2026\./,"the tag convention is stated");
  assert.match(release,/CHANGES-YYYY-MM-DD\.md/,"the changelog convention is stated");
  assert.match(release,/Rollback target/,"a release record names its rollback target");
  assert.match(release,/Approver/,"a release record names who decided");

  /* dataReviewedOn ages on its own and is shown to every resident. If it is ever
     removed to stop it looking old, this fails rather than the page quietly
     dropping the one field that says how current the data is. */
  const {CFG:appConfig}=await readApp();
  assert.ok(appConfig.release.dataReviewedOn,"index.html still declares dataReviewedOn");
  assert.match(appConfig.release.dataReviewedOn,/^\d{4}-\d{2}-\d{2}$/);
  assert.ok(appConfig.release.publishedOn,"index.html still declares publishedOn");
});

test("review, security reporting and dependency updates are owned by real people",async()=>{
  const read=async name=>readFile(new URL("../"+name,import.meta.url),"utf8");

  const codeowners=await read(".github/CODEOWNERS");
  assert.doesNotMatch(codeowners,PLACEHOLDERS,
    "CODEOWNERS still contains a placeholder: review would route to nobody");
  assert.ok([...codeowners.matchAll(/@[\w-]+/g)].length>0,"CODEOWNERS names a reviewer");
  assert.match(codeowners,/^\*\s+@/m,"every path has a default owner");

  const security=await read("SECURITY.md");
  assert.doesNotMatch(security,PLACEHOLDERS,
    "SECURITY.md still contains a placeholder: a vulnerability report would go nowhere");
  assert.match(security,/@millcreekut\.gov/,
    "the security contact is a millcreekut.gov address, not a personal or example one");
  assert.match(security,/Do not open a public GitHub issue/i,
    "a public repository must say so before someone files a vulnerability in the open");
  assert.match(security,/\b\d+ (business )?days?\b/i,"a response commitment is stated");

  const dependabot=await read(".github/dependabot.yml");
  assert.match(dependabot,/package-ecosystem:\s*npm/);
  assert.match(dependabot,/package-ecosystem:\s*github-actions/,
    "actions are SHA-pinned, so something has to update the pins");
  assert.match(dependabot,/interval:\s*weekly/);

  const template=await read(".github/PULL_REQUEST_TEMPLATE.md");
  assert.match(template,/check:deployment/,"the template asks for deployment evidence");
  assert.match(template,/SHARED REQUEST LAYER/,"the template protects the shared layer");
  assert.match(template,/resident data/i,
    "the template asks whether anything can carry resident data");
});

/* The deterministic job had one non-deterministic step.

   Playwright's `--with-deps` runs `apt-get update`, which consults whatever
   third-party repositories the runner image has configured. On 27 August 2026 two
   Microsoft apt repositories returned 403 and the step died with code 100, failing
   a pull request whose change was documentation. A run of the same commit passed
   minutes later.

   Retrying it is consistent with what this project already decided about transient
   failure in the service monitor: retry transport, never retry a contract. So the
   retry must stay confined to that one step — if `npm run test:unit`, the build or
   the browser suite were ever retried, a flaky assertion would be laundered into a
   pass, which is the opposite of what CI is for. */
test("only the browser install is retried, and it is bounded",async()=>{
  const workflow=await readFile(new URL("../.github/workflows/quality.yml",import.meta.url),"utf8");
  const steps=workflow.split(/^      - name: /m).slice(1);
  const retrying=steps.filter(step=>/for attempt in/.test(step))
    .map(step=>step.split("\n")[0].trim());
  assert.deepEqual(retrying,["Install Chromium"],
    "exactly one step may retry, and it is the one that depends on third-party "+
    "package repositories at run time");

  const install=steps.find(step=>step.startsWith("Install Chromium"));
  assert.match(install,/for attempt in 1 2 3/,"bounded at three attempts");
  assert.match(install,/exit 1/,"a persistent failure still fails the job");
  assert.match(install,/no longer transient/,
    "the final failure says why it is being reported rather than retried again");
});

/* Correspondence is not code, and this repository is public.

   Draft emails to counsel, the records officer, IT and DNS sit in `emails/` so
   they are easy to find while they are being worked on. They name individuals and
   they change as conversations move; none of that belongs in a public repository,
   and the requests they are drawn from are already recorded in the internal readiness plan.

   The rule ignores the directory rather than the files in it, which is the lesson
   from the attorney review document: a per-file list let a document with a
   slightly different name straight through. This asserts the property that
   matters — nothing under emails/ is tracked — rather than the wording of the
   rule, exactly as the counsel-review test does. */
test("no draft correspondence is tracked in this public repository",async()=>{
  const { execFileSync }=await import("node:child_process");
  let tracked;
  try{
    tracked=execFileSync("git",["ls-files","emails"],
      {cwd:new URL("../",import.meta.url),encoding:"utf8",stdio:["ignore","pipe","ignore"]});
  }catch{
    return;  // not a git checkout: nothing to assert
  }
  assert.equal(tracked.trim(),"",
    "emails/ is tracked, and this repository is public on GitHub. Draft "+
    "correspondence names individuals and belongs on disk, not in git history.");
});

/* The Azure port split deployment in two: an unattended staging deploy on every
   push to `main`, and a manual production promotion behind the `production`
   environment's required reviewers. That split is the only thing standing between
   a merge and the public site, and it is three lines of YAML wide — a `push:`
   trigger added to the promotion workflow, or the production token referenced
   from the staging one, would remove it silently and nothing would look wrong.

   The approval itself lives in repository settings and cannot be asserted from
   here. What can be asserted is that this repository never builds a path around
   it, so that is what these two tests do. */
test("production promotion is manual, reviewed, and rebuilds nothing",async()=>{
  const workflow=await readFile(
    new URL("../.github/workflows/promote-production.yml",import.meta.url),"utf8");

  assert.match(workflow,/on:\s*\n\s*workflow_dispatch:/,"a person starts it, deliberately");
  assert.doesNotMatch(workflow,/^\s*(push|schedule|workflow_run):/m,
    "promotion must not be triggered by a push, a timer, or another workflow "+
    "finishing: those are all ways for a merge to reach production unattended");
  assert.match(workflow,/environment:\s*production/,
    "the production environment is where the required reviewer and the production "+
    "token both live; without it the approval gate does not exist");

  assert.match(workflow,/run_id:/,"the candidate is named explicitly");
  assert.match(workflow,/required:\s*true/,"the candidate cannot be omitted");
  assert.match(workflow,/run-id:\s*\$\{\{\s*inputs\.run_id\s*\}\}/,
    "the artifact comes from the named staging run");

  /* Rebuilding would make the approval meaningless: the approver signed off on
     bytes that were verified, not on a commit that can build differently. */
  assert.doesNotMatch(workflow,/npm run build|npm ci/,
    "promotion republishes a built artifact and must not build a new one");
  assert.match(workflow,/deploy-staging\.yml/,
    "the run being promoted is checked to be a staging deploy");
  assert.match(workflow,/conclusion/,"a failed run cannot be promoted");
  assert.match(workflow,/head_branch|branch/,"a run from an unreviewed branch cannot be promoted");

  assert.match(workflow,/sha256sum/,"the promoted hashes are part of the release record");
  assert.match(workflow,/timeout-minutes:/,"the job is bounded");
  assert.doesNotMatch(workflow,/uses:\s*[\w./-]+@v\d/,
    "actions are pinned to immutable reviewed commits, not to moving tags");
});

test("the unattended staging deploy cannot reach production",async()=>{
  const workflow=await readFile(
    new URL("../.github/workflows/deploy-staging.yml",import.meta.url),"utf8");

  assert.match(workflow,/environment:\s*staging/,"the staging token is environment-scoped");
  /* The staging secret's name contains the production secret's name, so this has
     to exclude a trailing name character or it matches its own allowed value. */
  assert.doesNotMatch(workflow,/AZURE_STATIC_WEB_APPS_API_TOKEN(?![_A-Z])/,
    "an unattended job must not reference the production deployment token");
  assert.match(workflow,/AZURE_STATIC_WEB_APPS_API_TOKEN_STAGING/,
    "it deploys with the staging token");
  assert.doesNotMatch(workflow,/environment:\s*production/,
    "nothing in the automatic path may enter the production environment");

  /* The uploaded artifact must be the one the gates ran against, not a rebuild:
     the promotion workflow republishes it verbatim, so any gap here is a gap
     between what was tested and what residents load. */
  const gateIndex=workflow.indexOf("Run browser tests");
  const uploadIndex=workflow.indexOf("Upload the built site");
  assert.ok(gateIndex>0&&uploadIndex>gateIndex,
    "the artifact is uploaded after the gates, not before them");
  assert.match(workflow,/if-no-files-found:\s*error/,
    "an empty artifact must fail rather than promote nothing to production later");
  assert.doesNotMatch(workflow,/uses:\s*[\w./-]+@v\d/,
    "actions are pinned to immutable reviewed commits, not to moving tags");
});

/* ===========================================================================
   A5, 10 September 2026: dataReviewedOn stays human-set (ADR-0004), and the
   live monitor only warns — never fails — when it looks stale.
   =========================================================================== */

test("buildReport carries dataReviewedOn and a numeric age, and warns only past 90 days",async()=>{
  const {buildReport,dataReviewWarning}=await import("../scripts/service-contract-core.mjs");
  const checks=[{key:"x",ok:true}];

  const fresh=buildReport(checks,
    {generatedAt:"2026-09-10T00:00:00.000Z",dataReviewedOn:"2026-08-13"});
  assert.equal(fresh.dataReviewedOn,"2026-08-13");
  assert.equal(typeof fresh.dataReviewedAgeDays,"number");
  assert.equal(fresh.dataReviewedAgeDays,28);
  assert.equal(dataReviewWarning(fresh),null,"28 days old is well under the 90-day expectation");
  // The age figure must never affect whether the run is considered ok — see
  // ADR-0004: this monitor proves the contracts hold, not that a person
  // reviewed the layers again.
  assert.equal(fresh.ok,true);

  const stale=buildReport(checks,
    {generatedAt:"2026-12-20T00:00:00.000Z",dataReviewedOn:"2026-08-13"});
  assert.equal(stale.dataReviewedAgeDays,129);
  assert.match(dataReviewWarning(stale),/129 days old/);
  assert.match(dataReviewWarning(stale),/90-day/);
  assert.equal(stale.ok,true,"an old review date is a warning, never a failed contract");

  // Missing either date yields null rather than a wrong number of days.
  const noDate=buildReport(checks,{generatedAt:"2026-09-10T00:00:00.000Z"});
  assert.equal(noDate.dataReviewedAgeDays,null);
  assert.equal(dataReviewWarning(noDate),null);
});

test("check-services.mjs derives the data-review age from CFG.release.dataReviewedOn",async()=>{
  const source=await readFile(new URL("../scripts/check-services.mjs",import.meta.url),"utf8");
  assert.match(source,/dataReviewedOn:\s*CFG\.release\.dataReviewedOn/,
    "the live monitor's age check must read the same dataReviewedOn the page publishes, "+
    "not a value it tracks separately");
  assert.match(source,/dataReviewWarning/,
    "check-services.mjs must call the shared warning helper rather than re-deriving it");
});

// The workflow file has to keep naming dataReviewedOn so the age check cannot
// be quietly dropped from the job without a reviewer noticing the comment
// disappear along with it.
test("the live-service-monitor workflow documents the dataReviewedOn age check",async()=>{
  const workflow=await readFile(
    new URL("../.github/workflows/live-service-monitor.yml",import.meta.url),"utf8");
  assert.match(workflow,/dataReviewedOn/);
  assert.match(workflow,/90.day/i);
});

test("every displayed layer's governance metadata is still intact after A5",()=>{
  // A5 reads sourceOwner/reviewedOn to build resident-facing attribution but
  // must not touch the values themselves — re-assert the A2-era governance
  // test's shape here so a regression in this PR's own diff is caught by the
  // test it is closest to, not only by the pre-existing one far above.
  const {CFG}=pureApp();
  for(const layer of CFG.LAYERS.filter(layer=>!layer.hidden)){
    assert.ok(layer.sourceOwner,layer.key+" source owner");
    assert.match(layer.reviewedOn,/^\d{4}-\d{2}-\d{2}$/,layer.key+" review date");
  }
  assert.ok(CFG.parcel.sourceOwner,"CFG.parcel.sourceOwner");
  assert.match(CFG.parcel.reviewedOn,/^\d{4}-\d{2}-\d{2}$/,"CFG.parcel.reviewedOn");
});
