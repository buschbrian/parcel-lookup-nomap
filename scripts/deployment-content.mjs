/* What a correct deployment is allowed to differ by, and nothing else.
   -----------------------------------------------------------------------
   `check:deployment` proves that the bytes Netlify serves are the bytes the
   build produced. It could never pass, because Netlify's Pretty URLs asset
   post-processing parses the deployed HTML and rewrites two links before
   serving them. Both forms were measured against the live site on 13 August
   2026 and re-confirmed on 26 August 2026 — see CHANGES-2026-08-13.md §7:

     index.html               href="/business-licensing.html" -> href='/business-licensing'
     business-licensing.html  href="/index.html"              -> href='/'

   The second is not extension-stripping; it is `/index.html` collapsing to the
   directory root. An implementation that handles only the first leaves the
   licensing page failing after the property page passes.

   These are *allowances for a known host transformation*, not a normalisation
   pass. The comparison applies each documented rewrite to the BUILT bytes and
   requires the result to equal the deployed bytes exactly. Any other change —
   an injected script, a stale deploy, a truncated response — still fails, and
   fails with the line it first differs at. If Pretty URLs is ever turned off,
   the untransformed comparison passes on its own and these allowances become
   inert; the unit suite fails if the links they name stop existing.

   Everything here is pure so the contract is testable without a deployment. */

export const PRETTY_URL_REWRITES=[
  {
    name:"the .html extension stripped and the attribute re-quoted",
    from:"href=\"/business-licensing.html\"",
    to:"href='/business-licensing'"
  },
  {
    name:"the index page collapsed to the directory root",
    from:"href=\"/index.html\"",
    to:"href='/'"
  }
];

const MAX_SHOWN=160;

function show(line){
  if(line===null||line===undefined) return "(no such line — the response ends here)";
  return line.length>MAX_SHOWN?line.slice(0,MAX_SHOWN)+"…":line;
}

/* Every form the built bytes are allowed to take once the host has post-processed
   them: each documented rewrite either happened or it did not, so the accepted set
   is every subset of the rewrites. Netlify applied these two on different pages and
   at different times — the licensing form was found only after the property page
   was already passing — so requiring all-or-nothing would fail a correct deploy.
   Two rewrites is four candidates; the guard keeps that from quietly becoming 2^n
   string builds if the list ever grows. */
function acceptableForms(built){
  if(PRETTY_URL_REWRITES.length>4)
    throw new Error("too many rewrite allowances to enumerate; the deployment host "+
      "is transforming more than a documented special case can justify");
  const forms=[];
  for(let mask=0;mask<(1<<PRETTY_URL_REWRITES.length);mask++){
    const applied=[];
    let text=built;
    for(const [index,rewrite] of PRETTY_URL_REWRITES.entries()){
      if(!(mask&(1<<index))||!text.includes(rewrite.from)) continue;
      text=text.split(rewrite.from).join(rewrite.to);
      applied.push(rewrite.name);
    }
    forms.push({text,applied});
  }
  return forms;
}

function firstDifference(actual,expected){
  const actualLines=actual.split("\n");
  const expectedLines=expected.split("\n");
  const limit=Math.max(actualLines.length,expectedLines.length);
  for(let index=0;index<limit;index++){
    if(actualLines[index]===expectedLines[index]) continue;
    const a=actualLines[index]??"";
    const b=expectedLines[index]??"";
    let column=0;
    while(column<a.length&&column<b.length&&a[column]===b[column]) column++;
    return {line:index+1,column:column+1,
      expected:expectedLines[index]??null,actual:actualLines[index]??null};
  }
  return null;
}

/* Compare one deployed page against its built bytes.

   Returns {match, page, rewritesApplied, firstDifference, message}. On failure the
   difference is reported against whichever candidate the deployment resembles more
   closely — the raw build or the rewritten build — so the message points at the real
   drift rather than at the Pretty URLs link every time. */
export function compareDeployedHtml(deployed,built,page="the deployed page"){
  if(deployed===built) return {match:true,page,rewritesApplied:[],firstDifference:null};
  const forms=acceptableForms(built);
  const accepted=forms.find(form=>form.text===deployed);
  if(accepted)
    return {match:true,page,rewritesApplied:accepted.applied,firstDifference:null};

  const candidates=forms.map(form=>({
    label:form.applied.length
      ?"the built bytes with "+form.applied.join(" and ")
      :"the built bytes",
    difference:firstDifference(deployed,form.text)
  }));
  const closest=candidates.reduce((best,candidate)=>
    (candidate.difference?.line??0)>(best.difference?.line??0)?candidate:best);
  const difference=closest.difference;
  const message=page+" does not match "+closest.label+
    "\n  first difference at line "+difference.line+", column "+difference.column+
    "\n    built   : "+show(difference.expected)+
    "\n    deployed: "+show(difference.actual);
  return {match:false,page,rewritesApplied:[],firstDifference:difference,message};
}

/* Every required directive that is absent, so one run reports the whole gap.
   `headers` is anything with a `get(name)` returning a string or null. */
export function missingHeaderDirectives(headers,required){
  const missing=[];
  for(const [name,directives] of Object.entries(required)){
    const value=headers.get(name)||"";
    for(const directive of directives){
      if(!value.includes(directive))
        missing.push(name+" is missing "+directive+
          (value?" (served: "+show(value)+")":" (header absent)"));
    }
  }
  return missing;
}

/* The publish directory is an allowlist; this is the post-deploy proof.

   A status code alone cannot prove it: the catch-all rewrite answers unmatched
   paths with the app at HTTP 200, so "not published" and "published" look the
   same. Compare the body instead — a published repository file returns its own
   content. A real 404 is equally conclusive, and is what the site returns for a
   path the catch-all does not cover. Returns a failure message, or null. */
export function unpublishedPathFailure(path,status,body,appHtml){
  if(status===404) return null;
  if(compareDeployedHtml(body,appHtml,path).match) return null;
  return path+" is served from the deployment (HTTP "+status+"): the publish "+
    "directory is exposing repository files\n    served: "+show(body.split("\n")[0]);
}
