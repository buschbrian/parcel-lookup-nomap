/* What a correct deployment is allowed to differ by, and nothing else.
   -----------------------------------------------------------------------
   `check:deployment` proves that the bytes the host serves are the bytes the
   build produced. On Azure Static Web Apps that is the whole contract: Azure
   does not post-process HTML, so the deployed bytes must equal the built bytes
   exactly, with no allowance of any kind.

   It was not always so. Netlify applied three transformations this file had to
   tolerate — two Pretty URLs link rewrites, its deploy-preview drawer, and from
   26 August 2026 a marketing comment with two meta tags that carried UTM
   tracking and the site id. All three were removed when Netlify was retired on
   2026-09-16; see docs/decisions/0005-retire-netlify.md and
   CHANGES-2026-09-16.md. The history is in git if a future host ever needs the
   same shape of allowance again — but add one only for a transformation that is
   measured, documented, and reported on every passing run, which is what kept
   the old ones honest.

   Everything here is pure so the contract is testable without a deployment. */

const MAX_SHOWN=160;

function show(line){
  if(line===null||line===undefined) return "(no such line — the response ends here)";
  return line.length>MAX_SHOWN?line.slice(0,MAX_SHOWN)+"…":line;
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
  if(deployed===built)
    return {match:true,page,rewritesApplied:[],firstDifference:null};

  const difference=firstDifference(deployed,built);
  const message=page+" does not match the built bytes"+
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
