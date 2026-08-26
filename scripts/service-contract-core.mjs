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

   The monitor queries parcels with outFields=*, so owner names and mailing
   details pass through the same process that writes this file, and CI uploads
   it as an artifact. Copy across an allowlist rather than filtering a denylist:
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

export function buildReport(checks,{generatedAt}={}){
  const clean=checks.map(sanitizeCheck);
  const failed=clean.filter(check=>!check.ok&&!check.skipped);
  return {
    ok:failed.length===0,
    generatedAt:generatedAt||null,
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

export function renderSummary(report){
  const lines=["## Live service contract",""];
  if(report.ok){
    lines.push("All "+report.passed+"/"+report.total+" service contracts hold.");
    if(report.skipped)
      lines.push("","**"+report.skipped+(report.skipped===1?" check":" checks")+
      " skipped** - a prerequisite failed.");
    return lines.join("\n")+"\n";
  }
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
  return lines.join("\n")+"\n";
}
