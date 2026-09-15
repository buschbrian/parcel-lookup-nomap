/* Telling a broken service apart from a broken contract.
   -----------------------------------------------------------------------
   The live-service monitor exists to catch drift in what ArcGIS and FEMA
   publish: a renamed field, a layer dropped from the public web map, a known
   hazard parcel that stops intersecting the flood layer. Those findings are the
   whole point, and none of them may ever be retried or softened — a field that
   is missing twice is still missing, and a monitor that retries until it agrees
   with itself is worse than no monitor.

   Transport failure is a different thing, and the monitor could not tell the
   difference. On 26 August 2026 it hit a TLS reset after 7 of 51 checks and
   passed 51/51 on the next run with nothing changed between them. Run weekly,
   that is a false alarm that trains its recipient to ignore the real one.

   So: classify, retry only what is worth retrying, and report every failure in
   a form a person can act on at 8am without opening a log.

   Everything here is pure and injectable, so both cases are reproducible in the
   unit suite without a network. */

import assert from "node:assert/strict";

/* Bounded on purpose. Three attempts total: enough to ride out a reset or a
   rate-limit, few enough that a genuinely dead service is reported inside a
   minute rather than after a long silence. */
export const BACKOFF_MS=Object.freeze([500,2000]);

const TRANSIENT_STATUSES=new Set([408,425,429,500,502,503,504]);

/* Transport-level failure codes worth a second look. ENOTFOUND is deliberately
   absent: a hostname that does not resolve is a configuration error, and
   retrying it wastes the monitor's time and then reports the wrong thing.
   EAI_AGAIN is the transient DNS case and is included. */
const TRANSIENT_CODES=new Set(["ECONNRESET","ECONNREFUSED","ETIMEDOUT","EPIPE",
  "EAI_AGAIN","EHOSTUNREACH","ENETUNREACH","ENETDOWN","ECONNABORTED",
  "UND_ERR_CONNECT_TIMEOUT","UND_ERR_HEADERS_TIMEOUT","UND_ERR_BODY_TIMEOUT",
  "UND_ERR_SOCKET"]);

const CONTRACT=Symbol.for("millcreek.serviceContractFailure");

/* A finding about what the service publishes, rather than about reaching it.
   Marked so no amount of wrapping can get it retried. */
export function contractFailure(message,detail){
  const error=new Error(message);
  error[CONTRACT]=true;
  error.kind="contract";
  if(detail!==undefined) error.detail=detail;
  return error;
}

export function classifyHttp(status){
  if(status>=200&&status<300) return {kind:"ok",transient:false};
  if(status===429) return {kind:"rate-limited",transient:true};
  if(status===408||status===425) return {kind:"timeout",transient:true};
  if(TRANSIENT_STATUSES.has(status)) return {kind:"server",transient:true};
  return {kind:"http",transient:false};
}

/* The kind a report should show for a thrown error: "contract" for anything
   marked as one (see contractFailure above) or a failed assertion, otherwise
   whatever transport classification produced it — classifyHttp's kind, copied
   onto the error inside check-services.mjs's json() helper — or "unknown" for
   an error nothing here recognises. A single check and a settled batch of
   per-item checks (settleLayerChecks below) both need this, so it lives once
   rather than being re-derived at each call site and risking drift between
   them. */
export function classifyCheckFailure(error){
  if(error?.kind==="contract"||error instanceof assert.AssertionError) return "contract";
  return error?.kind||"unknown";
}

/* Settles every item's check before anything is reported, so failures that
   happen at the same time on different items are each recorded with their
   own classification. A single fail-fast Promise.all here used to mean
   whichever rejection arrived first was the only one anybody ever saw — a
   transport error on one polygon layer could bury a genuine contract failure
   on another, and which one survived depended on network timing rather than
   on what actually went wrong (A1-R02).

   Pure and injectable: `run` stands in for the per-item network call, so this
   is exercised in the unit suite with a fake per-item function and no fetch.
   Returns the fulfilled values in item order (undefined where an item
   failed) alongside one failure record per rejection, already shaped for
   checks.push in check-services.mjs. */
export async function settleLayerChecks(items,keyFor,run){
  const outcomes=await Promise.allSettled(items.map(item=>run(item)));
  const failures=[];
  const values=outcomes.map((outcome,index)=>{
    if(outcome.status==="fulfilled") return outcome.value;
    const error=outcome.reason;
    failures.push({key:keyFor(items[index]),ok:false,
      failure:{kind:classifyCheckFailure(error),message:error?.message||String(error),
        attempts:error?.attempts||1}});
    return undefined;
  });
  return {failures,values};
}

export function classifyThrown(error){
  // Contract findings and assertion failures first: these outrank any transport
  // code they happen to be carrying.
  if(error?.[CONTRACT]||error?.kind==="contract") return {kind:"contract",transient:false};
  if(error instanceof assert.AssertionError) return {kind:"contract",transient:false};
  const name=error?.name||"";
  if(name==="TimeoutError"||name==="AbortError") return {kind:"timeout",transient:true};
  const code=error?.cause?.code||error?.code||"";
  if(TRANSIENT_CODES.has(code)) return {kind:"network",transient:true};
  if(code) return {kind:"network",transient:false};
  if(name==="TypeError"&&/fetch failed/i.test(error?.message||""))
    return {kind:"network",transient:true};
  return {kind:"unknown",transient:false};
}

/* ==== TRANSPORT POLICY — textually identical to the copy in each page's shared
   request layer; a unit test compares the two ====

   The monitor must reach the services the same way the pages do. When it sent a
   long parcel boundary as a GET and the page did too, both failed the same way
   and the monitor at least agreed with reality; if only one of them changed,
   the monitor would either pass a parcel the page cannot load or fail one it
   can. So the rule lives here in the same words, and the request helper in
   check-services.mjs applies it.

   Keep the function below byte-for-byte the same as the pages' copy. The
   reasoning behind it — why the whole URL is measured, and why the geometry is
   never rounded to fit — is documented at that copy in index.html. */
function transportFor(fullUrl, cfg){
  const limit = Number(cfg?.request?.maxUrlBytes);
  if(!Number.isFinite(limit) || limit <= 0) return "GET";
  return new TextEncoder().encode(String(fullUrl)).length > limit ? "POST" : "GET";
}
export { transportFor };

/* ==== FIELD LISTS — no query anywhere asks for outFields=* (A2, 10 September
   2026) ====

   Every layer query requests exactly the fields it renders plus the layer's
   object id; the parcel record query requests exactly the parcel facts, owner
   fields and coordinates the page displays. Both pages carry their own inline
   copy of this formula — a self-contained page cannot import a module — so it
   lives here once as the reference the monitor uses directly and a unit test
   compares each page's copy against. A difference here is a field silently
   absent from a real request, or an owner/mailing field requested somewhere
   it does not need to be. */
export function parcelFieldList(CFG){
  // Spelled out as CFG.parcel.<field> rather than aliased, so a unit test can
  // assert by literal text that owner, care-of and Assessor-link verification
  // cannot be quietly dropped from the live contract.
  return [...new Set([CFG.parcel.idField,CFG.parcel.latField,CFG.parcel.lonField,
    CFG.parcel.ownerField,CFG.parcel.careOfField,CFG.parcel.assessorLinkField,
    ...CFG.PARCEL_FACTS.map(([field])=>field),
    ...(CFG.PARCEL_FLAGS||[]).map(flag=>flag.field)])];
}
export function layerFieldList(layer){
  return [...new Set([...Object.keys(layer.fields||{}),
    ...(layer.nameField?[layer.nameField]:[]),
    ...(layer.rankField?[layer.rankField]:[]),
    ...(layer.designationKey?[layer.designationKey]:[]),
    layer.oidField||"OBJECTID",
    ...(layer.extraFields||[])])];
}

/* ==== PROBE GEOMETRY - textually identical to the copies in the page's pure
   helper region; a unit test compares them ====

   The zoning coverage contracts below have to build the same probe points the
   page builds. If the monitor probed differently it would confirm designations
   the page cannot confirm, or miss ones it does - and either way the contract
   would be checking something no resident receives. The reasoning behind both
   functions - why even-odd parity is exactly "inside an outer ring and outside
   every hole", why a point on a ring is rejected, and why the rounding happens
   before the test - is documented at the page's copy in index.html.

   Keep both functions byte-for-byte the same as that copy. */
function pointInRings(rings,x,y){
  let inside=false;
  for(const ring of rings||[]){
    if(!Array.isArray(ring)) continue;
    for(let i=0,n=ring.length;i<n;i++){
      const from=ring[i], to=ring[(i+1)%n];
      if(!from||!to) continue;
      const x1=Number(from[0]),y1=Number(from[1]),x2=Number(to[0]),y2=Number(to[1]);
      if(!(Number.isFinite(x1)&&Number.isFinite(y1)&&Number.isFinite(x2)&&Number.isFinite(y2))) continue;
      const cross=(x2-x1)*(y-y1)-(y2-y1)*(x-x1);
      if(Math.abs(cross)<=1e-12 &&
         x>=Math.min(x1,x2)-1e-12 && x<=Math.max(x1,x2)+1e-12 &&
         y>=Math.min(y1,y2)-1e-12 && y<=Math.max(y1,y2)+1e-12) return false;
      if((y1>y)!==(y2>y) && x < x1+(y-y1)*(x2-x1)/(y2-y1)) inside=!inside;
    }
  }
  return inside;
}

function probePoints(geometry,cfg,storedPoint){
  const rings=(geometry&&geometry.rings)||[];
  const grid=Math.max(1,Math.floor(Number(cfg&&cfg.probeGrid))||5);
  const cap=Math.max(1,Math.floor(Number(cfg&&cfg.maxProbes))||25);
  const decimals=Number(cfg&&cfg.coordDecimals);
  const places=Number.isFinite(decimals)?decimals:6;
  const round=value=>Number(Number(value).toFixed(places));
  let xmin=Infinity,ymin=Infinity,xmax=-Infinity,ymax=-Infinity;
  for(const ring of rings) for(const vertex of ring||[]){
    const x=Number(vertex&&vertex[0]), y=Number(vertex&&vertex[1]);
    if(!(Number.isFinite(x)&&Number.isFinite(y))) continue;
    if(x<xmin) xmin=x; if(x>xmax) xmax=x;
    if(y<ymin) ymin=y; if(y>ymax) ymax=y;
  }
  if(!(Number.isFinite(xmin)&&Number.isFinite(ymin)&&
       Number.isFinite(xmax)&&Number.isFinite(ymax))) return [];
  const points=[], seen=new Set();
  const offer=(x,y)=>{
    if(points.length>=cap) return;
    const px=round(x), py=round(y);
    if(!(Number.isFinite(px)&&Number.isFinite(py))) return;
    const id=px+","+py;
    if(seen.has(id)) return;
    seen.add(id);
    if(pointInRings(rings,px,py)) points.push([px,py]);
  };
  if(storedPoint) offer(storedPoint[0],storedPoint[1]);
  for(let row=0;row<grid;row++)
    for(let column=0;column<grid;column++)
      offer(xmin+(xmax-xmin)*(column+0.5)/grid, ymin+(ymax-ymin)*(row+0.5)/grid);
  return points;
}

export { pointInRings, probePoints };

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/* Run `work`, retrying only transient transport failure, on a bounded schedule.
   Resolves to {value, attempts} so a report can say a check needed two goes —
   which is worth knowing even when it eventually passed. */
export async function withRetry(work,{sleep=wait}={}){
  let attempts=0;
  for(;;){
    attempts++;
    try{
      return {value:await work(),attempts};
    }catch(error){
      const {transient}=classifyThrown(error);
      const remaining=BACKOFF_MS[attempts-1];
      if(!transient||remaining===undefined){
        error.attempts=attempts;
        throw error;
      }
      await sleep(remaining);
    }
  }
}

/* One check, reduced to the fields a report may contain.

   The monitor's parcel query still explicitly requests ownerField and
   careOfField (see parcelFieldList above), so owner names and mailing details
   pass through the same process that writes this file, and CI uploads it as
   an artifact. Copy across an allowlist rather than filtering a denylist:
   anything unrecognised is dropped instead of trusted. */
function sanitizeCheck(check){
  const clean={key:String(check.key),ok:check.ok===true};
  if(check.detail!==undefined) clean.detail=String(check.detail);
  if(check.note!==undefined) clean.note=String(check.note);
  if(check.skipped) clean.skipped=true;
  if(check.failure){
    clean.failure={
      kind:String(check.failure.kind||"unknown"),
      message:String(check.failure.message||""),
      attempts:Number(check.failure.attempts||1)
    };
  }
  return clean;
}

/* dataReviewedAgeDays (A5, 10 September 2026): how many whole days separate
   this run from the date a person last reviewed the GIS layers behind the
   published page, i.e. CFG.release.dataReviewedOn. Neither `ok` nor
   `failed`/`contractFailures` is touched by this figure — see
   docs/decisions/0004-the-data-review-date-stays-human.md for why an aging
   human-set date is a call the monitor surfaces, and does not fail the run
   over. `dataReviewedOn` parses as a UTC midnight so the count is not one day
   off depending on the machine running the check. Either date missing or
   unparsable yields `null` rather than a wrong number of days. */
function dataReviewAge(generatedAt,dataReviewedOn){
  if(!generatedAt||!dataReviewedOn) return null;
  const generated=Date.parse(generatedAt);
  const reviewed=Date.parse(dataReviewedOn+"T00:00:00Z");
  if(!Number.isFinite(generated)||!Number.isFinite(reviewed)) return null;
  return Math.floor((generated-reviewed)/86400000);
}

export function buildReport(checks,{generatedAt,dataReviewedOn}={}){
  const clean=checks.map(sanitizeCheck);
  const failed=clean.filter(check=>!check.ok&&!check.skipped);
  return {
    ok:failed.length===0,
    generatedAt:generatedAt||null,
    dataReviewedOn:dataReviewedOn||null,
    dataReviewedAgeDays:dataReviewAge(generatedAt,dataReviewedOn),
    total:clean.length,
    passed:clean.filter(check=>check.ok).length,
    skipped:clean.filter(check=>check.skipped).length,
    checks:clean,
    failed,
    /* Split by cause, because the reader is deciding whether to wake somebody.
       A contract failure means the published data changed and the page may now
       be wrong. A transport failure that survived the retries means the service
       is down, which is ArcGIS's problem and not a release blocker. */
    contractFailures:failed.filter(check=>check.failure?.kind==="contract"),
    transportFailures:failed.filter(check=>check.failure?.kind!=="contract")
  };
}

/* RELEASE.md's sequence step 1 asks a named person to confirm dataReviewedOn
   is current before every release; this is the automated, non-blocking half
   of that same fact. 90 days matches RELEASE.md's stated review expectation.
   Crossing it is a warning here, never a failure — see
   docs/decisions/0004-the-data-review-date-stays-human.md for why: this
   monitor proves the configured fields and known parcels still answer, not
   that a person looked at the GIS layers again, so it cannot certify the
   review current — only flag when it is due. */
export const DATA_REVIEW_MAX_AGE_DAYS=90;

export function dataReviewWarning(report){
  if(typeof report.dataReviewedAgeDays!=="number") return null;
  if(report.dataReviewedAgeDays<=DATA_REVIEW_MAX_AGE_DAYS) return null;
  return "dataReviewedOn ("+report.dataReviewedOn+") is "+report.dataReviewedAgeDays+
    " days old, past the "+DATA_REVIEW_MAX_AGE_DAYS+"-day review expectation in "+
    "RELEASE.md. Review the GIS layers behind this release and update "+
    "CFG.release.dataReviewedOn in both pages.";
}

export function renderSummary(report){
  const lines=["## Live service contract",""];
  if(report.ok){
    lines.push("All "+report.passed+"/"+report.total+" service contracts hold.");
    if(report.skipped)
      lines.push("","**"+report.skipped+(report.skipped===1?" check":" checks")+
      " skipped** - a prerequisite failed.");
  }else{
    lines.push("**"+report.failed.length+" of "+report.total+" service contracts failed.**","");
    const section=(title,rows,explanation)=>{
      if(!rows.length) return;
      lines.push("### "+title,"",explanation,"");
      for(const check of rows)
        lines.push("- **"+check.key+"** - "+check.failure.message+
          (check.detail?" (`"+check.detail+"`)":"")+
          (check.failure.attempts>1?", after "+check.failure.attempts+" attempts":""));
      lines.push("");
    };
    /* Two audiences in one report. Contract drift means the published data changed
       and the page may now be wrong, which is Millcreek's problem to act on.
       Transport failure that survived the retries means the service is down, which
       is not. Anyone woken at 8am needs to know which one they are looking at. */
    section("Contract drift",report.contractFailures,
      "What the services publish has changed, so the page may now be wrong. These are "+
      "never retried: a field that is missing twice is still missing.");
    section("Service unavailable",report.transportFailures,
      "Retried on a bounded backoff and still failing. This is the hosting service's "+
      "problem rather than a change in the data.");
    if(report.skipped)
      lines.push("**"+report.skipped+(report.skipped===1?" check":" checks")+
        " skipped** - a prerequisite failed.","");
  }
  return lines.join("\n")+"\n";
}
