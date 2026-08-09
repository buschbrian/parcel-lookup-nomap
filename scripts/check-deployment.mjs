import assert from "node:assert/strict";
import { readApp, readBusinessApp } from "./app-config.mjs";

const {html}=await readApp();
const {html:businessHtml}=await readBusinessApp();
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

const required={
  "content-security-policy":["default-src 'none'","connect-src https://services9.arcgis.com",
    "https://hazards.fema.gov"],
  "permissions-policy":["geolocation=()","camera=()","microphone=()"],
  "referrer-policy":["strict-origin-when-cross-origin"],
  "strict-transport-security":["max-age="],
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
