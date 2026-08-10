import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const address={FullAdd:"3300 E SANTA ROSA AVE",ParcelID:"16264570030000",City:"MILLCREEK",ZipCode:"84109",UnitType:null,UnitID:null};
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
      const attributes=state.addressWithoutParcelId?{...address,ParcelID:null}:address;
      return json({features:[{attributes}]});
    }
    if(path.includes("/Millcreek_Parcels/"))return json({features:[{attributes:{
      parcel_id:address.ParcelID,prop_location:address.FullAdd
    },geometry}]});
    if(path.includes("/Short_Term_Rentals_June_2026/FeatureServer/0/")){
      if(state.malformedActiveResponse)return json({});
      return json({features:state.active?[{attributes:{parcel_id:address.ParcelID}}]:[]});
    }
    if(path.includes("/Short_Term_Rentals_June_2026/FeatureServer/1/")){
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

test("address suggestions without parcel IDs are discarded",async({page})=>{
  await page.unrouteAll({behavior:"wait"});
  await mockArcGIS(page,{addressWithoutParcelId:true});
  await page.reload();
  await page.locator("#q").fill("3300 East Santa Rosa Avenue");
  await expect(page.locator("#sugg")).toBeHidden();
  await expect(page.locator("#status")).toContainText("No addresses match");
});
