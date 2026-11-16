// Phone numbers and person names, saved in one consistent UK format.
const { parsePhoneNumberFromString } = require("libphonenumber-js");

// Returns { value } (formatted, or null when empty) or { error }. UK numbers are saved in national
// format ("07911 123456"); a valid foreign number is kept in international format ("+48 ...").
function normalizePhone(raw, label = "Phone") {
  const text = String(raw ?? "").trim();
  if (!text) return { value: null };
  const phone = parsePhoneNumberFromString(text, "GB");
  if (!phone || !phone.isValid()) {
    return { error: `${label} "${text}" is not a valid phone number. Use a UK number such as 07911 123456 or 0161 496 0000.` };
  }
  return { value: phone.countryCallingCode === "44" ? phone.formatNational() : phone.formatInternational() };
}

// "amrik singh" / "TADEUSZ NOWAK" → "Amrik Singh" / "Tadeusz Nowak". Mixed-case names are left as typed
// (they are usually deliberate, e.g. "McDonald", "de Souza").
function normalizePersonName(raw) {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!text) return text;
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) return text;
  return text.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, sep, letter) => sep + letter.toUpperCase());
}

module.exports = { normalizePhone, normalizePersonName };
