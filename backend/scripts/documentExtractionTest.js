const test = require("node:test");
const assert = require("node:assert/strict");
const { parseInvoiceFields } = require("../utils/documentExtraction");

test("reads a typical UK garage invoice", () => {
  const fields = parseInvoiceFields(`Midlands Truck & Trailer Services Ltd
Invoice No: INV-20488
Invoice Date: 06/05/2026
Odometer: 1,146,788 km
Subtotal (ex VAT): £145.00
VAT @ 20%: £29.00
Total Due: £174.00`);
  assert.deepEqual(fields, {
    billNumber: "INV-20488",
    billDate: "2026-05-06",
    billAmountGbp: 174,
    garageName: "Midlands Truck & Trailer Services Ltd",
    odometerKm: 1146788
  });
});

test("never guesses: miles, ex-VAT totals and unlabelled numbers are left out", () => {
  const fields = parseInvoiceFields(`Job sheet
Mileage: 412,300 miles
Total ex VAT 145.00
Reference 99812 on 12/03/2026`);
  assert.deepEqual(fields, {});
});

test("written dates, inc-VAT totals and bill references", () => {
  const fields = parseInvoiceFields(`Bill Ref: B-7741/26
Tax point date: 6th May 2026
Total (inc VAT) £1,250.40`);
  assert.equal(fields.billNumber, "B-7741/26");
  assert.equal(fields.billDate, "2026-05-06");
  assert.equal(fields.billAmountGbp, 1250.4);
});

test("an impossible date is ignored", () => {
  assert.equal(parseInvoiceFields("Invoice date: 31/02/2026").billDate, undefined);
});
