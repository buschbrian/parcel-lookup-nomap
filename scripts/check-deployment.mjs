import assert from "node:assert/strict";
import { readApp } from "./app-config.mjs";

const {html}=await readApp();
const url=process.env.DEPLOY_URL||"https://parcel-lookup-millcreek.netlify.app/";
const response=await fetch(url,{signal:AbortSignal.timeout(20_000)});
assert.equal(response.ok,true,"deployment returned HTTP "+response.status);
const deployed=await response.text();
assert.equal(deployed,html,"deployed HTML does not match index.html");

const required={
  "content-security-policy":["default-src 'none'","connect-src https://services9.arcgis.com",
    "https://hazards.fema.gov","https://webmaps.geology.utah.gov"],
  "permissions-policy":["geolocation=()","camera=()","microphone=()"],
  "referrer-policy":["strict-origin-when-cross-origin"],
  "strict-transport-security":["max-age="],
  "x-content-type-options":["nosniff"],
  "cache-control":["max-age=0","must-revalidate"]
};
for(const [name,parts] of Object.entries(required)){
  const value=response.headers.get(name)||"";
  for(const part of parts) assert.ok(value.includes(part),name+" is missing "+part);
}
console.log("deployment HTML and security headers match the repository");
