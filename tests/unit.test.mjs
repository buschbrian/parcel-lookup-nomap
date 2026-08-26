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
    "sameSet,matchSummary,esc,likeOperand});"
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
  const source=await readFile(new URL("../scripts/check-services.mjs",import.meta.url),"utf8");
  for(const key of ["ownerField","careOfField","assessorLinkField"])
    assert.match(source,new RegExp("CFG\\.parcel\\."+key),
      "check-services.mjs verifies CFG.parcel."+key);
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

  const required=["index.html","business-licensing.html","_headers","assets/millcreek-logo.png"];
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
    // `_headers` is only honoured from inside the publish directory: if it is left
    // behind, every security header silently disappears from the deployed site.
    for(const name of required)
      assert.ok(served.includes(name),publishDir+"/ is missing "+name);
    const leaked=served.filter(name=>engineering.test(name)||repoFile.test(name));
    assert.deepEqual(leaked,[],publishDir+"/ would serve engineering files: "+leaked.join(", "));
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
  assert.equal(packageJson.devDependencies?.vite,"7.3.6","Vite is pinned exactly");
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
    assert.match(workflow,new RegExp("name: "+name+"[\\s\\S]{0,100}run: "+command
      .replace(/[.*+?^${}()|[\]\\]/g,"\\$&")),name+" is an independent CI step");
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
  const changes=await readFile(new URL("../CHANGES-2026-08-06.md",import.meta.url),"utf8");
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
