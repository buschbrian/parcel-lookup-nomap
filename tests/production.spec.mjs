import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";

/* Release-candidate smoke test: the deployed pages, the live public services, one
   real lookup each. Production readiness Task 5.

   Everything else in this repository tests the code. `check:deployment` tests the
   bytes and the headers. Nothing tested whether a person can look up an address on
   the deployed site — MIGRATION.md names that seam explicitly and left it open
   before the first build-based deploy.

   PRIVACY. The address below is the synthetic fixture already published in this
   repository (scripts/check-services.mjs, tests/app.spec.mjs, DATA-SOURCES.md), so
   using it discloses nothing new. But the RESULTS are real: a live lookup returns
   the owner name and mailing details for a real parcel. So this file asserts
   structure only — that the status region says results are ready, that the sections
   rendered, that the accessibility scan is clean — and never reads, logs, attaches
   or serialises result content. The evidence it writes is counts and timings.
   playwright.production.config.mjs disables tracing, screenshots and video for the
   same reason. Keep it that way. */

const ADDRESS="3300 E SANTA ROSA AVE";

/* The hosts the page is permitted to fetch data from, read from the CSP that the
   deployment actually serves. Deriving them means this list cannot drift from the
   policy, and a candidate that has quietly gained a new data host fails the
   `connect-src` assertion in check:deployment rather than being silently measured
   here as if it were expected. */
const csp=await readFile(new URL("../public/_headers",import.meta.url),"utf8");
const SERVICE_HOSTS=[...csp.matchAll(/connect-src([^;]*)/g)]
  .flatMap(match=>match[1].trim().split(/\s+/))
  .filter(value=>value.startsWith("https://"))
  .map(value=>new URL(value).host);

const EVIDENCE=new URL("../production-evidence/",import.meta.url);

if(!process.env.DEPLOY_URL)
  throw new Error("DEPLOY_URL is required: this suite verifies a deployed candidate, "+
    "not a local build. Use `npm run test:e2e` for the local mocked suite.");

/* One flow's worth of observation. Deliberately additive and structural: nothing
   here can hold a fragment of a returned record. */
function observe(page,flow){
  const record={flow,url:null,documentStatus:null,pageErrors:[],httpFailures:[],
    serviceRequests:0,peakConcurrency:0,renderedFields:0,lookupMs:null,loadMs:null};
  let inFlight=0;
  const isService=url=>{
    try{ return SERVICE_HOSTS.includes(new URL(url).host); }catch{ return false; }
  };
  page.on("pageerror",error=>record.pageErrors.push(error.message));
  page.on("request",request=>{
    if(!isService(request.url())) return;
    record.serviceRequests++;
    inFlight++;
    record.peakConcurrency=Math.max(record.peakConcurrency,inFlight);
  });
  const settle=()=>{ inFlight=Math.max(0,inFlight-1); };
  page.on("requestfinished",request=>{ if(isService(request.url())) settle(); });
  page.on("requestfailed",request=>{
    if(!isService(request.url())) return;
    settle();
    // Only the URL and the transport failure — never a response body.
    record.httpFailures.push(request.failure()?.errorText+" "+new URL(request.url()).pathname);
  });
  page.on("response",response=>{
    if(response.status()<400) return;
    if(!isService(response.url())&&!response.url().startsWith(process.env.DEPLOY_URL)) return;
    record.httpFailures.push("HTTP "+response.status()+" "+new URL(response.url()).pathname);
  });
  return record;
}

async function retain(record){
  await mkdir(EVIDENCE,{recursive:true});
  await writeFile(new URL(record.flow+".json",EVIDENCE),
    JSON.stringify(record,null,2)+"\n","utf8");
  console.log("evidence "+record.flow+": "+JSON.stringify({
    documentStatus:record.documentStatus,loadMs:record.loadMs,lookupMs:record.lookupMs,
    serviceRequests:record.serviceRequests,peakConcurrency:record.peakConcurrency,
    renderedFields:record.renderedFields,
    pageErrors:record.pageErrors.length,httpFailures:record.httpFailures.length
  }));
}

/* Both flows are the same contract against two pages, so they share one body: load
   the deployed page, run the published address, reach a ready status, scan it. */
async function smoke(page,{flow,path,minimumFields}){
  const record=observe(page,flow);
  record.url=new URL(path,process.env.DEPLOY_URL).href;

  try{
    const startedLoad=Date.now();
    const response=await page.goto(record.url,{waitUntil:"domcontentloaded"});
    record.loadMs=Date.now()-startedLoad;
    record.documentStatus=response?.status()??null;
    expect(record.documentStatus,"the candidate served the page").toBe(200);

    const startedLookup=Date.now();
    await page.locator("#q").fill(ADDRESS);
    await page.locator("#lookup").evaluate(form=>form.requestSubmit());
    await expect(page.locator("#status")).toContainText("Results ready",{timeout:60_000});
    record.lookupMs=Date.now()-startedLookup;
    await expect(page.locator("#results")).toBeVisible();

    /* Structure, not content: the results body rendered, it has the shape of a
       filled report rather than an empty shell, and the actions the page promises
       are usable. Counting <dt> elements says a report was built without reading
       one word of what it says about the property. */
    await expect(page.locator("#results-body")).toBeVisible();
    const fields=await page.locator("#results-body dt").count();
    expect(fields,"the results body rendered labelled fields").toBeGreaterThanOrEqual(minimumFields);
    record.renderedFields=fields;
    for(const selector of ["#copy","#print"])
      await expect(page.locator(selector),selector+" is available").toBeVisible();

    /* A degraded lookup still says "Results ready" and marks the unavailable
       sources — correct behaviour for a resident, and not something to promote a
       release on. Treat it as a candidate finding: the service monitor says which
       source, this says the candidate is not clean. */
    await expect(page.locator("#status"),
      "no data source was reported as unavailable during the candidate lookup")
      .not.toContainText(/data source/i);

    const scan=await new AxeBuilder({page}).analyze();
    // Ids and selectors only. An axe node includes the failing element's HTML, which
    // on a results page is resident data.
    expect(scan.violations.map(violation=>violation.id),"axe violations").toEqual([]);

    expect(record.pageErrors,"uncaught page errors").toEqual([]);
    expect(record.httpFailures,"failed requests").toEqual([]);
    expect(record.serviceRequests,"the page queried the live services").toBeGreaterThan(0);
  }finally{
    /* Playwright writes an `error-context.md` page snapshot when a test fails, and
       it is written AFTER the test body returns. On a results page that snapshot is
       the owner name and mailing details. Redact the report while we still can; the
       status region, the form and the page structure survive for diagnosis. */
    await page.evaluate(()=>{
      const body=document.querySelector("#results-body");
      if(body) body.textContent="[results redacted: this run does not retain resident data]";
    }).catch(()=>{});
    await retain(record);
  }
}

test("the deployed general property lookup completes against live services",async({page})=>{
  // The general report is the large one: parcel facts, zoning, hazards, services.
  await smoke(page,{flow:"general-lookup",path:"/",minimumFields:10});
});

test("the deployed licensing lookup completes against live services",async({page})=>{
  // The licensing screen is two checks: the parcel's own status and the buffer.
  await smoke(page,{flow:"licensing-lookup",path:"/business-licensing.html",minimumFields:2});
});
