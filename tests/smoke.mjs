import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildEvidencePdf, buildManifest } from "../assets/pdf.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const artifacts = path.join(here, "artifacts");
const data = JSON.parse(fs.readFileSync(path.join(here, "testdata.json"), "utf8"));

function jpegSize(buffer) {
  let i = 2;
  while (i < buffer.length - 9) {
    if (buffer[i] !== 0xff) { i += 1; continue; }
    const marker = buffer[i + 1];
    if (marker === 0xd8 || marker === 0xd9) { i += 2; continue; }
    const length = (buffer[i + 2] << 8) | buffer[i + 3];
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (buffer[i + 5] << 8) | buffer[i + 6],
        width: (buffer[i + 7] << 8) | buffer[i + 8]
      };
    }
    i += 2 + length;
  }
  throw new Error("Could not read JPEG dimensions");
}

// These filenames simulate the browser-prepared JPEGs (downscaled, EXIF removed).
const prepared = {
  "photo_gps.jpg": "prepared_photo_gps.jpg",
  "photo_plain.jpg": "prepared_photo_plain.jpg"
};

data.generatedAt = "2026-11-04 10:30:00";
data.photos = data.photos.map((photo) => {
  const file = path.join(artifacts, prepared[photo.file]);
  const raw = fs.readFileSync(file);
  const bytes = new Uint8Array(raw);
  const size = jpegSize(raw);
  return { bytes, width: size.width, height: size.height, caption: photo.caption };
});

const built = buildEvidencePdf(data);
const pdfPath = path.join(artifacts, "smoke.pdf");
fs.writeFileSync(pdfPath, built.bytes);

const hash = crypto.createHash("sha256").update(built.bytes).digest("hex");
const fileName = "CO-2026-014_change-order-evidence-pack.pdf";
const manifest = buildManifest({ fileName, bytes: built.bytes, sha256: hash, data });
fs.writeFileSync(path.join(artifacts, "smoke_checksums.txt"), manifest, "utf8");

console.log(JSON.stringify({
  pdf: pdfPath,
  pages: built.pageCount,
  bytes: built.bytes.length,
  sha256: hash,
  unsupported: built.unsupported,
  photo_sizes: data.photos.map((photo) => [photo.width, photo.height]),
  header: Buffer.from(built.bytes.slice(0, 8)).toString("latin1")
}, null, 2));
