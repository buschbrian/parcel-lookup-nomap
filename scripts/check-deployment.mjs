/* Post-deploy verification: what is served, what is not served, and how.

   This is the only automated proof that the deployed site is the artifact this
   repository built. It runs against a URL, so it is also the check used on a
   deploy preview before a release candidate is promoted:

     DEPLOY_URL=https://<preview>.netlify.app/ npm run check:deployment

   Two properties it had to gain for production (readiness Task 4):

   1. It compares against the BUILT bytes and tolerates only the two recorded
      Netlify Pretty URLs rewrites — see scripts/deployment-content.mjs. Before
      this, exact-byte equality could never hold and the check had never gated
      anything despite being named as the post-deploy gate in four documents.

   2. It runs every gate and reports all findings. It used to abort on the first
      failed assertion, which meant a content difference hid the header and
      publish-allowlist results entirely — the two gates that matter most when
      something has gone wrong with a deploy. */

import { readBuiltPage } from "./app-config.mjs";
import { compareDeployedHtml, missingHeaderDirectives,
  unpublishedPathFailure } from "./deployment-content.mjs";

const TIMEOUT=20_000;
const url=process.env.DEPLOY_URL||"https://parcel-lookup-millcreek.netlify.app/";
const failures=[];
const note=message=>console.log(message);
const fail=message=>{failures.push(message);console.log("FAIL  "+message);};

/* Netlify publishes `dist/`, so source HTML is not what gets served and comparing
   against it would prove nothing. Refuse to run rather than fall back quietly. */
const built={
  "index.html":await readBuiltPage("index.html"),
  "business-licensing.html":await readBuiltPage("business-licensing.html")
};
for(const [name,text] of Object.entries(built)){
  if(text!==null) continue;
  console.error("dist/"+name+" is missing. Run `npm run build` first: this check "+
    "compares the deployment against the built artifact, not against source.");
  process.exit(1);
}

note("verifying "+url+" against dist/");

async function get(path){
  const target=new URL(path,url);
  try{
    const response=await fetch(target,{signal:AbortSignal.timeout(TIMEOUT)});
    return {response,body:await response.text()};
  }catch(error){
    return {error:error.message||String(error)};
  }
}

/* Gate 1 and 2: both entry pages are the pages this repository built. */
const pages={};
for(const [name,path] of [["index.html","/"],["business-licensing.html","/business-licensing.html"]]){
  const fetched=await get(path);
  if(fetched.error){fail(name+" could not be fetched: "+fetched.error);continue;}
  pages[name]=fetched;
  if(!fetched.response.ok){fail(name+" returned HTTP "+fetched.response.status);continue;}
  const result=compareDeployedHtml(fetched.body,built[name],name);
  if(!result.match){fail(result.message);continue;}
  note("ok    "+name+" matches the built artifact"+(result.rewritesApplied.length
    ?" (host post-processing tolerated: "+result.rewritesApplied.join("; ")+")":""));
}

/* Gate 3: the publish directory is an allowlist. No repository file becomes
   public by being committed — the property this whole publish design exists for.
   Probe the paths whose exposure would be worst: the code walkthrough, the
   service contract with its test parcels, the legal review document, the
   readiness plan. A file added to the repository does not appear here
   automatically, so the unit suite asserts the publish directory contents too. */
const mustNotBePublished=["/CODE.md","/USAGE.md","/README.md","/DATA-SOURCES.md",
  "/MIGRATION.md","/CHANGES-2026-08-13.md","/package.json","/package-lock.json",
  "/.nvmrc","/playwright.config.mjs","/vite.config.mjs","/netlify.toml",
  "/scripts/check-services.mjs","/scripts/check-deployment.mjs","/tests/unit.test.mjs",
  "/tasks/plan.md","/tasks/todo.md","/.github/workflows/quality.yml",
  "/counsel-review/Public-Facing-GIS-Disclaimer-One-Page-Review.docx",
  "/docs/decisions/0001-use-vite-with-build-time-configuration.md"];
/* Compare each probe against the app AS THIS DEPLOYMENT SERVES IT, not against the
   built bytes. The catch-all answers unmatched paths with index.html, so whatever
   the host did to that page — Pretty URLs, a deploy-preview drawer — is in every
   probe response too. Comparing to the build made one page-level difference cascade
   into a failure on all twenty paths, none of which was actually published. The
   served page is the right reference; a published repository file still stands out,
   because it answers with its own content. Falls back to the build if the page
   could not be fetched, which is already a reported failure by then. */
const servedApp=pages["index.html"]?.body??built["index.html"];
let unpublished=0;
for(const path of mustNotBePublished){
  const probe=await get(path);
  if(probe.error){fail("probing "+path+" failed: "+probe.error);continue;}
  const failure=unpublishedPathFailure(path,probe.response.status,probe.body,servedApp);
  if(failure) fail(failure); else unpublished++;
}
note("ok    "+unpublished+"/"+mustNotBePublished.length+" repository paths are not published");

/* Gate 4: every security header in public/_headers reached the deployed site.
   Assert the directives, not just the presence of the header: a silent downgrade
   to a shorter HSTS window or a dropped includeSubDomains would otherwise pass. */
const required={
  "content-security-policy":["default-src 'none'","connect-src https://services9.arcgis.com",
    "https://hazards.fema.gov"],
  "permissions-policy":["geolocation=()","camera=()","microphone=()"],
  "referrer-policy":["strict-origin-when-cross-origin"],
  "strict-transport-security":["max-age=31536000","includeSubDomains"],
  "x-content-type-options":["nosniff"],
  "cache-control":["max-age=0","must-revalidate"]
};
for(const [name,fetched] of Object.entries(pages)){
  const missing=missingHeaderDirectives(fetched.response.headers,required);
  if(missing.length) for(const finding of missing) fail(name+": "+finding);
  else note("ok    "+name+" carries every declared security header");
}

if(failures.length){
  console.error("\n"+failures.length+" deployment "+
    (failures.length===1?"gate":"gates")+" failed against "+url);
  process.exit(1);
}
console.log("\nall deployment gates passed against "+url);
