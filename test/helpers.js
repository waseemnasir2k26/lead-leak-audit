import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { extractPage } from "../src/extract.js";
import { CHAT_VENDORS } from "../src/rules.js";
import { buildInventory } from "../src/inventory.js";

export const here = path.dirname(fileURLToPath(import.meta.url));
export const chatSelectors = Object.fromEntries(
  CHAT_VENDORS.map((v) => [v.vendor, v.dom]),
);

/** Load a fixture file into a mobile-sized page (all network stubbed) and return its inventory. */
export async function inventoryFromFixture(browser, name) {
  const html = fs.readFileSync(path.join(here, "fixtures", name), "utf8");
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  const page = await ctx.newPage();
  await page.route("**/*", (r) => {
    const u = r.request().url();
    if (u === "http://fixture.test/page")
      return r.fulfill({ contentType: "text/html", body: html });
    return r.fulfill({ status: 200, contentType: "text/javascript", body: "" });
  });
  await page.goto("http://fixture.test/page", { waitUntil: "load" });
  const extract = await page.evaluate(extractPage, { chatSelectors });
  await ctx.close();
  return {
    extract,
    inventory: buildInventory([
      {
        url: "http://fixture.test/page",
        status: 200,
        extract,
        consoleMessages: [],
        failedRequests: [],
      },
    ]),
  };
}

export async function launch() {
  return chromium.launch({ headless: true });
}
