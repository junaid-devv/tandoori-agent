import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const outputDir = path.join(root, "output", "playwright");
const demoPath = path.join(root, "scratch", "restaurant-demo.html");

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  recordVideo: {
    dir: outputDir,
    size: { width: 1440, height: 900 },
  },
});

const page = await context.newPage();
await page.goto(`file://${demoPath.replaceAll("\\", "/")}`, { waitUntil: "load" });
await page.waitForFunction(() => document.body.dataset.ready === "true");

await page.waitForTimeout(1800);
await page.evaluate(() => window.demoSetView("chat"));
await page.waitForTimeout(6100);
await page.evaluate(() => window.demoSetView("queue"));
await page.waitForTimeout(3600);
await page.evaluate(() => window.demoSetView("menu"));
await page.waitForTimeout(4200);
await page.evaluate(() => window.demoSetView("overview"));
await page.waitForTimeout(1800);

await page.screenshot({ path: path.join(outputDir, "restaurant-demo-cover.png"), fullPage: false });
const video = page.video();
await context.close();
await browser.close();

const videoPath = await video?.path();
if (!videoPath) {
  throw new Error("Playwright did not produce a video file.");
}

console.log(videoPath);
