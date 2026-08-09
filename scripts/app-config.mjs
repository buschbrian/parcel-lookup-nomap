import { readFile } from "node:fs/promises";
import vm from "node:vm";

export async function readApp(){
  const html=await readFile(new URL("../index.html",import.meta.url),"utf8");
  const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if(!script) throw new Error("index.html has no inline script");
  const start=script.indexOf("const CFG =");
  const end=script.indexOf("/* ==================================================================\n   No further edits");
  const CFG=vm.runInNewContext(script.slice(start,end)+"\n;CFG;");
  return {html,CFG};
}

