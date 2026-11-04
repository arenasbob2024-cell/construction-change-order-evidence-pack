import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(here, "..");
const artifacts = path.join(here, "artifacts");
const base = "http://127.0.0.1:4173";
const data = JSON.parse(fs.readFileSync(path.join(here, "testdata.json"), "utf8"));
const chrome = path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1187/chrome-mac/Chromium.app/Contents/MacOS/Chromium");

const failures = [];
const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail: String(detail || "") });
  if (!ok) failures.push(name + (detail ? ": " + detail : ""));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForServer() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const response = await fetch(base + "/");
      if (response.ok) return;
    } catch (error) { /* retry */ }
    await sleep(100);
  }
  throw new Error("Local server did not start");
}

async function waitForDownloads(list, count, timeout = 20000) {
  const start = Date.now();
  while (list.length < count && Date.now() - start < timeout) await sleep(100);
  return list.length >= count;
}

function tamperCopy(source, target) {
  const raw = Buffer.from(fs.readFileSync(source));
  const index = Math.floor(raw.length / 2);
  raw[index] ^= 0x01;
  fs.writeFileSync(target, raw);
}

function fillCommon(page, record) {
  return (async () => {
    await page.fill("#project", record.project);
    await page.fill("#coNumber", record.coNumber);
    await page.fill("#changeDate", record.changeDate);
    await page.fill("#contractor", record.contractor);
    await page.fill("#client", record.client);
    await page.fill("#description", record.description);
    await page.fill("#reason", record.reason);
    await page.fill("#amount", String(record.amount));
    await page.selectOption("#currency", record.currency);
    await page.fill("#scheduleDays", String(record.scheduleDays));
    await page.fill("#notes", record.notes);
  })();
}

const server = spawn("python3", ["-m", "http.server", "4173", "--bind", "127.0.0.1"], {
  cwd: siteRoot,
  stdio: "ignore"
});

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });

  /* ---------------- desktop main flow ---------------- */
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const requests = [];
  const consoleErrors = [];
  page.on("request", (request) => requests.push({
    url: request.url(),
    method: request.method(),
    type: request.resourceType()
  }));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => consoleErrors.push("pageerror: " + error.message));

  await page.goto(base + "/", { waitUntil: "networkidle" });
  check("title", (await page.title()).includes("Construction Change Order Evidence Pack"));
  check("h1", (await page.textContent("h1")).includes("evidence pack"));
  check("exact disclaimer on page", await page.locator("text=This tool organizes records and computes file checksums in your browser.").first().isVisible());
  check("no email field", await page.locator("input[type=email], input[type=tel]").count() === 0);
  check("no form action", await page.locator("form[action]").count() === 0);

  await page.click("#generateBtn");
  await page.waitForTimeout(250);
  check("empty submit blocks", await page.locator("#project-error").isVisible());
  check("empty submit no download", (await page.locator("#resultPanel").getAttribute("hidden")) !== null);

  await fillCommon(page, data);
  await page.setInputFiles("#photoInput", [
    path.join(artifacts, "photo_gps.jpg"),
    path.join(artifacts, "photo_plain.jpg")
  ]);
  await page.waitForFunction(() => document.querySelectorAll(".photo-item").length === 2, null, { timeout: 45000 });
  const photoMeta = await page.locator(".photo-meta").allTextContents();
  check("photo 1 re-encoded", photoMeta[0].includes("3000×2000 → 1600×1067"), photoMeta[0]);
  check("photo 2 re-encoded", photoMeta[1].includes("1600×1200 → 1600×1200"), photoMeta[1]);
  const captionInputs = page.locator(".photo-body input");
  await captionInputs.nth(0).fill(data.photos[0].caption);
  await captionInputs.nth(1).fill(data.photos[1].caption);

  const downloads = [];
  page.on("download", async (download) => {
    const target = path.join(artifacts, "e2e_" + download.suggestedFilename());
    await download.saveAs(target);
    downloads.push(target);
  });

  await page.click("#generateBtn");
  await page.waitForSelector("#resultPanel:not([hidden])", { timeout: 45000 });
  check("two downloads", await waitForDownloads(downloads, 2), String(downloads.length));
  const pdfPath = downloads.find((file) => file.endsWith(".pdf"));
  const manifestPath = downloads.find((file) => file.endsWith(".txt"));
  check("pdf downloaded", Boolean(pdfPath), String(pdfPath));
  check("manifest downloaded", Boolean(manifestPath), String(manifestPath));

  const shownHash = (await page.textContent("#resultHash")).trim();
  const manifestText = fs.readFileSync(manifestPath, "utf8");
  const manifestHash = (manifestText.match(/sha256:\s*([a-f0-9]{64})/) || [])[1];
  const independentHash = crypto.createHash("sha256").update(fs.readFileSync(pdfPath)).digest("hex");
  check("result hash matches manifest", shownHash === manifestHash, shownHash + " vs " + manifestHash);
  check("manifest matches independent hash", manifestHash === independentHash, manifestHash + " vs " + independentHash);
  check("manifest does not claim trusted time", manifestText.includes("not a trusted timestamp"));
  check("manifest lists byte size", manifestText.includes("bytes:  " + fs.statSync(pdfPath).size));

  await page.fill("#expectedHash", independentHash);
  await page.setInputFiles("#verifyFile", pdfPath);
  await page.click("#verifyBtn");
  await page.waitForSelector("#verifyResult.match", { timeout: 20000 });
  check("verify widget matches", (await page.textContent("#verifyResult")).includes("MATCH"));

  const tampered = path.join(artifacts, "e2e_tampered.pdf");
  tamperCopy(pdfPath, tampered);
  await page.setInputFiles("#verifyFile", tampered);
  await page.click("#verifyBtn");
  await page.waitForSelector("#verifyResult.mismatch", { timeout: 20000 });
  check("verify widget detects change", (await page.textContent("#verifyResult")).includes("DOES NOT MATCH"));

  const external = requests.filter((request) => !request.url.startsWith(base) && !request.url.startsWith("data:") && !request.url.startsWith("blob:"));
  const writes = requests.filter((request) => !["GET", "HEAD", "OPTIONS"].includes(request.method()));
  check("no third-party requests", external.length === 0, JSON.stringify(external.slice(0, 4)));
  check("no write requests", writes.length === 0, JSON.stringify(writes.slice(0, 4)));
  check("no console errors", consoleErrors.length === 0, JSON.stringify(consoleErrors.slice(0, 4)));

  await page.screenshot({ path: path.join(artifacts, "e2e_desktop.png"), fullPage: true });

  // Remove / clear behaviour.
  await page.locator(".photo-remove").first().click();
  check("remove photo", await page.locator(".photo-item").count() === 1);
  page.once("dialog", (dialog) => dialog.accept());
  await page.click("#clearBtn");
  await page.waitForTimeout(200);
  check("clear resets fields", await page.inputValue("#project") === "");
  check("clear removes photos", await page.locator(".photo-item").count() === 0);
  check("clear hides result", (await page.locator("#resultPanel").getAttribute("hidden")) !== null);

  // Refresh clears non-persisted form state.
  await page.fill("#project", "Refresh test project");
  await page.reload({ waitUntil: "networkidle" });
  check("refresh clears form", await page.inputValue("#project") === "");
  await context.close();

  /* ---------------- long text + four photos ---------------- */
  const longContext = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const longPage = await longContext.newPage();
  const longDownloads = [];
  longPage.on("download", async (download) => {
    const target = path.join(artifacts, "long_" + download.suggestedFilename());
    await download.saveAs(target);
    longDownloads.push(target);
  });
  await longPage.goto(base + "/", { waitUntil: "networkidle" });
  await longPage.fill("#project", "Long Text Test Project");
  await longPage.fill("#coNumber", "CO-LONG-001");
  await longPage.fill("#changeDate", "2026-11-04");
  await longPage.fill("#description", "Long description sentence with site detail. ".repeat(75).slice(0, 3600));
  await longPage.fill("#reason", "Reason text for the long-content pagination test.");
  await longPage.fill("#amount", "-425.50");
  await longPage.fill("#scheduleDays", "-2");
  await longPage.setInputFiles("#photoInput", [
    path.join(artifacts, "photo_gps.jpg"),
    path.join(artifacts, "photo_plain.jpg"),
    path.join(artifacts, "photo_vertical.png"),
    path.join(artifacts, "photo_gps.jpg")
  ]);
  await longPage.waitForFunction(() => document.querySelectorAll(".photo-item").length === 4, null, { timeout: 60000 });
  await longPage.click("#generateBtn");
  await longPage.waitForSelector("#resultPanel:not([hidden])", { timeout: 60000 });
  check("long test two downloads", await waitForDownloads(longDownloads, 2, 30000), String(longDownloads.length));
  const longPdf = longDownloads.find((file) => file.endsWith(".pdf"));
  const longManifest = longDownloads.find((file) => file.endsWith(".txt"));
  await longPage.screenshot({ path: path.join(artifacts, "e2e_long.png"), fullPage: true });
  await longContext.close();

  /* ---------------- mobile flow ---------------- */
  const mobileContext = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true
  });
  const mobile = await mobileContext.newPage();
  const mobileDownloads = [];
  const mobileRequests = [];
  mobile.on("request", (request) => mobileRequests.push(request.url()));
  mobile.on("download", async (download) => {
    const target = path.join(artifacts, "mobile_" + download.suggestedFilename());
    await download.saveAs(target);
    mobileDownloads.push(target);
  });
  await mobile.goto(base + "/", { waitUntil: "networkidle" });
  const widthInfo = await mobile.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth
  }));
  check("mobile no horizontal overflow", widthInfo.scroll <= widthInfo.inner + 1, JSON.stringify(widthInfo));
  check("mobile generate button visible", await mobile.locator("#generateBtn").isVisible());
  await mobile.fill("#project", "Mobile Test Project");
  await mobile.fill("#coNumber", "CO-MOB-001");
  await mobile.fill("#changeDate", "2026-11-04");
  await mobile.fill("#description", "Mobile viewport test description for a small change order.");
  await mobile.fill("#reason", "Mobile layout validation.");
  await mobile.setInputFiles("#photoInput", [path.join(artifacts, "photo_plain.jpg")]);
  await mobile.waitForFunction(() => document.querySelectorAll(".photo-item").length === 1, null, { timeout: 45000 });
  await mobile.click("#generateBtn");
  await mobile.waitForSelector("#resultPanel:not([hidden])", { timeout: 45000 });
  check("mobile two downloads", await waitForDownloads(mobileDownloads, 2, 30000), String(mobileDownloads.length));
  const mobileExternal = mobileRequests.filter((url) => !url.startsWith(base) && !url.startsWith("data:") && !url.startsWith("blob:"));
  check("mobile no third-party requests", mobileExternal.length === 0, JSON.stringify(mobileExternal.slice(0, 4)));
  await mobile.screenshot({ path: path.join(artifacts, "e2e_mobile.png"), fullPage: true });
  await mobileContext.close();

  const report = {
    checks,
    failures,
    files: {
      pdf: pdfPath,
      manifest: manifestPath,
      longPdf,
      longManifest,
      mobile: mobileDownloads,
      screenshots: ["e2e_desktop.png", "e2e_long.png", "e2e_mobile.png"].map((name) => path.join(artifacts, name))
    },
    request_count: requests.length,
    requests: requests.slice(0, 20)
  };
  fs.writeFileSync(path.join(artifacts, "e2e_report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ failures, checks: checks.length, files: report.files, request_count: requests.length }, null, 2));
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
}
process.exit(failures.length ? 1 : 0);
