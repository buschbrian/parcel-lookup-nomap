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
});

test("CI sets up the Python that the test suite and preview server need",async()=>{
  const workflow=await readFile(new URL("../.github/workflows/quality.yml",import.meta.url),"utf8");
  // npm test runs `python -m unittest`, and Playwright's webServer is python http.server.
  assert.match(workflow,/actions\/setup-python/,
    "the workflow provisions Python rather than relying on the runner image");
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
