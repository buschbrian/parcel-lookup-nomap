import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function readConfiguredPage(file){
  const html=await readFile(new URL(file,import.meta.url),"utf8");
  const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if(!script) throw new Error(file+" has no inline script");
  const start=script.indexOf("const CFG =");
  const compactStart=script.indexOf("const CFG={");
  const configStart=start>=0?start:compactStart;
  const end=script.indexOf("/* ==================================================================\n   No further edits");
  if(configStart<0||end<0) throw new Error(file+" has no readable CFG block");
  const CFG=vm.runInNewContext(script.slice(configStart,end)+"\n;CFG;");
  return {html,CFG};
}

export const readApp=()=>readConfiguredPage("../index.html");
export const readBusinessApp=()=>readConfiguredPage("../business-licensing.html");
