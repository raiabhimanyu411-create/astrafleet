// Reads an uploaded maintenance document on this server (no external service) and suggests form values.
//   Images (photo / scan): Tesseract OCR with the bundled English data, so it works offline.
//   PDFs: the text layer is read directly. Scanned PDFs have no text layer and are reported as unreadable.
// Only values found with a clear label or format are returned; anything uncertain is left out so the
// person fills it in. Nothing here saves data: the form shows the suggestions and the person confirms.
const path = require("path");
const os = require("os");

const OCR_TIMEOUT_MS = 60000;
const MAX_PDF_PAGES = 5;

let workerPromise = null;

function getOcrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = require("tesseract.js");
      const eng = require("@tesseract.js-data/eng");
      return createWorker("eng", 1, {
        langPath: eng.langPath,
        gzip: eng.gzip,
        cachePath: path.join(os.tmpdir(), "astrafleet-tesseract")
      });
    })().catch(error => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
  ]).finally(() => clearTimeout(timer));
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!match) return null;
  const mime = (match[1] || "").toLowerCase();
  const buffer = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]));
  return { mime, buffer };
}

async function pdfText(buffer) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false }).promise;
  const lines = [];
  for (let pageNo = 1; pageNo <= Math.min(doc.numPages, MAX_PDF_PAGES); pageNo += 1) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    // Rebuild visual lines: items sharing a baseline belong to the same line.
    const rows = new Map();
    for (const item of content.items) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5]);
      const key = [...rows.keys()].find(existing => Math.abs(existing - y) <= 2) ?? y;
      rows.set(key, [...(rows.get(key) || []), { x: item.transform[4], text: item.str }]);
    }
    [...rows.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => {
      lines.push(items.sort((a, b) => a.x - b.x).map(item => item.text).join(" ").replace(/\s+/g, " ").trim());
    });
  }
  await doc.destroy();
  return lines.join("\n");
}

async function extractText({ mime, buffer }) {
  if (mime === "application/pdf") return { text: await pdfText(buffer), method: "pdf-text" };
  if (/^image\/(png|jpe?g|webp|bmp|gif|tiff?)$/.test(mime)) {
    const worker = await getOcrWorker();
    const result = await withTimeout(worker.recognize(buffer), OCR_TIMEOUT_MS, "Reading the image took too long.");
    return { text: result.data.text || "", method: "ocr" };
  }
  return { text: "", method: "unsupported" };
}

// ── Field parsing (UK invoices and service sheets) ──────────────────────────

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

function validDate(year, month, day) {
  if (year < 100) year += 2000;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (year < 2000 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// UK order (day first) for numeric dates.
function findDates(line) {
  const found = [];
  for (const m of line.matchAll(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/g)) {
    const key = validDate(Number(m[3]), Number(m[2]), Number(m[1]));
    if (key) found.push(key);
  }
  for (const m of line.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const key = validDate(Number(m[1]), Number(m[2]), Number(m[3]));
    if (key) found.push(key);
  }
  for (const m of line.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})\b/g)) {
    const month = MONTHS[m[2].slice(0, 4).toLowerCase()] || MONTHS[m[2].slice(0, 3).toLowerCase()];
    const key = month && validDate(Number(m[3]), month, Number(m[1]));
    if (key) found.push(key);
  }
  return found;
}

function money(value) {
  const number = Number(String(value).replace(/[£,\s]/g, ""));
  return Number.isFinite(number) && number > 0 && number < 1000000 ? Math.round(number * 100) / 100 : null;
}

function amountsIn(line) {
  return [...line.matchAll(/£?\s?(\d{1,3}(?:,\d{3})+(?:\.\d{2})?|\d+\.\d{2})\b/g)].map(m => money(m[1])).filter(Boolean);
}

function parseInvoiceFields(rawText) {
  const lines = String(rawText || "").split(/\r?\n/).map(line => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const fields = {};

  // Invoice / bill number: needs an invoice-style label in front of it.
  for (const line of lines) {
    const m = line.match(/\b(?:invoice|inv|bill|receipt)\.?\s*(?:no\.?|number|num|#|ref(?:erence)?)\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9\-\/]{2,24})/i);
    if (m && /\d/.test(m[1])) { fields.billNumber = m[1].toUpperCase(); break; }
  }

  // Bill date: a date on a line labelled as the invoice/bill/tax-point date, else on a plain "Date" line.
  const dateLine = lines.find(line => /\b(invoice|bill|tax point|issue[d]?)\s*date\b/i.test(line) && findDates(line).length)
    || lines.find(line => /^\s*date\b/i.test(line) && findDates(line).length);
  if (dateLine) fields.billDate = findDates(dateLine)[0];

  // Amount: the total the customer pays. Prefer explicit grand/amount-due totals over a bare "Total".
  const totalPatterns = [
    /\b(amount due|balance due|total due|grand total|invoice total|total payable|amount payable|total \(?inc(?:l|luding)?\.? vat\)?)\b/i,
    /\btotal\b(?!.*\b(ex(?:cl|cluding)?\.? vat|net|sub)\b)/i
  ];
  for (const pattern of totalPatterns) {
    const line = [...lines].reverse().find(candidate => pattern.test(candidate) && amountsIn(candidate).length);
    if (line) {
      const values = amountsIn(line);
      fields.billAmountGbp = values[values.length - 1];
      break;
    }
  }

  // Garage / vendor: the first heading-like line that looks like a business name.
  const vendor = lines.slice(0, 12).find(line =>
    /\b(ltd|limited|llp|plc|garage|motors?|commercials?|services|tyres?|trucks?|hgv|fleet|engineering|workshop|auto(?:motive)?)\b/i.test(line)
    && !/\b(invoice|bill to|customer|vat reg|tel|phone|email|www\.|@)\b/i.test(line)
    && line.length <= 60);
  if (vendor) fields.garageName = vendor.replace(/[|_]+/g, " ").trim();

  // Odometer: only when the reading is clearly kilometres (the form stores km).
  for (const line of lines) {
    if (/\bmiles?\b/i.test(line)) continue;
    const m = line.match(/\b(?:odometer|odo|mileage|km reading|recorded km)\b[^0-9]{0,15}(\d{1,3}(?:,\d{3})+|\d{3,7})\s*(km|kms|kilometres?)?/i)
      || line.match(/\b(\d{1,3}(?:,\d{3})+|\d{4,7})\s*(km|kms|kilometres?)\b/i);
    if (m && (m[2] || /\b(km|kilometres?)\b/i.test(line))) {
      const km = Number(String(m[1]).replace(/,/g, ""));
      if (km >= 100 && km <= 5000000) { fields.odometerKm = km; break; }
    }
  }

  return fields;
}

async function extractDocumentFields(dataUrl) {
  const decoded = decodeDataUrl(dataUrl);
  if (!decoded || !decoded.buffer.length) return { status: "unreadable", reason: "The document could not be opened.", fields: {} };
  const { text, method } = await extractText(decoded);
  if (method === "unsupported") {
    return { status: "unsupported", reason: "Only PDF and image files can be read automatically. Please fill the details in.", fields: {} };
  }
  if (text.replace(/\s/g, "").length < 15) {
    return {
      status: "unreadable",
      method,
      reason: method === "pdf-text" ? "This PDF is a scan with no text to read. Please fill the details in." : "No readable text was found. Please fill the details in.",
      fields: {}
    };
  }
  const fields = parseInvoiceFields(text);
  return { status: Object.keys(fields).length ? "ok" : "nothing_found", method, fields };
}

module.exports = { extractDocumentFields, parseInvoiceFields, decodeDataUrl };
