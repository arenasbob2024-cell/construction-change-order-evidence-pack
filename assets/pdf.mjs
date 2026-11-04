/*
 * Construction Change Order Evidence Pack — PDF writer
 *
 * Generates a US-Letter PDF from plain data and browser-prepared JPEG photos.
 * No third-party code, no network access. Text uses the PDF base-14 Helvetica
 * fonts (WinAnsi), so the supported character set is Latin-1 plus common
 * punctuation replacements. Unsupported characters are reported to the caller
 * and rendered as "?" inside the PDF.
 */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;
const BOTTOM = 64;

const INK = [0.09, 0.12, 0.16];
const MUTED = [0.38, 0.42, 0.46];
const ACCENT = [0.72, 0.33, 0.08];
const RULE = [0.82, 0.82, 0.79];
const PANEL = [0.965, 0.955, 0.93];

/* Helvetica / Helvetica-Bold advance widths (units per 1000 em), ASCII 32-126. */
const REGULAR_WIDTHS = {
  " ":278,"!":278,'"':355,"#":556,"$":556,"%":889,"&":667,"'":191,"(":333,")":333,
  "*":389,"+":584,",":278,"-":333,".":278,"/":278,"0":556,"1":556,"2":556,"3":556,
  "4":556,"5":556,"6":556,"7":556,"8":556,"9":556,":":278,";":278,"<":584,"=":584,
  ">":584,"?":556,"@":1015,A:667,B:667,C:722,D:722,E:667,F:611,G:778,H:722,I:278,
  J:500,K:667,L:556,M:833,N:722,O:778,P:667,Q:778,R:722,S:667,T:611,U:722,V:667,
  W:944,X:667,Y:667,Z:611,"[":278,"\\":278,"]":278,"^":469,_:556,"`":333,a:556,b:556,
  c:500,d:556,e:556,f:278,g:556,h:556,i:222,j:222,k:500,l:222,m:833,n:556,o:556,
  p:556,q:556,r:333,s:500,t:278,u:556,v:500,w:722,x:500,y:500,z:500,"{":334,"|":260,
  "}":334,"~":584
};

const BOLD_WIDTHS = {
  " ":278,"!":333,'"':474,"#":556,"$":556,"%":889,"&":722,"'":238,"(":333,")":333,
  "*":389,"+":584,",":278,"-":333,".":278,"/":278,"0":556,"1":556,"2":556,"3":556,
  "4":556,"5":556,"6":556,"7":556,"8":556,"9":556,":":333,";":333,"<":584,"=":584,
  ">":584,"?":611,"@":975,A:722,B:722,C:722,D:722,E:667,F:611,G:778,H:722,I:278,
  J:556,K:722,L:611,M:833,N:722,O:778,P:667,Q:778,R:722,S:667,T:611,U:722,V:667,
  W:944,X:667,Y:667,Z:611,"[":333,"\\":278,"]":333,"^":584,_:556,"`":333,a:556,b:611,
  c:556,d:611,e:556,f:333,g:611,h:611,i:278,j:278,k:556,l:278,m:889,n:611,o:611,
  p:611,q:611,r:389,s:556,t:333,u:611,v:556,w:778,x:556,y:556,z:500,"{":389,"|":280,
  "}":389,"~":584
};

const PUNCTUATION = {
  "\u2018": "'", "\u2019": "'", "\u201A": "'", "\u201B": "'",
  "\u201C": '"', "\u201D": '"', "\u201E": '"', "\u201F": '"',
  "\u2013": "-", "\u2014": "-", "\u2212": "-", "\u2022": "-", "\u00B7": "-",
  "\u2026": "...", "\u00A0": " ", "\u2009": " ", "\u200A": " ", "\u202F": " ",
  "\u20AC": "EUR", "\u2122": "(TM)", "\u00AE": "(R)", "\u00A9": "(C)"
};

export function normalizePdfText(value) {
  const unsupported = [];
  let text = "";
  for (const ch of String(value == null ? "" : value)) {
    if (PUNCTUATION[ch]) { text += PUNCTUATION[ch]; continue; }
    const code = ch.codePointAt(0);
    if (ch === "\n") { text += "\n"; continue; }
    if (ch === "\t") { text += " "; continue; }
    if (code >= 32 && code <= 126) { text += ch; continue; }
    if (code >= 160 && code <= 255) { text += ch; continue; }
    text += "?";
    if (!unsupported.includes(ch)) unsupported.push(ch);
  }
  return { text, unsupported };
}

export function findUnsupportedCharacters(data) {
  const fields = [data.project, data.coNumber, data.contractor, data.client,
    data.description, data.reason, data.notes];
  const found = new Set();
  for (const field of fields) {
    for (const ch of normalizePdfText(field).unsupported) found.add(ch);
  }
  for (const photo of data.photos || []) {
    for (const ch of normalizePdfText(photo.caption).unsupported) found.add(ch);
  }
  return [...found];
}

function charWidth(ch, bold) {
  const table = bold ? BOLD_WIDTHS : REGULAR_WIDTHS;
  if (table[ch] != null) return table[ch];
  const code = ch.codePointAt(0);
  if (code >= 160 && code <= 255) return 556;
  return 556;
}

function textWidth(text, size, bold) {
  let units = 0;
  for (const ch of text) units += charWidth(ch, bold);
  return (units / 1000) * size;
}

function wrapText(text, maxWidth, size, bold) {
  const normalized = normalizePdfText(text).text;
  const out = [];
  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.replace(/\s+$/g, "");
    if (line === "") { out.push(""); continue; }
    const words = line.split(/\s+/);
    let current = "";
    for (let word of words) {
      while (textWidth(word, size, bold) > maxWidth) {
        // Split an over-long token at the last character that fits.
        let cut = word.length - 1;
        while (cut > 1 && textWidth(word.slice(0, cut), size, bold) > maxWidth) cut -= 1;
        if (current) { out.push(current); current = ""; }
        out.push(word.slice(0, cut));
        word = word.slice(cut);
      }
      const candidate = current ? current + " " + word : word;
      if (textWidth(candidate, size, bold) <= maxWidth) {
        current = candidate;
      } else {
        if (current) out.push(current);
        current = word;
      }
    }
    if (current) out.push(current);
  }
  return out;
}

function escapePdfString(text) {
  let out = "";
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch === "\\" || ch === "(" || ch === ")") out += "\\" + ch;
    else if (code < 32 || code > 126) out += "\\" + code.toString(8).padStart(3, "0");
    else out += ch;
  }
  return out;
}

function latin1Bytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function fmtMoney(value, currency) {
  if (value === null || value === undefined || value === "") return "Not stated";
  const number = Number(value);
  if (!Number.isFinite(number)) return "Not stated";
  if (number === 0) return "No change (0.00 " + currency + ")";
  const sign = number < 0 ? "-" : "+";
  const abs = Math.abs(number);
  const parts = abs.toFixed(2).split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return sign + currency + " " + parts.join(".");
}

function fmtDate(value) {
  if (!value) return "Not stated";
  const parts = String(value).split("-");
  if (parts.length !== 3) return String(value);
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

function fmtSchedule(value) {
  if (value === null || value === undefined || value === "") return "Not stated";
  const days = Number(value);
  if (!Number.isFinite(days) || !Number.isInteger(days)) return "Not stated";
  if (days === 0) return "No schedule change";
  if (days > 0) return "+" + days + (days === 1 ? " day" : " days") + " (delay)";
  return days + (days === -1 ? " day" : " days") + " (earlier)";
}

class Page {
  constructor() {
    this.ops = [];
    this.images = [];
  }
  op(text) { this.ops.push(text); }
}

class Builder {
  constructor() {
    this.pages = [];
    this.y = 0;
    this.page = null;
    this.newPage();
  }

  newPage() {
    this.page = new Page();
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN;
  }

  ensure(height) {
    if (this.y - height < BOTTOM) this.newPage();
  }

  gap(amount) { this.y -= amount; }

  text(text, x, top, size, bold = false, color = INK) {
    const safe = normalizePdfText(text).text;
    const baseline = top - size;
    const font = bold ? "/F2" : "/F1";
    this.page.op(
      "BT " + font + " " + size.toFixed(2) + " Tf " +
      color[0] + " " + color[1] + " " + color[2] + " rg 1 0 0 1 " +
      x.toFixed(2) + " " + baseline.toFixed(2) + " Tm (" + escapePdfString(safe) + ") Tj ET"
    );
  }

  line(x1, y1, x2, y2, color = RULE, width = 0.6) {
    this.page.op(
      width.toFixed(2) + " w " + color[0] + " " + color[1] + " " + color[2] + " RG " +
      x1.toFixed(2) + " " + y1.toFixed(2) + " m " +
      x2.toFixed(2) + " " + y2.toFixed(2) + " l S"
    );
  }

  rect(x, top, width, height, color, stroke = null, lineWidth = 0.7) {
    const bottom = top - height;
    if (color) {
      this.page.op(
        color[0] + " " + color[1] + " " + color[2] + " rg " +
        x.toFixed(2) + " " + bottom.toFixed(2) + " " +
        width.toFixed(2) + " " + height.toFixed(2) + " re f"
      );
    }
    if (stroke) {
      this.page.op(
        lineWidth.toFixed(2) + " w " + stroke[0] + " " + stroke[1] + " " + stroke[2] + " RG " +
        x.toFixed(2) + " " + bottom.toFixed(2) + " " +
        width.toFixed(2) + " " + height.toFixed(2) + " re S"
      );
    }
  }

  paragraph(text, options = {}) {
    const {
      size = 10.5, bold = false, color = INK, lineHeight = 1.45,
      width = CONTENT_W, x = MARGIN, gapAfter = 6
    } = options;
    const lines = wrapText(text, width, size, bold);
    const step = size * lineHeight;
    for (const line of lines) {
      this.ensure(step);
      if (line !== "") this.text(line, x, this.y, size, bold, color);
      this.y -= step;
    }
    this.y -= gapAfter;
  }

  sectionTitle(title, kicker) {
    this.ensure(kicker ? 42 : 28);
    this.gap(8);
    if (kicker) {
      this.text(kicker.toUpperCase(), MARGIN, this.y, 7.4, true, ACCENT);
      this.y -= 11;
    }
    this.text(title, MARGIN, this.y, 12.5, true, INK);
    this.y -= 19;
    this.line(MARGIN, this.y, MARGIN + CONTENT_W, this.y, RULE, 0.7);
    this.y -= 13;
  }

  kvGrid(items, columns = 2) {
    const gap = 14;
    const colWidth = (CONTENT_W - gap * (columns - 1)) / columns;
    for (let i = 0; i < items.length; i += columns) {
      const row = items.slice(i, i + columns);
      const prepared = row.map((item) => {
        const lines = wrapText(item.value || "—", colWidth, 10.2, false);
        return { label: item.label, lines };
      });
      const maxLines = Math.max(...prepared.map((item) => Math.max(1, item.lines.length)));
      const rowHeight = 12 + maxLines * 13.2 + 8;
      this.ensure(rowHeight);
      let x = MARGIN;
      for (const item of prepared) {
        this.text(item.label.toUpperCase(), x, this.y, 7.2, true, MUTED);
        let lineTop = this.y - 12;
        for (const line of item.lines) {
          this.text(line || "—", x, lineTop, 10.2, false, INK);
          lineTop -= 13.2;
        }
        x += colWidth + gap;
      }
      this.y -= rowHeight;
      this.line(MARGIN, this.y + 2, MARGIN + CONTENT_W, this.y + 2, [0.92, 0.92, 0.90], 0.5);
    }
    this.y -= 4;
  }
}

function addFooter(page, pageNumber, totalPages, generatedAt, coNumber) {
  const footerTop = 58;
  page.op("0.6 w 0.82 0.82 0.79 RG 54 " + footerTop + " m 558 " + footerTop + " l S");
  page.op(
    "BT /F1 7.2 Tf 0.38 0.42 0.46 rg 1 0 0 1 54 43 Tm " +
    "(" + escapePdfString("Generated locally in your browser on " + generatedAt + " (device clock; not a trusted timestamp). No project data was uploaded.") + ") Tj ET"
  );
  page.op(
    "BT /F1 7.2 Tf 0.38 0.42 0.46 rg 1 0 0 1 54 33 Tm " +
    "(" + escapePdfString("Organizes records only. Does not prove what happened, when a photo was taken, who signed, or legal admissibility.") + ") Tj ET"
  );
  const label = "Page " + pageNumber + " of " + totalPages;
  const width = textWidth(label, 7.2, false);
  page.op(
    "BT /F1 7.2 Tf 0.38 0.42 0.46 rg 1 0 0 1 " + (PAGE_W - MARGIN - width).toFixed(2) + " 43 Tm (" +
    escapePdfString(label) + ") Tj ET"
  );
  const short = "Change order " + coNumber;
  page.op(
    "BT /F1 7.2 Tf 0.55 0.57 0.59 rg 1 0 0 1 " + (PAGE_W - MARGIN - textWidth(short, 7.2, false)).toFixed(2) + " 33 Tm (" +
    escapePdfString(short) + ") Tj ET"
  );
}

function drawHeader(builder, pageIndex, coNumber) {
  if (pageIndex === 0) {
    builder.rect(0, PAGE_H, PAGE_W, 10, ACCENT);
    builder.y = PAGE_H - MARGIN;
    builder.text("CHANGE ORDER RECORD", MARGIN, builder.y, 21, true, INK);
    builder.y -= 24;
    builder.text("Evidence pack prepared from a written change order and job photos", MARGIN, builder.y, 9.6, false, MUTED);
    builder.y -= 18;
    const shortCo = /^CO[\s-]/i.test(coNumber) ? coNumber : "CO " + coNumber;
    builder.text(shortCo, PAGE_W - MARGIN - textWidth(shortCo, 9, true), PAGE_H - MARGIN - 4, 9, true, ACCENT);
  } else {
    const shortCo = /^CO[\s-]/i.test(coNumber) ? coNumber : "CO " + coNumber;
    builder.text("CHANGE ORDER RECORD  /  " + shortCo, MARGIN, 30, 7.6, true, MUTED);
    builder.line(MARGIN, 38, PAGE_W - MARGIN, 38, RULE, 0.5);
  }
}

function drawPhoto(builder, photo, index, total) {
  const maxW = CONTENT_W;
  const maxH = 318;
  let drawW = maxW;
  let drawH = (photo.height / photo.width) * drawW;
  if (drawH > maxH) {
    drawH = maxH;
    drawW = (photo.width / photo.height) * drawH;
  }
  const captionLines = wrapText(photo.caption || "No caption", maxW, 9.4, false);
  const captionHeight = Math.max(1, captionLines.length) * 12.2;
  const blockHeight = 16 + drawH + 8 + captionHeight + 20;

  builder.ensure(blockHeight);
  builder.text("PHOTO " + (index + 1) + " OF " + total, MARGIN, builder.y, 7.4, true, ACCENT);
  builder.y -= 12;

  const x = MARGIN;
  const top = builder.y;
  builder.page.images.push({ name: "Im" + (index + 1), bytes: photo.bytes, width: photo.width, height: photo.height });
  const bottom = top - drawH;
  builder.page.op(
    "q " + drawW.toFixed(2) + " 0 0 " + drawH.toFixed(2) + " " + x.toFixed(2) + " " + bottom.toFixed(2) +
    " cm /Im" + (index + 1) + " Do Q"
  );
  builder.page.op(
    "0.7 w 0.72 0.72 0.69 RG " + x.toFixed(2) + " " + bottom.toFixed(2) + " " +
    drawW.toFixed(2) + " " + drawH.toFixed(2) + " re S"
  );
  builder.y = bottom - 6;

  for (const line of captionLines) {
    builder.text(line || "No caption", MARGIN, builder.y, 9.4, false, INK);
    builder.y -= 12.2;
  }
  const meta = "Embedded copy: " + photo.width + " × " + photo.height + " px, " +
    formatBytes(photo.bytes.length) + " · re-encoded in browser; EXIF/GPS removed";
  builder.text(meta, MARGIN, builder.y, 7.4, false, MUTED);
  builder.y -= 19;
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

export function buildEvidencePdf(data) {
  const builder = new Builder();
  const photos = data.photos || [];
  const coNumber = data.coNumber || "not specified";

  drawHeader(builder, 0, coNumber);

  const amountText = fmtMoney(data.amount, data.currency || "USD");
  const scheduleText = fmtSchedule(data.scheduleDays);

  // Highlight panel: amount / schedule.
  const panelTop = builder.y;
  builder.rect(MARGIN, panelTop, CONTENT_W, 58, PANEL, RULE, 0.6);
  builder.text("AMOUNT CHANGE", MARGIN + 14, panelTop - 13, 7.4, true, MUTED);
  builder.text(amountText, MARGIN + 14, panelTop - 27, 14.5, true, INK);
  builder.text("SCHEDULE IMPACT", MARGIN + 286, panelTop - 13, 7.4, true, MUTED);
  builder.text(scheduleText, MARGIN + 286, panelTop - 27, 12.2, true, INK);
  builder.y = panelTop - 58 - 16;

  builder.sectionTitle("Project and change order", "Record details");
  builder.kvGrid([
    { label: "Project", value: data.project || "—" },
    { label: "Change order no.", value: data.coNumber || "—" },
    { label: "Date of change", value: fmtDate(data.changeDate) },
    { label: "Contractor / prepared by", value: data.contractor || "—" },
    { label: "Client / owner", value: data.client || "—" },
    { label: "Photos attached", value: photos.length ? String(photos.length) : "None" }
  ]);

  builder.sectionTitle("Work description");
  builder.paragraph(data.description || "Not stated", { gapAfter: 6 });

  builder.sectionTitle("Reason for change");
  builder.paragraph(data.reason || "Not stated", { gapAfter: 6 });

  builder.sectionTitle("Notes and confirmation record");
  builder.paragraph(data.notes || "No additional notes.", { gapAfter: 10 });

  if (photos.length) {
    if (builder.y < 400) builder.newPage();
    builder.sectionTitle("Photos and captions", "Attached images");
    builder.paragraph(
      "Each photo below was resized and re-encoded in the browser before being embedded. " +
      "Re-encoding removes EXIF metadata, including GPS location where present, and changes the " +
      "image bytes. Keep the original files separately if you need the original capture data.",
      { size: 8.6, color: MUTED, lineHeight: 1.4, gapAfter: 12 }
    );
    photos.forEach((photo, index) => drawPhoto(builder, photo, index, photos.length));
  }

  builder.sectionTitle("Handwritten confirmation", "Signatures");
  builder.paragraph(
    "This page provides blank lines for handwritten signatures. The tool does not create, apply, " +
    "or verify electronic signatures, identity, or authorization. Signing below only records that " +
    "the people named have seen this written record.",
    { size: 8.8, color: MUTED, lineHeight: 1.4, gapAfter: 12 }
  );

  const signatureRows = [
    ["Contractor signature", "Printed name", "Date"],
    ["Client / owner signature", "Printed name", "Date"]
  ];
  for (const row of signatureRows) {
    builder.ensure(56);
    const widths = [222, 152, 110];
    let x = MARGIN;
    row.forEach((label, index) => {
      builder.line(x, builder.y - 30, x + widths[index], builder.y - 30, [0.45, 0.47, 0.49], 0.7);
      builder.text(label, x, builder.y - 2, 7.2, true, MUTED);
      x += widths[index] + 10;
    });
    builder.y -= 56;
  }

  builder.gap(6);
  builder.paragraph(
    "This tool organizes records and computes file checksums in your browser. It does not prove " +
    "what happened, when a photo was taken, who signed it, or legal admissibility. No trusted " +
    "timestamp or legal certification is provided.",
    { size: 8.6, color: INK, lineHeight: 1.4, gapAfter: 4 }
  );
  builder.paragraph(
    "This document is an organized written record. It does not establish that the amount or " +
    "description is correct, and it does not make any court more likely to admit it.",
    { size: 8.4, color: MUTED, lineHeight: 1.4, gapAfter: 0 }
  );

  const totalPages = builder.pages.length;
  builder.pages.forEach((page, index) => {
    if (index > 0) addFooter(page, index + 1, totalPages, data.generatedAt, coNumber);
    else addFooter(page, index + 1, totalPages, data.generatedAt, coNumber);
  });

  return serializePdf(builder.pages, data);
}

function serializePdf(pages, data) {
  const objects = [];
  const addObject = (parts) => {
    objects.push(parts);
    return objects.length; // 1-based object number
  };

  // Reserve 1 catalog, 2 pages, 3 regular font, 4 bold font.
  addObject(null);
  addObject(null);
  addObject(latin1Bytes("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
  addObject(latin1Bytes("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"));

  const pageIds = [];
  const contentIds = [];
  for (const page of pages) {
    const content = page.ops.join("\n");
    const contentId = addObject(latin1Bytes("<< /Length " + latin1Bytes(content).length + " >>\nstream\n" + content + "\nendstream"));
    contentIds.push(contentId);
    const resources = [];
    resources.push("/Font << /F1 3 0 R /F2 4 0 R >>");
    const imageEntries = page.images.map((image) => {
      const id = addObject([
        latin1Bytes("<< /Type /XObject /Subtype /Image /Width " + image.width + " /Height " + image.height +
          " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length " + image.bytes.length + " >>\nstream\n"),
        image.bytes,
        latin1Bytes("\nendstream")
      ]);
      return "/" + image.name + " " + id + " 0 R";
    });
    if (imageEntries.length) resources.push("/XObject << " + imageEntries.join(" ") + " >>");
    const pageId = addObject(latin1Bytes(
      "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + PAGE_W + " " + PAGE_H + "] /Resources << " +
      resources.join(" ") + " >> /Contents " + contentId + " 0 R >>"
    ));
    pageIds.push(pageId);
  }

  const kids = pageIds.map((id) => id + " 0 R").join(" ");
  objects[0] = latin1Bytes("<< /Type /Catalog /Pages 2 0 R >>");
  objects[1] = latin1Bytes("<< /Type /Pages /Kids [" + kids + "] /Count " + pages.length + " >>");

  const chunks = [];
  let length = 0;
  const push = (bytes) => { chunks.push(bytes); length += bytes.length; };
  push(latin1Bytes("%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n"));
  const offsets = [];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(length);
    push(latin1Bytes((i + 1) + " 0 obj\n"));
    const parts = Array.isArray(objects[i]) ? objects[i] : [objects[i]];
    for (const part of parts) push(part);
    push(latin1Bytes("\nendobj\n"));
  }
  const xrefStart = length;
  let xref = "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
  for (const offset of offsets) xref += String(offset).padStart(10, "0") + " 00000 n \n";
  xref += "trailer\n<< /Size " + (objects.length + 1) + " /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF\n";
  push(latin1Bytes(xref));

  const out = new Uint8Array(length);
  let cursor = 0;
  for (const chunk of chunks) { out.set(chunk, cursor); cursor += chunk.length; }
  return {
    bytes: out,
    pageCount: pages.length,
    unsupported: findUnsupportedCharacters(data)
  };
}

export function buildManifest({ fileName, bytes, sha256, data }) {
  const lines = [
    "CHANGE ORDER EVIDENCE PACK — CHECKSUM MANIFEST",
    "==============================================",
    "",
    "Project: " + (data.project || "—"),
    "Change order: " + (data.coNumber || "—"),
    "Date of change: " + fmtDate(data.changeDate),
    "Generated: " + data.generatedAt + " (device local time — not a trusted timestamp)",
    "",
    "FILES IN THIS EXPORT",
    "--------------------",
    fileName,
    "  bytes:  " + bytes.length,
    "  sha256: " + sha256,
    "",
    "This manifest does not include a hash of itself (that would be circular).",
    "",
    "PHOTOS",
    "------",
  ];
  if (!data.photos || data.photos.length === 0) {
    lines.push("No photos were attached.");
  } else {
    data.photos.forEach((photo, index) => {
      lines.push(
        "Photo " + (index + 1) + ": " + (photo.caption || "no caption") +
        " — embedded as " + photo.width + " × " + photo.height + " px, " + photo.bytes.length + " bytes"
      );
    });
    lines.push("Photos were re-encoded in the browser (EXIF/GPS removed, long edge capped at 1600 px,");
    lines.push("JPEG quality 0.85) before being embedded in the PDF. Source photo bytes are not included");
    lines.push("in this export and are not hashed here. The PDF checksum covers the re-encoded images as");
    lines.push("they appear in the PDF.");
  }
  lines.push(
    "",
    "HOW TO CHECK LATER",
    "------------------",
    "1. Reopen the tool and use “Verify a file” to select the PDF and compare its SHA-256.",
    "2. Or run: shasum -a 256 " + fileName + "   (macOS/Linux)",
    "3. A matching hash means the file bytes are unchanged since this export. It does not prove",
    "   when the file was created, who created it, or that its contents are true.",
    ""
  );
  return lines.join("\n");
}

export const __test__ = { textWidth, wrapText, fmtMoney, fmtSchedule, normalizePdfText };
