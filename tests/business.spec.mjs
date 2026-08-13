import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const address={FullAdd:"3300 E SANTA ROSA AVE",ParcelID:"16264570030000",City:"MILLCREEK",ZipCode:"84109",UnitType:null,UnitID:null};
const otherAddress={FullAdd:"1234 E ELM ST",ParcelID:"16264570049999",City:"MILLCREEK",ZipCode:"84109",UnitType:null,UnitID:null};
const geometry={rings:[[
  [-111.816,40.698],[-111.814,40.698],[-111.814,40.700],
  [-111.816,40.700],[-111.816,40.698]
]],spatialReference:{wkid:4326}};

async function mockArcGIS(page,state={}){
  await page.route("**/arcgis/rest/services/**",async route=>{
    const url=new URL(route.request().url()),path=url.pathname;
    const json=body=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(body)});
    if(!path.endsWith("/query"))return json({fields:[]});
    if(path.includes("/Address_Points/")){
      // exceededTransferLimit is how ArcGIS reports that it capped the result set.
      if(state.addressOverflow) return json({
        features:Array.from({length:10},(unused,index)=>({attributes:{...address,
          FullAdd:"33"+index+"0 E SANTA ROSA AVE",
          ParcelID:"1626457003000"+index}})),
        exceededTransferLimit:true
      });
      const where=url.searchParams.get("where")||"";
      // Two distinct streets, so a lookup of the wrong parcel is visible in the heading.
      if(state.twoAddresses)
        return json({features:[{attributes:where.includes("ELM")?otherAddress:address}]});
      const attributes=state.addressWithoutParcelId?{...address,ParcelID:null}:address;
      return json({features:[{attributes}]});
    }
    if(path.includes("/Millcreek_Parcels/")){
      if(state.delayParcel)await new Promise(resolve=>setTimeout(resolve,state.delayParcel));
      const where=url.searchParams.get("where")||"";
      const known=[address,otherAddress].find(one=>where.includes(one.ParcelID))||address;
      return json({features:[{attributes:{
        parcel_id:known.ParcelID,prop_location:known.FullAdd
      },geometry}]});
    }
    if(path.includes("/Short_Term_Rentals_June_2026/FeatureServer/0/")){
      if(state.countRental)state.countRental();
      if(state.rentalStatus)return route.fulfill({status:state.rentalStatus,body:"rejected"});
      if(state.malformedActiveResponse)return json({});
      return json({features:state.active?[{attributes:{parcel_id:address.ParcelID}}]:[]});
    }
    if(path.includes("/Short_Term_Rentals_June_2026/FeatureServer/1/")){
      if(state.countBuffer)state.countBuffer();
      if(state.bufferFailure)return route.fulfill({status:503,body:"temporary failure"});
      if(state.malformedBufferResponse)return json({});
      const features=(state.buffers??[{parcel_id:"99999999999999",BUFF_DIST:400}])
        .map(attributes=>({attributes}));
      return json({features});
    }
    return json({features:[]});
  });
}

async function loadByKeyboard(page){
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await expect(page.locator("#sugg")).toBeVisible();
  await page.locator("#q").press("ArrowDown");
  await page.locator("#q").press("Enter");
  await expect(page.locator("#results")).toBeVisible();
}

test.beforeEach(async({page})=>{
  await mockArcGIS(page);
  await page.goto("/business-licensing.html");
  await page.evaluate(()=>{CFG.request.retryDelayMs=1});
});

test("shows the official Millcreek identity and city homepage link",async({page})=>{
  await expect(page.locator(".brand-logo")).toHaveAttribute("alt","Millcreek city logo");
  expect(await page.locator(".brand-logo").evaluate(image=>image.complete&&image.naturalWidth>0)).toBe(true);
  await expect(page.getByRole("link",{name:"Millcreek city homepage"}))
    .toHaveAttribute("href","https://millcreekut.gov/");
});

test("licensing page has no detectable axe violations before or after lookup",async({page})=>{
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
  await loadByKeyboard(page);
  expect((await new AxeBuilder({page}).analyze()).violations).toEqual([]);
});

test("the focused result reports another rental buffer without unrelated property topics",async({page})=>{
  await loadByKeyboard(page);
  await expect(page.locator(".pair",{hasText:"Appears in the June 2026"})).toContainText("No");
  await expect(page.locator(".pair",{hasText:"Within 400 feet"})).toContainText("Yes");
  await expect(page.locator("#results-body")).toContainText("Business Licensing makes the official measurement");
  await expect(page.locator("#results-body")).not.toContainText("Zoning");
  await expect(page.locator("#results-body")).not.toContainText("FEMA");
  await page.locator("#copy").click();
  await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toContain("Screening result only");
});

test("a parcel's own buffer is excluded from the another-rental answer",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{active:true,buffers:[{parcel_id:address.ParcelID,BUFF_DIST:400}]});
  await page.reload();
  await loadByKeyboard(page);
  await expect(page.locator(".pair",{hasText:"Appears in the June 2026"})).toContainText("Yes");
  await expect(page.locator(".pair",{hasText:"Within 400 feet"})).toContainText("No");
});

test("a pointer click on a licensing address suggestion loads the screen",async({page})=>{
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await expect(page.locator("#sugg li")).toHaveCount(1);
  await page.locator("#sugg li").click();
  await expect(page.locator("#r-head")).toContainText("3300 E SANTA ROSA AVE");
});

test("a capped licensing address list is announced as partial",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{addressOverflow:true});
  await page.reload();
  await page.locator("#q").fill("Santa Rosa");
  await expect(page.locator("#sugg li")).toHaveCount(10);
  await expect(page.locator("#status")).toContainText("Showing the first 10 matches");
  await expect(page.locator("#status")).toContainText("narrow the list");
});

test("the licensing debounce delay honours its configuration",async({page})=>{
  await page.evaluate(()=>{CFG.request.suggestDebounceMs=60_000});
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await page.waitForTimeout(750);
  await expect(page.locator("#sugg")).toBeHidden();
  await expect(page.locator("#q")).toHaveAttribute("aria-expanded","false");
});

test("leaving the licensing combobox closes its suggestions",async({page})=>{
  await page.locator("#q").fill("3300 East");
  await expect(page.locator("#sugg")).toBeVisible();
  await page.locator("#q").press("Tab");
  await expect(page.locator("#sugg")).toBeHidden();
  await expect(page.locator("#q")).toHaveAttribute("aria-expanded","false");
});

test("a failed buffer source is Unknown and the page reflows at 320 pixels",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{bufferFailure:true});
  await page.setViewportSize({width:320,height:900});
  await page.reload();
  await page.evaluate(()=>{CFG.request.retryDelayMs=1});
  await loadByKeyboard(page);
  await expect(page.locator(".pair",{hasText:"Within 400 feet"})).toContainText("Unknown");
  await expect(page.locator("#status")).toContainText("unavailable data source");
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("a malformed rental response is Unknown rather than a rendering failure",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{malformedActiveResponse:true});
  await page.reload();
  await loadByKeyboard(page);
  await expect(page.locator(".pair",{hasText:"Appears in the June 2026"})).toContainText("Unknown");
  await expect(page.locator("#status")).toContainText("unavailable data source");
});

test("a malformed buffer response is Unknown rather than No",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{malformedBufferResponse:true});
  await page.reload();
  await loadByKeyboard(page);
  await expect(page.locator(".pair",{hasText:"Within 400 feet"})).toContainText("Unknown");
  await expect(page.locator("#status")).toContainText("unavailable data source");
});

/* The three tests below cover cancellation ownership. `chosen` and the sequence
   ticket must both be claimed by the input event itself, not by the debounced
   search that runs 250 ms later — otherwise an action taken inside that window
   either screens a stale parcel or is silently aborted by the late suggestion.
   The debounce delay is configuration so these windows are held open on purpose
   rather than depending on how fast the run happens to be. */

test("editing the address after picking one does not screen the previous parcel",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{twoAddresses:true});
  await page.reload();
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await expect(page.locator("#sugg li")).toHaveCount(1);
  await page.locator("#sugg li").first().click();
  await expect(page.locator("#r-head")).toContainText("3300 E SANTA ROSA AVE");

  // Hold the debounce open so the pending search cannot clear the stale selection.
  await page.evaluate(()=>{CFG.request.suggestDebounceMs=60_000});
  await page.locator("#q").fill("1234 East Elm Street");
  await page.locator("#lookup button[type=submit]").click();
  await expect(page.locator("#r-head")).toContainText("1234 E ELM ST");
  await expect(page.locator("#r-head")).not.toContainText("SANTA ROSA");
});

/* These two dispatch the input event and the superseding action inside one
   page.evaluate, so the ordering is fixed by JavaScript rather than by how long a
   Playwright click takes to become actionable. Driving them as separate actions
   lets the debounce fire first, which passes without exercising the race at all. */

/* Keyboard selection, not pointer selection. A pointer click is protected by
   accident: pick() empties the listbox, so the click reaches the document handler
   with a detached target, closest(".combo") returns null, and dismissSuggestions()
   clears the pending timer as a side effect. Choosing with Enter fires no click, so
   nothing clears it — the vulnerable path is the keyboard one this page exists for. */
test("a suggestion pending when an address is chosen by keyboard does not abort the lookup",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{delayParcel:1500});
  await page.reload();
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await expect(page.locator("#sugg li")).toHaveCount(1);
  await page.evaluate(()=>{
    CFG.request.suggestDebounceMs=50;
    const q=document.querySelector("#q");
    const key=name=>q.dispatchEvent(new KeyboardEvent("keydown",{key:name,bubbles:true,cancelable:true}));
    q.value=q.value+" ";
    q.dispatchEvent(new Event("input",{bubbles:true}));  // queues a suggestion at +50 ms
    key("ArrowDown");
    key("Enter");                                       // supersedes it right now
  });
  await expect(page.locator("#results")).toBeVisible({timeout:8000});
  await expect(page.locator("#status")).toContainText("Results ready");
  await expect(page.locator("#sugg")).toBeHidden();
});

test("a suggestion pending when the form is submitted does not abort the screen",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{delayParcel:1500});
  await page.reload();
  await page.evaluate(()=>{
    CFG.request.suggestDebounceMs=50;
    const q=document.querySelector("#q");
    q.value="3300 East Santa Rosa Avenue";
    q.dispatchEvent(new Event("input",{bubbles:true}));
    document.querySelector("#lookup").requestSubmit();
  });
  await expect(page.locator("#results")).toBeVisible({timeout:8000});
  await expect(page.locator("#status")).toContainText("Results ready");
});

// Cancellation has to actually cancel. Asserting only the error name is not enough:
// the name is derived from signal.aborted in the catch, so it reads AbortError even
// when the request was sent and answered. Count the round trip instead.
test("a request whose task was already superseded is never sent",async({page})=>{
  let requests=0;
  await page.route("**/superseded-probe**",route=>{
    requests++;
    return route.fulfill({status:200,contentType:"application/json",body:"{}"});
  });
  // Classified `kind`, matching index.html: the shared layer does not surface raw
  // DOMException names, because "AbortError" and "TypeError" need different words.
  const outcome=await page.evaluate(async()=>{
    const controller=new AbortController();
    controller.abort();
    try{ await fetchJson(new URL(location.origin+"/superseded-probe"),controller.signal); return "resolved"; }
    catch(error){ return error.kind; }
  });
  expect(outcome).toBe("aborted");
  expect(requests).toBe(0);
});

/* Retry policy. Retrying a rejected query cannot change its answer: it doubles the
   worst-case wait to two full timeouts and adds load to a service that may already
   be refusing work. Only network, rate-limit, server and timeout failures are worth
   a second attempt. */
test("a permanent service error is reported without a retry",async({page})=>{
  let requests=0;
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{rentalStatus:400,countRental:()=>{requests++}});
  await page.reload();
  await page.evaluate(()=>{CFG.request.retryDelayMs=1});
  await loadByKeyboard(page);
  await expect(page.locator(".pair",{hasText:"Appears in the June 2026"})).toContainText("Unknown");
  expect(requests).toBe(1);
});

test("a transient service error is retried once",async({page})=>{
  let requests=0;
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{bufferFailure:true,countBuffer:()=>{requests++}});
  await page.reload();
  await page.evaluate(()=>{CFG.request.retryDelayMs=1});
  await loadByKeyboard(page);
  await expect(page.locator(".pair",{hasText:"Within 400 feet"})).toContainText("Unknown");
  expect(requests).toBe(2);
});

// A status glyph inside the same text node is spoken: "black circle Yes". axe cannot
// see this, so it needs its own assertion.
test("status glyphs are hidden from assistive technology",async({page})=>{
  await loadByKeyboard(page);
  const flags=page.locator("#results-body .flag");
  await expect(flags).not.toHaveCount(0);
  for(const glyph of await page.locator("#results-body .flag .g").all())
    await expect(glyph).toHaveAttribute("aria-hidden","true");
  await expect(page.locator(".pair",{hasText:"Appears in the June 2026"})).toContainText("No");
  expect(await page.locator("#results-body .flag .g").count())
    .toBe(await flags.count());
});

test("address suggestions without parcel IDs are discarded",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{addressWithoutParcelId:true});
  await page.reload();
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await expect(page.locator("#sugg")).toBeHidden();
  await expect(page.locator("#status")).toContainText("No addresses match");
});

/* ---------------------------------------------------------------------------
   Reflow-under-zoom and focus-visibility regressions, matching app.spec.mjs.
   The existing 320px assertion above covers 1.4.10 at default text size; these
   add the enlarged-text case (1.4.4) and the programmatic focus indicator
   (2.4.7), neither of which axe can detect.
   --------------------------------------------------------------------------- */

for(const scale of [200,400]){
  test(`licensing page reflows at 320px with text scaled to ${scale}%`,async({page})=>{
    await page.setViewportSize({width:320,height:900});
    await loadByKeyboard(page);
    await page.evaluate(pct=>{
      document.documentElement.style.fontSize=(16*pct/100)+"px";
    },scale);
    await page.waitForTimeout(150);
    const doc=await page.evaluate(()=>
      document.documentElement.scrollWidth-document.documentElement.clientWidth);
    expect(doc).toBeLessThanOrEqual(1);
  });
}

test("licensing page allows long unbreakable tokens to break",async({page})=>{
  await loadByKeyboard(page);
  const wrap=await page.evaluate(()=>({
    body:getComputedStyle(document.body).overflowWrap,
    dd:getComputedStyle(document.querySelector("#results-body dd")).overflowWrap
  }));
  expect(wrap.body).toBe("break-word");
  expect(wrap.dd).toBe("anywhere");
});

test("licensing programmatic focus targets declare a visible focus outline",async({page})=>{
  await loadByKeyboard(page);
  expect(await page.evaluate(()=>document.activeElement.id)).toBe("r-head");
  const declared=await page.evaluate(()=>
    [...document.styleSheets]
      .flatMap(sheet=>{try{return [...sheet.cssRules]}catch{return []}})
      .filter(rule=>rule.selectorText&&/#(main|r-head):focus\b/.test(rule.selectorText))
      .map(rule=>({selector:rule.selectorText,
        outline:rule.style.outline||rule.style.outlineWidth||""})));
  const targets=declared.map(rule=>rule.selector).join(" ");
  expect(targets).toContain("#r-head:focus");
  expect(targets).toContain("#main:focus");
  for(const rule of declared){
    expect(rule.outline).not.toBe("");
    expect(rule.outline).not.toMatch(/\bnone\b/);
  }
});

test("licensing status region announces atomically",async({page})=>{
  await expect(page.locator("#status")).toHaveAttribute("aria-atomic","true");
  await expect(page.locator("#status")).toHaveAttribute("aria-live","polite");
  await expect(page.locator("#status")).toHaveAttribute("role","status");
});

// The header logo is sized in rem, so at 400% text it grew to 288px — past a
// 320px viewport before any text — and flex:0 0 auto forbids shrinking. It
// carries no information, so the px cap is correct rather than a workaround, and
// is easy to mistake for cosmetic and delete. The caps are what satisfy 1.4.4
// here; the flex-wrap assertion guards layout quality, not conformance.
test("the licensing brand logo does not scale with text past the viewport",
  async({page})=>{
    await page.setViewportSize({width:320,height:900});
    await page.evaluate(()=>{document.documentElement.style.fontSize="64px"});
    const header=await page.evaluate(()=>({
      wrap:getComputedStyle(document.querySelector(".brand-lockup")).flexWrap,
      logo:document.querySelector(".brand-logo").getBoundingClientRect().width
    }));
    expect(header.wrap).toBe("wrap");
    expect(header.logo).toBeLessThanOrEqual(88);
  });
