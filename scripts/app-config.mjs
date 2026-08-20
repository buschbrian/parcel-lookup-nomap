import { readFile } from "node:fs/promises";
import vm from "node:vm";

/* Entry HTML location during the ADR-0001 migration.
   -----------------------------------------------------------------------
   Vite treats `public/` as a verbatim passthrough directory, so the entry
   pages have to move to the repository root to be processed by the build.
   That move is a separate commit (`git mv`, see MIGRATION.md step 1).

   These helpers therefore resolve either location: the root copy first, the
   pre-migration `public/` copy as a fallback. Every consumer — unit tests,
   the service contract check, the deployment check — keeps working before,
   during and after the move, so the migration does not have to be one
   all-or-nothing commit.

   Once the move has landed and CI is green, the fallback can be deleted. */
const LOCATIONS={
  index:["../index.html","../public/index.html"],
  business:["../business-licensing.html","../public/business-licensing.html"]
};

async function readFirst(candidates){
  const failures=[];
  for(const candidate of candidates){
    try{
      const url=new URL(candidate,import.meta.url);
      return {html:await readFile(url,"utf8"),path:candidate};
    }catch(error){
      if(error.code!=="ENOENT") throw error;
      failures.push(candidate);
    }
  }
  throw new Error("no entry HTML found; looked in "+failures.join(", "));
}

async function readConfiguredPage(candidates){
  const {html,path}=await readFirst(candidates);
  const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if(!script) throw new Error(path+" has no inline script");
  const configStart=script.indexOf("const CFG =");
  const end=script.indexOf("/* ==================================================================\n   No further edits");
  if(configStart<0||end<0) throw new Error(path+" has no readable CFG block");
  const CFG=vm.runInNewContext(script.slice(configStart,end)+"\n;CFG;");
  return {html,CFG,path};
}

export const readApp=()=>readConfiguredPage(LOCATIONS.index);
export const readBusinessApp=()=>readConfiguredPage(LOCATIONS.business);

/* The built artifact, for checks that must assert what actually deploys
   rather than what is in source. Returns null before the first build. */
export async function readBuiltPage(name){
  try{
    const url=new URL("../dist/"+name,import.meta.url);
    return await readFile(url,"utf8");
  }catch(error){
    if(error.code==="ENOENT") return null;
    throw error;
  }
}
