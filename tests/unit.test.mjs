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
   and the requests they are drawn from are already recorded in tasks/todo.md.

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
