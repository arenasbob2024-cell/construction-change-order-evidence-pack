import { buildEvidencePdf, buildManifest, findUnsupportedCharacters } from "./pdf.mjs";

const MAX_PHOTOS = 12;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.85;
const STATS_KEY = "coep_local_stats_v1";

const state = {
  photos: [],
  lastExport: null,
  dirty: false,
  busy: false
};

const $ = (id) => document.getElementById(id);
const form = $("packForm");
const photoInput = $("photoInput");
const photoList = $("photoList");
const generateBtn = $("generateBtn");
const formStatus = $("formStatus");

function setStatus(message, tone = "") {
  formStatus.textContent = message;
  formStatus.className = "form-status" + (tone ? " is-" + tone : "");
}

function setVerifyResult(html, tone = "") {
  const box = $("verifyResult");
  box.className = "verify-result" + (tone ? " " + tone : "");
  box.innerHTML = html;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayValue() {
  const d = new Date();
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}

function localStamp() {
  const d = new Date();
  const offset = -d.getTimezoneOffset();
  const offsetSign = offset >= 0 ? "+" : "-";
  const offsetHours = pad2(Math.floor(Math.abs(offset) / 60));
  const offsetMinutes = pad2(Math.abs(offset) % 60);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
    " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) +
    " (UTC" + offsetSign + offsetHours + ":" + offsetMinutes + ")";
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

function safeName(value) {
  return String(value || "")
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

async function sha256Hex(bytes) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error("Web Crypto is not available. Open this page in a current browser over HTTPS.");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ---------- photos ---------- */

async function decodeImage(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (error) {
      try { return await createImageBitmap(file); } catch (error2) { /* fall through */ }
    }
  }
  return await new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Unsupported image format")); };
    img.src = url;
  });
}

async function processPhoto(file) {
  const image = await decodeImage(file);
  const sourceWidth = image.width || image.naturalWidth;
  const sourceHeight = image.height || image.naturalHeight;
  if (!sourceWidth || !sourceHeight) throw new Error("Image has no readable dimensions");

  const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  if (typeof image.close === "function") image.close();

  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((result) => {
      if (result) resolve(result);
      else reject(new Error("The browser could not encode this photo"));
    }, "image/jpeg", JPEG_QUALITY);
  });
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const id = (globalThis.crypto && globalThis.crypto.randomUUID)
    ? globalThis.crypto.randomUUID()
    : "photo-" + Date.now() + "-" + Math.random().toString(16).slice(2);

  return {
    id,
    sourceName: file.name,
    sourceBytes: file.size,
    sourceWidth,
    sourceHeight,
    width,
    height,
    bytes,
    blob,
    caption: "",
    previewUrl: URL.createObjectURL(blob)
  };
}

function renderPhotos() {
  photoList.textContent = "";
  state.photos.forEach((photo, index) => {
    const item = document.createElement("li");
    item.className = "photo-item";

    const img = document.createElement("img");
    img.className = "photo-thumb";
    img.src = photo.previewUrl;
    img.alt = "Preview of attached photo " + (index + 1) + ", re-encoded without metadata";
    img.width = 84;
    img.height = 64;

    const body = document.createElement("div");
    body.className = "photo-body";
    const name = document.createElement("p");
    name.className = "photo-name";
    name.textContent = "Photo " + (index + 1) + " · " + photo.sourceName;
    const meta = document.createElement("p");
    meta.className = "photo-meta";
    meta.textContent = photo.sourceWidth + "×" + photo.sourceHeight + " → " +
      photo.width + "×" + photo.height + " px · " + formatBytes(photo.bytes.length) +
      " embedded · EXIF/GPS removed";
    const label = document.createElement("label");
    label.className = "visually-hidden";
    label.htmlFor = "caption-" + photo.id;
    label.textContent = "Caption for photo " + (index + 1);
    const caption = document.createElement("input");
    caption.type = "text";
    caption.id = "caption-" + photo.id;
    caption.maxLength = 180;
    caption.placeholder = "Caption: what does this photo show?";
    caption.value = photo.caption;
    caption.addEventListener("input", () => {
      photo.caption = caption.value;
      state.dirty = true;
    });
    body.append(name, meta, label, caption);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "photo-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", () => {
      URL.revokeObjectURL(photo.previewUrl);
      state.photos = state.photos.filter((entry) => entry.id !== photo.id);
      state.dirty = true;
      renderPhotos();
      setStatus("Photo removed.", "");
    });

    item.append(img, body, remove);
    photoList.append(item);
  });
}

async function addFiles(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;
  const room = MAX_PHOTOS - state.photos.length;
  if (room <= 0) {
    setStatus("You can attach up to " + MAX_PHOTOS + " photos.", "error");
    return;
  }
  const accepted = files.slice(0, room);
  if (files.length > room) {
    setStatus("Only " + MAX_PHOTOS + " photos can be attached. Extra files were skipped.", "error");
  }
  for (const file of accepted) {
    if (!file.type.startsWith("image/")) {
      setStatus("Skipped " + file.name + ": not an image file.", "error");
      continue;
    }
    if (file.size > MAX_FILE_BYTES) {
      setStatus("Skipped " + file.name + ": larger than 25 MB.", "error");
      continue;
    }
    setStatus("Processing " + file.name + " in your browser…", "busy");
    try {
      const photo = await processPhoto(file);
      state.photos.push(photo);
      state.dirty = true;
      renderPhotos();
      setStatus("Photo added. EXIF/GPS removed from the embedded copy.", "");
    } catch (error) {
      console.error(error);
      setStatus("Could not read " + file.name + ". Try JPEG, PNG or WebP. HEIC may need conversion first.", "error");
    }
  }
  photoInput.value = "";
}

/* ---------- validation ---------- */

function fieldValue(id) {
  const element = $(id);
  return element ? element.value.trim() : "";
}

function setFieldError(id, message) {
  const input = $(id);
  const box = $(id + "-error");
  if (input) input.setAttribute("aria-invalid", "true");
  if (box) { box.textContent = message; box.hidden = false; }
}

function clearFieldErrors() {
  form.querySelectorAll("[aria-invalid='true']").forEach((element) => element.removeAttribute("aria-invalid"));
  form.querySelectorAll(".error").forEach((element) => { element.hidden = true; element.textContent = ""; });
}

function validate(data) {
  let firstInvalid = null;
  const required = [
    ["project", "Enter the project name."],
    ["coNumber", "Enter the change order number."],
    ["changeDate", "Choose the date of the change."],
    ["description", "Describe the work that changed."],
    ["reason", "Give the reason for the change."]
  ];
  for (const [id, message] of required) {
    if (!data[id]) { setFieldError(id, message); firstInvalid = firstInvalid || id; }
  }
  if (data.amount !== null && !Number.isFinite(data.amount)) {
    setFieldError("amount", "Enter a number, or leave the amount blank.");
    firstInvalid = firstInvalid || "amount";
  }
  if (data.scheduleDays !== null && !Number.isInteger(data.scheduleDays)) {
    setFieldError("scheduleDays", "Use a whole number of days, or leave it blank.");
    firstInvalid = firstInvalid || "scheduleDays";
  }
  if (firstInvalid) {
    const element = $(firstInvalid);
    if (element) {
      element.focus();
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    return false;
  }
  return true;
}

function collectData() {
  const amountRaw = fieldValue("amount");
  const scheduleRaw = fieldValue("scheduleDays");
  return {
    project: fieldValue("project"),
    coNumber: fieldValue("coNumber"),
    changeDate: fieldValue("changeDate"),
    contractor: fieldValue("contractor"),
    client: fieldValue("client"),
    description: fieldValue("description"),
    reason: fieldValue("reason"),
    amount: amountRaw === "" ? null : Number(amountRaw),
    currency: fieldValue("currency") || "USD",
    scheduleDays: scheduleRaw === "" ? null : Number(scheduleRaw),
    notes: fieldValue("notes"),
    photos: state.photos.map((photo) => ({
      bytes: photo.bytes,
      width: photo.width,
      height: photo.height,
      caption: photo.caption
    })),
    generatedAt: localStamp()
  };
}

/* ---------- downloads ---------- */

function triggerDownload(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function downloadBytes(bytes, fileName, type) {
  triggerDownload(new Blob([bytes], { type }), fileName);
}

function downloadText(text, fileName) {
  triggerDownload(new Blob([text], { type: "text/plain;charset=utf-8" }), fileName);
}

function renderResult(result) {
  $("resultFile").textContent = result.fileName;
  $("resultSize").textContent = formatBytes(result.bytes.length);
  $("resultPages").textContent = String(result.pageCount);
  $("resultManifest").textContent = result.manifestName;
  $("resultHash").textContent = result.hash;
  $("resultSummary").textContent = "Two files were sent to your downloads: the PDF and its checksum manifest.";
  $("resultPanel").hidden = false;
  $("useLastHash").hidden = false;
  $("resultPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ---------- stats (local only) ---------- */

function readStats() {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function bumpStat(name) {
  const stats = readStats();
  stats[name] = (Number(stats[name]) || 0) + 1;
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch (error) { /* private mode */ }
  renderStats();
}

function renderStats() {
  const stats = readStats();
  const packs = Number(stats.pack_generated) || 0;
  const runs = Number(stats.verify_run) || 0;
  const matches = Number(stats.verify_match) || 0;
  let text = "Local use on this device: " + packs + (packs === 1 ? " pack" : " packs") + " generated, " +
    runs + (runs === 1 ? " check" : " checks") + " run";
  if (matches) text += ", " + matches + " matched";
  text += ". Counts stay in this browser and are never sent.";
  $("localStats").textContent = text;
}

/* ---------- generate ---------- */

async function onGenerate(event) {
  event.preventDefault();
  if (state.busy) return;
  clearFieldErrors();
  const data = collectData();
  if (!validate(data)) {
    setStatus("Check the highlighted fields.", "error");
    return;
  }

  const unsupported = findUnsupportedCharacters(data);
  if (unsupported.length) {
    const preview = unsupported.slice(0, 6).join(" ");
    const okay = window.confirm(
      "The PDF uses the built-in Latin character set. " + unsupported.length +
      " character type(s) cannot be embedded and will appear as \"?\": " + preview +
      "\n\nGenerate the PDF anyway?"
    );
    if (!okay) {
      setStatus("Export cancelled. Edit the text or keep Latin characters for the PDF.", "error");
      return;
    }
  }

  state.busy = true;
  generateBtn.disabled = true;
  setStatus("Building the PDF in your browser…", "busy");
  await new Promise((resolve) => setTimeout(resolve, 40));

  try {
    const built = buildEvidencePdf(data);
    const hash = await sha256Hex(built.bytes);
    const base = safeName(data.coNumber) || "change-order";
    const fileName = base + "_change-order-evidence-pack.pdf";
    const manifestName = base + "_checksums.txt";
    const manifest = buildManifest({ fileName, bytes: built.bytes, sha256: hash, data });

    downloadBytes(built.bytes, fileName, "application/pdf");
    await new Promise((resolve) => setTimeout(resolve, 300));
    downloadText(manifest, manifestName);

    state.lastExport = {
      bytes: built.bytes,
      hash,
      fileName,
      manifestName,
      manifest,
      pageCount: built.pageCount
    };
    renderResult(state.lastExport);
    bumpStat("pack_generated");
    state.dirty = false;
    setStatus("Done. Keep the PDF and the manifest together.", "");
  } catch (error) {
    console.error(error);
    setStatus("The PDF could not be generated. " + (error && error.message ? error.message : "Try a current browser."), "error");
  } finally {
    state.busy = false;
    generateBtn.disabled = false;
  }
}

/* ---------- verify ---------- */

function normalizeHash(value) {
  return String(value || "").replace(/[^a-fA-F0-9]/g, "").toLowerCase();
}

async function onVerify() {
  const file = $("verifyFile").files[0];
  const expected = normalizeHash($("expectedHash").value);
  const errorBox = $("expectedHash-error");
  errorBox.hidden = true;

  if (!file) {
    setVerifyResult("Choose the PDF you want to check.", "mismatch");
    $("verifyFile").focus();
    return;
  }
  if (!/^[a-f0-9]{64}$/.test(expected)) {
    errorBox.textContent = "Paste the 64-character SHA-256 from the manifest (letters and digits only).";
    errorBox.hidden = false;
    $("expectedHash").setAttribute("aria-invalid", "true");
    $("expectedHash").focus();
    return;
  }
  $("expectedHash").removeAttribute("aria-invalid");
  setVerifyResult("Computing SHA-256 in your browser…");

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const actual = await sha256Hex(bytes);
    bumpStat("verify_run");
    const match = actual === expected;
    if (match) bumpStat("verify_match");
    const heading = match ? "MATCH — the file bytes are unchanged" : "DOES NOT MATCH — the file has changed";
    const tone = match ? "match" : "mismatch";
    const note = match
      ? "This file is byte-identical to the one recorded in the manifest. This does not prove when it was created or who created it."
      : "The SHA-256 of this file is different from the expected value. It may be a different file, a re-saved copy, or a damaged download.";
    setVerifyResult(
      "<strong>" + heading + "</strong>" +
      "<span>" + note + "</span>" +
      "<span>File: " + escapeHtml(file.name) + " · " + formatBytes(file.size) + "</span>" +
      "<code>actual: " + actual + "</code>" +
      "<code>expected: " + expected + "</code>",
      tone
    );
  } catch (error) {
    console.error(error);
    setVerifyResult("Could not read that file in this browser: " + escapeHtml(error.message || "unknown error"), "mismatch");
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

/* ---------- wiring ---------- */

function init() {
  $("changeDate").value = todayValue();
  renderStats();

  form.addEventListener("submit", onGenerate);
  form.addEventListener("input", () => { state.dirty = true; });
  form.addEventListener("change", () => { state.dirty = true; });

  $("dropZone").addEventListener("click", () => photoInput.click());
  $("dropZone").addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      photoInput.click();
    }
  });
  photoInput.addEventListener("change", () => addFiles(photoInput.files));
  ["dragenter", "dragover"].forEach((name) => {
    $("dropZone").addEventListener(name, (event) => {
      event.preventDefault();
      $("dropZone").classList.add("is-over");
    });
  });
  ["dragleave", "drop"].forEach((name) => {
    $("dropZone").addEventListener(name, (event) => {
      event.preventDefault();
      $("dropZone").classList.remove("is-over");
    });
  });
  $("dropZone").addEventListener("drop", (event) => {
    if (event.dataTransfer && event.dataTransfer.files) addFiles(event.dataTransfer.files);
  });

  $("clearBtn").addEventListener("click", () => {
    if (!window.confirm("Clear the form and remove the attached photos from this page?")) return;
    form.reset();
    state.photos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    state.photos = [];
    state.lastExport = null;
    state.dirty = false;
    $("changeDate").value = todayValue();
    $("currency").value = "USD";
    renderPhotos();
    $("resultPanel").hidden = true;
    $("useLastHash").hidden = true;
    clearFieldErrors();
    setStatus("Form cleared. Nothing was saved.", "");
  });

  $("copyHash").addEventListener("click", async () => {
    if (!state.lastExport) return;
    try {
      await navigator.clipboard.writeText(state.lastExport.hash);
      $("copyHash").textContent = "Copied";
      window.setTimeout(() => { $("copyHash").textContent = "Copy"; }, 1800);
    } catch (error) {
      setStatus("Copy failed. Select the hash text and copy it manually.", "error");
    }
  });

  $("downloadPdfAgain").addEventListener("click", () => {
    if (!state.lastExport) return;
    downloadBytes(state.lastExport.bytes, state.lastExport.fileName, "application/pdf");
  });
  $("downloadManifestAgain").addEventListener("click", () => {
    if (!state.lastExport) return;
    downloadText(state.lastExport.manifest, state.lastExport.manifestName);
  });

  $("verifyBtn").addEventListener("click", onVerify);
  $("expectedHash").addEventListener("input", () => {
    $("expectedHash").removeAttribute("aria-invalid");
    $("expectedHash-error").hidden = true;
  });
  $("useLastHash").addEventListener("click", () => {
    if (!state.lastExport) return;
    $("expectedHash").value = state.lastExport.hash;
    setVerifyResult("Hash copied into the field. Choose the PDF and press Compare.", "");
  });

  $("usefulBtn").addEventListener("click", () => {
    bumpStat("useful_click");
    $("usefulBtn").textContent = "Thanks — noted on this device";
    $("usefulBtn").disabled = true;
    $("usefulNote").textContent = "Counted only in this browser. Nothing is sent.";
  });

  window.addEventListener("beforeunload", (event) => {
    if (state.dirty && !state.busy) {
      event.preventDefault();
      event.returnValue = "";
      return "";
    }
    return undefined;
  });
}

document.addEventListener("DOMContentLoaded", init);
