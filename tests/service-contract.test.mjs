import assert from "node:assert/strict";
import test from "node:test";

/* Live-service monitoring — production readiness Task 8.

   The monitor watches ArcGIS and FEMA for contract drift: a renamed field, a layer
   dropped from the public web map, a known hazard parcel that stops intersecting.
   Those findings are the point of it, and none of them may ever be retried or
   softened — a field that is missing twice is still missing.

   Transport failure is a different thing entirely, and the monitor could not tell
   the difference. On 26 August 2026 it hit a TLS reset after 7 of 51 checks and
   passed 51/51 on the next run with nothing changed in between. Weekly, that is a
   false alarm that teaches its recipient to ignore it.

   Everything below is pure so both cases can be reproduced without a network. */
import { BACKOFF_MS, buildReport, classifyHttp, classifyThrown, contractFailure,
  renderSummary, withRetry } from "../scripts/service-contract-core.mjs";

test("transport failures worth retrying are the only ones marked transient",()=>{
  for(const status of [408,425,429,500,502,503,504])
    assert.equal(classifyHttp(status).transient,true,"HTTP "+status+" is transient");
  for(const status of [400,401,403,404,410,422])
    assert.equal(classifyHttp(status).transient,false,"HTTP "+status+" is not transient");
  assert.equal(classifyHttp(200).kind,"ok");
});

test("network and timeout errors are transient; a wrong host is not",()=>{
  const withCode=code=>Object.assign(new TypeError("fetch failed"),{cause:{code}});
  for(const code of ["ECONNRESET","ETIMEDOUT","ECONNREFUSED","EAI_AGAIN","EPIPE"])
    assert.equal(classifyThrown(withCode(code)).transient,true,code+" is transient");
  // A hostname that does not resolve is a configuration error. Retrying it wastes
  // the monitor's time and reports the wrong thing when it finally gives up.
  assert.equal(classifyThrown(withCode("ENOTFOUND")).transient,false);
  assert.equal(classifyThrown(Object.assign(new Error("t"),{name:"TimeoutError"})).transient,true);
});

test("a contract failure is never transient, whatever it is wrapped in",()=>{
  // The whole point of the monitor. A renamed field, a parity gap or a known-result
  // change must not be retried into looking intermittent.
  const failure=contractFailure("parcel missing configured fields: own_name");
  assert.equal(classifyThrown(failure).transient,false);
  assert.equal(classifyThrown(new assert.AssertionError({message:"x"})).transient,false);
  // Even if it arrives carrying a code that would otherwise be retried.
  assert.equal(classifyThrown(Object.assign(contractFailure("drift"),
    {cause:{code:"ECONNRESET"}})).transient,false);
});

test("retries are bounded, spaced, and stop as soon as the call succeeds",async()=>{
  assert.ok(BACKOFF_MS.length>0&&BACKOFF_MS.length<=3,"bounded attempts");
  assert.deepEqual([...BACKOFF_MS].sort((a,b)=>a-b),[...BACKOFF_MS],"backoff increases");

  const slept=[];
  const sleep=async ms=>{slept.push(ms);};
  let calls=0;
  const result=await withRetry(async()=>{
    calls++;
    if(calls<3) throw Object.assign(new TypeError("fetch failed"),{cause:{code:"ECONNRESET"}});
    return "recovered";
  },{sleep});
  assert.equal(result.value,"recovered");
  assert.equal(result.attempts,3);
  assert.deepEqual(slept,BACKOFF_MS.slice(0,2),"waited the configured backoff, in order");
});

test("a contract failure is reported on the first attempt without sleeping",async()=>{
  const slept=[];
  let calls=0;
  await assert.rejects(withRetry(async()=>{
    calls++;
    throw contractFailure("known hazard parcel no longer intersects FEMA SFHA");
  },{sleep:async ms=>{slept.push(ms);}}),/no longer intersects/);
  assert.equal(calls,1,"a contract failure is not retried");
  assert.deepEqual(slept,[],"and is not waited on");
});

test("a persistent transient failure gives up and says how many times it tried",async()=>{
  let calls=0;
  await assert.rejects(withRetry(async()=>{
    calls++;
    throw Object.assign(new TypeError("fetch failed"),{cause:{code:"ECONNRESET"}});
  },{sleep:async()=>{}}),/ECONNRESET|fetch failed/);
  assert.equal(calls,BACKOFF_MS.length+1,"one initial attempt plus each backoff");
});

const checks=[
  {key:"address",ok:true,detail:"/Address_Points/FeatureServer/0",note:"12 fields"},
  {key:"parcel",ok:false,detail:"/Millcreek_Parcels/FeatureServer/0",
    failure:{kind:"contract",message:"missing configured fields: own_name",attempts:1}},
  {key:"flood",ok:false,detail:"/FEMA",
    failure:{kind:"network",message:"fetch failed",attempts:3}},
  {key:"web-map-parity",ok:true,detail:"21 layers"}
];

test("the report names every failed contract, not only the first",()=>{
  const report=buildReport(checks,{generatedAt:"2026-08-26T12:00:00.000Z"});
  assert.equal(report.ok,false);
  assert.equal(report.total,4);
  assert.deepEqual(report.failed.map(check=>check.key),["parcel","flood"]);
  // Transport and contract failures must be distinguishable by a reader who is
  // deciding whether to wake somebody up.
  assert.equal(report.contractFailures.length,1);
  assert.equal(report.transportFailures.length,1);

  const summary=renderSummary(report);
  for(const fragment of ["parcel","own_name","flood","fetch failed"])
    assert.ok(summary.includes(fragment),"the summary names "+fragment);
});

test("a clean run reports itself as clean",()=>{
  const report=buildReport(checks.filter(check=>check.ok),{generatedAt:"2026-08-26T12:00:00.000Z"});
  assert.equal(report.ok,true);
  assert.deepEqual(report.failed,[]);
  assert.match(renderSummary(report),/2\s*\/\s*2|all 2/i);
});

test("the report cannot carry resident data",()=>{
  /* The monitor queries parcels with outFields=*, so owner names and mailing
     details pass through the process. None of it may reach a report that CI
     uploads as an artifact — only keys, service paths, counts and our own
     messages. Anything unrecognised is dropped rather than trusted. */
  const leaky=[{key:"parcel",ok:false,detail:"/Millcreek_Parcels/FeatureServer/0",
    attributes:{own_name:"ALEX EXAMPLE",care_of:"SOMEONE"},
    features:[{own_name:"ALEX EXAMPLE"}],
    failure:{kind:"contract",message:"missing configured fields: own_name",attempts:1,
      response:{own_name:"ALEX EXAMPLE"}}}];
  const serialized=JSON.stringify(buildReport(leaky,{generatedAt:"2026-08-26T12:00:00.000Z"}));
  assert.doesNotMatch(serialized,/ALEX EXAMPLE/,"feature attributes are dropped");
  assert.doesNotMatch(serialized,/SOMEONE/);
  assert.match(serialized,/own_name/,"the field NAME is the finding and must survive");
});
