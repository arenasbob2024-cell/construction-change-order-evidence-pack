"""Read the generated PDF back, check text/images/EXIF and test checksum tampering."""

import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

import fitz
from PIL import Image

HERE = Path(__file__).resolve().parent
ARTIFACTS = HERE / "artifacts"
DATA = json.loads((HERE / "testdata.json").read_text(encoding="utf-8"))
PDF = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ARTIFACTS / "smoke.pdf"
MANIFEST = Path(sys.argv[2]).resolve() if len(sys.argv) > 2 else ARTIFACTS / "smoke_checksums.txt"
IS_DEFAULT = len(sys.argv) <= 1
PREFIX = "smoke" if IS_DEFAULT else PDF.stem.replace("_change-order-evidence-pack", "") or "readback"
REPORT = ARTIFACTS / ("readback_report.json" if IS_DEFAULT else PREFIX + "_readback_report.json")
DISCLAIMER = (
    "This tool organizes records and computes file checksums in your browser. "
    "It does not prove what happened, when a photo was taken, who signed it, or "
    "legal admissibility. No trusted timestamp or legal certification is provided."
)

failures = []
checks = []


def check(name, condition, detail=""):
    checks.append({"name": name, "ok": bool(condition), "detail": detail})
    if not condition:
        failures.append(name + (": " + detail if detail else ""))


def norm(text):
    return re.sub(r"\s+", " ", text).strip()


pdf = fitz.open(PDF)
text = norm("\n".join(page.get_text() for page in pdf))
check("page count >= 2", pdf.page_count >= 2, str(pdf.page_count))
check("project name", DATA["project"] in text)

check("change order number", DATA["coNumber"] in text)
check("amount", "USD 1,850.00" in text, text[:200])
check("schedule", "+3 days" in text)
check("description", DATA["description"][:80] in text)
check("reason", DATA["reason"][:60] in text)
check("notes", DATA["notes"][:60] in text)
for photo in DATA["photos"]:
    check("caption: " + photo["caption"][:28], photo["caption"] in text)
check("disclaimer exact", DISCLAIMER in text)
check("signature block", "Contractor signature" in text and "Client / owner signature" in text)
check("no fake e-sign claim", "does not create, apply, or verify electronic signatures" in text)
for banned in ("tamper-proof", "court-ready", "legally binding", "防篡改", "法庭认可"):
    check("banned phrase absent: " + banned, banned.lower() not in text.lower())

# Images and EXIF.
image_count = 0
image_info = []
for page_index, page in enumerate(pdf):
    for info in page.get_images(full=True):
        image_count += 1
        xref = info[0]
        width, height, bpc, colorspace = info[2], info[3], info[4], info[5]
        extracted = pdf.extract_image(xref)
        raw = extracted["image"]
        img = Image.open(__import__("io").BytesIO(raw))
        exif = img.getexif()
        image_info.append({
            "page": page_index + 1,
            "width": width,
            "height": height,
            "bpc": bpc,
            "colorspace": colorspace,
            "ext": extracted["ext"],
            "exif_tags": len(exif),
            "gps": bool(exif.get_ifd(34853)) if exif else False,
            "bytes": len(raw),
        })
        check("image max edge <= 1600 (pdf %d)" % image_count, max(width, height) <= 1600, str((width, height)))
        check("embedded image has no EXIF (pdf %d)" % image_count, len(exif) == 0, str(dict(exif)))
        check("embedded image has no GPS (pdf %d)" % image_count, not (exif and exif.get_ifd(34853)))
check("two embedded photos", image_count == len(DATA["photos"]), str(image_count))

# Original fixture really has GPS EXIF, so the check above is meaningful.
with Image.open(ARTIFACTS / "photo_gps.jpg") as original:
    original_gps = bool(original.getexif().get_ifd(34853))
check("source fixture contains GPS", original_gps)

# Manifest vs independent hash.
pdf_hash = hashlib.sha256(PDF.read_bytes()).hexdigest()
manifest_text = MANIFEST.read_text(encoding="utf-8")
manifest_match = re.search(r"sha256:\s*([a-f0-9]{64})", manifest_text)
check("manifest has sha256", bool(manifest_match))
if manifest_match:
    check("manifest hash equals independent hash", manifest_match.group(1) == pdf_hash,
          manifest_match.group(1) + " != " + pdf_hash)
check("manifest lists byte size", "bytes:  " + str(PDF.stat().st_size) in manifest_text)
check("manifest labels device time", "not a trusted timestamp" in manifest_text)
check("manifest explains photos", "Source photo bytes are not included" in manifest_text)

# Tamper test: one byte changes the hash.
tampered = ARTIFACTS / (PREFIX + "_tampered.pdf")
shutil.copyfile(PDF, tampered)
raw = bytearray(tampered.read_bytes())
index = len(raw) // 2
raw[index] = raw[index] ^ 0x01
tampered.write_bytes(bytes(raw))
tampered_hash = hashlib.sha256(tampered.read_bytes()).hexdigest()
check("tampered file hash differs", tampered_hash != pdf_hash)
check("tampered file hash differs from manifest",
      not manifest_match or tampered_hash != manifest_match.group(1))

# Render pages for visual inspection.
render_paths = []
for index, page in enumerate(pdf):
    pix = page.get_pixmap(dpi=110)
    path = ARTIFACTS / ("%s_page_%d.png" % (PREFIX, index + 1))
    pix.save(path)
    render_paths.append(str(path))

report = {
    "pdf": str(PDF),
    "pages": pdf.page_count,
    "bytes": PDF.stat().st_size,
    "sha256": pdf_hash,
    "images": image_info,
    "checks": checks,
    "failures": failures,
    "renders": render_paths,
}
(REPORT).write_text(json.dumps(report, indent=2), encoding="utf-8")

print(json.dumps({k: report[k] for k in ("pages", "bytes", "sha256", "images", "failures", "renders")}, indent=2))
raise SystemExit(1 if failures else 0)
