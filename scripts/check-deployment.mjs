import assert from "node:assert/strict";
import { readApp, readBusinessApp, readBuiltPage } from "./app-config.mjs";

/* What the deployment is compared against.
   -----------------------------------------------------------------------
   Before ADR-0001 the deployed bytes were the repository bytes, because
   `public/` was published verbatim. Once Vite builds the site, the deployed
   bytes are the BUILT bytes — Vite rewrites entry HTML — so comparing against
   source would fail for a correct deployment and, worse, would pass only while
   the build was doing nothing.

   So: prefer `dist/` when it exists, and say which was used. Run
   `npm run build` before this check once the migration has landed. */
const builtIndex=await readBuiltPage("index.html");
const builtBusiness=await readBuiltPage("business-licensing.html");
const usingBuild=builtIndex!==null&&builtBusiness!==null;

const html=usingBuild?builtIndex:(await readApp()).html;
const businessHtml=usingBuild?builtBusiness:(await readBusinessApp()).html;
console.log(usingBuild
  ? "comparing the deployment against dist/ (built artifact)"
  : "comparing the deployment against source HTML (no dist/ found — run `npm run build` if the site is now built)");
const url=process.env.DEPLOY_URL||"https://parcel-lookup-millcreek.netlify.app/";
const response=await fetch(url,{signal:AbortSignal.timeout(20_000)});
assert.equal(response.ok,true,"deployment returned HTTP "+response.status);
const deployed=await response.text();
assert.equal(deployed,html,"deployed HTML does not match index.html");
const businessUrl=new URL("/business-licensing.html",url);
const businessResponse=await fetch(businessUrl,{signal:AbortSignal.timeout(20_000)});
assert.equal(businessResponse.ok,true,"business licensing page returned HTTP "+businessResponse.status);
assert.equal(await businessResponse.text(),businessHtml,
  "deployed business licensing HTML does not match business-licensing.html");

// The publish directory is an allowlist, and this is the post-deploy proof of it.
// The catch-all rewrite answers unmatched paths with the app at HTTP 200, so a status
// code cannot distinguish "not served" from "served"; compare the body instead. If a
// repository file is being published, its own content comes back rather than the app.
const mustNotBePublished=["/CODE.md","/USAGE.md","/README.md","/DATA-SOURCES.md",
  "/package.json","/playwright.config.mjs","/netlify.toml","/scripts/check-services.mjs",
  "/tests/unit.test.mjs","/docs/decisions/0001-use-vite-with-build-time-configuration.md"];
for(const path of mustNotBePublished){
  const probe=await fetch(new URL(path,url),{signal:AbortSignal.timeout(20_000)});
  assert.equal(await probe.text(),html,
    path+" is served from the deployment: the publish directory is exposing repository files");
}
console.log("ok",mustNotBePublished.length,"repository paths are not published");

const required={
  "content-security-policy":["default-src 'none'","connect-src https://services9.arcgis.com",
    "https://hazards.fema.gov"],
  "permissions-policy":["geolocation=()","camera=()","microphone=()"],
  "referrer-policy":["strict-origin-when-cross-origin"],
  // Assert the directives, not just the presence of max-age: a silent downgrade to a
  // shorter window or a dropped includeSubDomains would otherwise pass this gate.
  "strict-transport-security":["max-age=31536000","includeSubDomains"],
  "x-content-type-options":["nosniff"],
  "cache-control":["max-age=0","must-revalidate"]
};
for(const checkedResponse of [response,businessResponse]){
  for(const [name,parts] of Object.entries(required)){
    const value=checkedResponse.headers.get(name)||"";
    for(const part of parts) assert.ok(value.includes(part),name+" is missing "+part);
  }
}
console.log("both deployed HTML pages and security headers match the repository");
