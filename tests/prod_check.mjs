import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifacts = path.join(here, "artifacts");
const data = JSON.parse(fs.readFileSync(path.join(here, "testdata.json"), "utf8"));
const base = (process.argv[2] || "https://construction-change-order-evidence.vercel.app/").replace(/\/?$/, "/");
const origin = new URL(base).origin;
const chrome = path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1187/chrome-mac/Chromium.app/Contents/MacOS/Chromium");

const failures = [];
const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail: String(detail || "") });
  if (!ok) failures.push(name + (detail ? ": " + detail : ""));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForDownloads(list, count, timeout = 30000) {
  const start = Date.now();
  while (list.length < count && Date.now() - start < timeout) await sleep(100);
  return list.length >= count;
}
function tamperCopy(source, target) {
  const raw = Buffer.from(fs.readFileSync(source));
  raw[Math.floor(raw.length / 2)] ^= 0x01;
  fs.writeFileSync(target, raw);
}

/* ---------------- static HTTP checks ---------------- */
const pages = [
  { path: "", title: "Construction Change Order Evidence Pack", canonical: origin + "/" },
  { path: "privacy", title: "Privacy", canonical: origin + "/privacy" },
  { path: "about", title: "About", canonical: origin + "/about" }
];
const httpResults = [];
for (const page of pages) {
  const url = base + page.path;
  const response = await fetch(url, { redirect: "manual" });
  const html = await response.text();
  httpResults.push({ url, status: response.status, bytes: html.length });
  check("status 200 " + (page.path || "/"), response.status === 200, String(response.status));
  check("canonical " + (page.path || "/"), html.includes('rel="canonical" href="' + page.canonical + '"'));
  check("title " + (page.path || "/"), html.includes("<title>" + page.title));
  check("exact disclaimer " + (page.path || "/"), html.includes("This tool organizes records and computes file checksums in your browser. It does not prove what happened, when a photo was taken, who signed it, or legal admissibility. No trusted timestamp or legal certification is provided."));
  check("no banned phrase " + (page.path || "/"), !/(tamper-proof|court-ready|legally binding)/i.test(html));
}
const rootHeaders = await fetch(base);
check("CSP header", (rootHeaders.headers.get("content-security-policy") || "").includes("connect-src 'none'"), rootHeaders.headers.get("content-security-policy") || "");
check("X-Content-Type-Options", rootHeaders.headers.get("x-content-type-options") === "nosniff");
check("Referrer-Policy", rootHeaders.headers.get("referrer-policy") === "no-referrer");
const robots = await (await fetch(base + "robots.txt")).text();
check("robots allows all", /User-agent:\s*\*/i.test(robots) && /Allow:\s*\//i.test(robots));
check("robots sitemap", robots.includes(origin + "/sitemap.xml"));
const sitemap = await (await fetch(base + "sitemap.xml")).text();
check("sitemap has 3 urls", (sitemap.match(/<url>/g) || []).length === 3, String((sitemap.match(/<url>/g) || []).length));
check("sitemap clean URLs", sitemap.includes(origin + "/privacy") && sitemap.includes(origin + "/about"));

/* ---------------- browser flow ---------------- */
let browser;
try {
  browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const requests = [];
  const consoleErrors = [];
  page.on("request", (request) => requests.push({ url: request.url(), method: request.method(), type: request.resourceType() }));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push("pageerror: " + error.message));

  await page.goto(base, { waitUntil: "networkidle" });
  check("live title", (await page.title()).includes("Construction Change Order Evidence Pack"));
  check("live h1", (await page.textContent("h1")).includes("evidence pack"));
  check("no email or phone field", (await page.locator("input[type=email], input[type=tel]").count()) === 0);
  check("no form action", (await page.locator("form[action]").count()) === 0);
  check("no payment request", (await page.locator("[name*=card], [name*=payment], [autocomplete=cc-number]").count()) === 0);

  // Cancel path: non-Latin text triggers the confirm; dismissing it must not download.
  const downloads = [];
  page.on("download", async (download) => {
    const target = path.join(artifacts, "prod_" + download.suggestedFilename());
    await download.saveAs(target);
    downloads.push(target);
  });
  await page.fill("#project", "测试项目");
  await page.fill("#coNumber", "CO-CANCEL-001");
  await page.fill("#changeDate", "2026-11-04");
  await page.fill("#description", "Cancel-path test description.");
  await page.fill("#reason", "Cancel-path test reason.");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.click("#generateBtn");
  await page.waitForTimeout(500);
  check("cancel leaves no download", downloads.length === 0, String(downloads.length));
  check("cancel status shown", (await page.textContent("#formStatus")).includes("Export cancelled"));
  check("cancel keeps result hidden", (await page.locator("#resultPanel").getAttribute("hidden")) !== null);

  // Clear-cancel must keep the data.
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.click("#clearBtn");
  await page.waitForTimeout(200);
  check("clear cancel keeps field", (await page.inputValue("#project")) === "测试项目");

  // Full export.
  await page.fill("#project", data.project);
  await page.fill("#coNumber", data.coNumber);
  await page.fill("#changeDate", data.changeDate);
  await page.fill("#contractor", data.contractor);
  await page.fill("#client", data.client);
  await page.fill("#description", data.description);
  await page.fill("#reason", data.reason);
  await page.fill("#amount", String(data.amount));
  await page.selectOption("#currency", data.currency);
  await page.fill("#scheduleDays", String(data.scheduleDays));
  await page.fill("#notes", data.notes);
  await page.setInputFiles("#photoInput", [path.join(artifacts, "photo_gps.jpg"), path.join(artifacts, "photo_plain.jpg")]);
  await page.waitForFunction(() => document.querySelectorAll(".photo-item").length === 2, null, { timeout: 45000 });
  await page.locator(".photo-body input").nth(0).fill(data.photos[0].caption);
  await page.locator(".photo-body input").nth(1).fill(data.photos[1].caption);

  await page.click("#generateBtn");
  await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 60000 });
  check("production two downloads", await waitForDownloads(downloads, 2), String(downloads.length));
  const pdfPath = downloads.find((file) => file.endsWith(".pdf"));
  const manifestPath = downloads.find((file) => file.endsWith(".txt"));
  check("production PDF downloaded", Boolean(pdfPath), String(pdfPath));
  check("production manifest downloaded", Boolean(manifestPath), String(manifestPath));

  const shownHash = (await page.textContent("#resultHash")).trim();
  const manifestText = fs.readFileSync(manifestPath, "utf8");
  const manifestHash = (manifestText.match(/sha256:\s*([a-f0-9]{64})/) || [])[1];
  const independentHash = crypto.createHash("sha256").update(fs.readFileSync(pdfPath)).digest("hex");
  check("production hash matches manifest", shownHash === manifestHash, shownHash + " vs " + manifestHash);
  check("production manifest matches independent hash", manifestHash === independentHash, manifestHash + " vs " + independentHash);
  check("manifest says no trusted timestamp", manifestText.includes("not a trusted timestamp"));
  check("manifest byte size", manifestText.includes("bytes:  " + fs.statSync(pdfPath).size));
  check("manifest only hashes PDF", manifestText.includes("does not include a hash of itself"));

  await page.fill("#expectedHash", independentHash);
  await page.setInputFiles("#verifyFile", pdfPath);
  await page.click("#verifyBtn");
  await page.waitForSelector("#verifyResult.match", { timeout: 20000 });
  check("production verify match", (await page.textContent("#verifyResult")).includes("MATCH"));

  const tampered = path.join(artifacts, "prod_tampered.pdf");
  tamperCopy(pdfPath, tampered);
  await page.setInputFiles("#verifyFile", tampered);
  await page.click("#verifyBtn");
  await page.waitForSelector("#verifyResult.mismatch", { timeout: 20000 });
  check("production verify detects change", (await page.textContent("#verifyResult")).includes("DOES NOT MATCH"));

  const external = requests.filter((request) => !request.url.startsWith(origin) && !request.url.startsWith("data:") && !request.url.startsWith("blob:"));
  const writes = requests.filter((request) => !["GET", "HEAD", "OPTIONS"].includes(request.method));
  check("production no third-party requests", external.length === 0, JSON.stringify(external.slice(0, 4)));
  check("production no write requests", writes.length === 0, JSON.stringify(writes.slice(0, 4)));
  check("production no console errors", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 4)));
  await page.screenshot({ path: path.join(artifacts, "prod_desktop.png"), fullPage: true });
  await context.close();

  // Mobile viewport export.
  const mobileContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const mobile = await mobileContext.newPage();
  const mobileDownloads = [];
  const mobileRequests = [];
  mobile.on("request", (request) => mobileRequests.push(request.url()));
  mobile.on("download", async (download) => {
    const target = path.join(artifacts, "prod_mobile_" + download.suggestedFilename());
    await download.saveAs(target);
    mobileDownloads.push(target);
  });
  await mobile.goto(base, { waitUntil: "networkidle" });
  const widthInfo = await mobile.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  check("production mobile no horizontal overflow", widthInfo.scroll <= widthInfo.inner + 1, JSON.stringify(widthInfo));
  await mobile.fill("#project", "Mobile Production Test");
  await mobile.fill("#coNumber", "CO-MOB-PROD-001");
  await mobile.fill("#changeDate", "2026-11-04");
  await mobile.fill("#description", "Mobile production export description.");
  await mobile.fill("#reason", "Mobile production export reason.");
  await mobile.setInputFiles("#photoInput", [path.join(artifacts, "photo_plain.jpg")]);
  await mobile.waitForFunction(() => document.querySelectorAll(".photo-item").length === 1, null, { timeout: 45000 });
  await mobile.click("#generateBtn");
  await mobile.waitForSelector("#resultPanel:not([hidden])", { timeout: 60000 });
  check("production mobile two downloads", await waitForDownloads(mobileDownloads, 2), String(mobileDownloads.length));
  const mobileExternal = mobileRequests.filter((url) => !url.startsWith(origin) && !url.startsWith("data:") && !url.startsWith("blob:"));
  check("production mobile no third-party requests", mobileExternal.length === 0, JSON.stringify(mobileExternal.slice(0, 4)));
  await mobile.screenshot({ path: path.join(artifacts, "prod_mobile.png"), fullPage: true });
  await mobileContext.close();

  const report = {
    base,
    http: httpResults,
    checks,
    failures,
    files: { pdf: pdfPath, manifest: manifestPath, mobile: mobileDownloads, screenshots: ["prod_desktop.png", "prod_mobile.png"].map((name) => path.join(artifacts, name)) },
    request_count: requests.length,
    requests: requests.slice(0, 24)
  };
  fs.writeFileSync(path.join(artifacts, "prod_report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ failures, checks: checks.length, http: httpResults, files: report.files, request_count: requests.length }, null, 2));
} finally {
  if (browser) await browser.close();
}
process.exit(failures.length ? 1 : 0);
