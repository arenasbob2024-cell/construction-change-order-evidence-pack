import { chromium } from "playwright-core";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const bundled = path.join(os.homedir(), "Library/Caches/ms-playwright/chromium-1187/chrome-mac/Chromium.app/Contents/MacOS/Chromium");
const executablePath = fs.existsSync(bundled) ? bundled : undefined;
console.log("executable:", executablePath || "playwright default");
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.goto("data:text/html,<title>ok</title><h1>hello</h1>");
console.log("title:", await page.title(), "h1:", await page.textContent("h1"));
await browser.close();
