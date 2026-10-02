/* =====================================================================
   AUTOFILL BARCODE - Custom source (JavaScript) for Memento Database
   ---------------------------------------------------------------------
   Library  : Autofill Barcode (test library)
   Rule     : Edit library > AUTOFILL tab > + > By barcode >
              Custom source (JavaScript) > search field "Barcode"
   Version  : v1.0 - 20261001_1825
   Chat     : 34.2-Autofill-MDB-3D_Paint_Barcode_Custom_Data_Source
              (chat ID: not visible to Claude in the Android app)
   Engine   : tested off-device in Rhino 1.9.1, interpreted mode
              (the engine Memento Android uses). Plain ES5 only.

   WHAT IT DOES
   1. Memento puts the scanned barcode in a variable called "query".
   2. Looks it up in Open Food Facts' "any product" lookup
      (food, drink, beauty, pet food, other products). Free, no key.
   3. Also looks it up in UPCitemdb (general shop products).
      Free, no key, max 100 lookups a day, 6 a minute.
   4. Hands every match to Memento's pick list, labelled with the
      database it came from. You tap the right one.
   5. Memento copies the chosen match into your fields, using the
      mapping rules you set up once (property name -> field).

   NEEDS: Network permission ON for this library
          (library menu > Automations > Scripts tab > shield icon).
   ===================================================================== */

// ----------------------- SETTINGS (safe to change) -----------------------
var CONTACT_EMAIL   = "jamiecahillace@gmail.com"; // Open Food Facts asks every app for a contact
var CHECK_UPCITEMDB = true;   // true  = always ask UPCitemdb too (uses 1 of its 100 free lookups a day)
                              // false = only ask UPCitemdb when Open Food Facts finds nothing
var TEST_BARCODE    = "3068320080000"; // used ONLY when there is no scan (e.g. a test run): Evian 1 L
// --------------------------------------------------------------------------


var AUTOFILL_RESULTS = (function () {

  // ---------- fixed names ----------
  var OFF_FIELDS = "code,product_type,product_name,product_name_en,generic_name,generic_name_en," +
                   "brands,quantity,categories,ingredients_text,ingredients_text_en," +
                   "image_front_url,image_front_small_url";
  var OFF_SOURCE = { food: "Open Food Facts", beauty: "Open Beauty Facts",
                     petfood: "Open Pet Food Facts", product: "Open Products Facts" };
  var OFF_SITE   = { food: "openfoodfacts.org", beauty: "openbeautyfacts.org",
                     petfood: "openpetfoodfacts.org", product: "openproductsfacts.org" };
  var OFF_TYPE   = { food: "Food & drink", beauty: "Beauty & personal care",
                     petfood: "Pet food", product: "Other product" };
  var UPC_SOURCE = "UPCitemdb";

  // ---------- small helpers ----------
  function txt(v) {                        // anything -> tidy one-line text ("" when empty)
    if (v === null || v === undefined) return "";
    return String(v).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  }
  function cut(s, max) {                   // shorten very long text
    return s.length > max ? s.substring(0, max - 3) + "..." : s;
  }
  function firstFilled(list) {             // first value that is not empty
    for (var i = 0; i < list.length; i++) {
      var t = txt(list[i]);
      if (t !== "") return t;
    }
    return "";
  }
  function firstPart(s) {                  // "Nestle, Perrier" -> "Nestle"
    return txt(String(s === null || s === undefined ? "" : s).split(",")[0]);
  }
  function asNumber(code) {                // digits only, up to 15 long -> number; else null
    return /^[0-9]{1,15}$/.test(code) ? Number(code) : null;
  }
  function offCategory(s) {                // most specific English category
    var parts = txt(s).split(",");
    var plain = [];
    for (var i = 0; i < parts.length; i++) {
      var p = txt(parts[i]);
      if (p !== "" && !/^[a-z]{2}:/.test(p)) plain.push(p);  // skip "nl:..." style entries
    }
    if (plain.length) return plain[plain.length - 1];
    var last = txt(parts[parts.length - 1]);
    return last.replace(/^[a-z]{2}:/, "");
  }
  function isRedirect(c) {
    return c === 301 || c === 302 || c === 303 || c === 307 || c === 308;
  }
  function headerOf(res, name) {
    var v = "";
    try { v = txt(res.header(name)); } catch (e1) { v = ""; }
    if (v === "") { try { v = txt(res.header(name.toLowerCase())); } catch (e2) { v = ""; } }
    return v;
  }

  // ---------- one web request -> { code, json, error } ----------
  function getUrl(url, headers) {
    var out = { code: 0, json: null, error: "" };
    try {
      var client = http();
      if (headers) {
        try { client.headers(headers); } catch (eh) { /* headers not allowed here - carry on */ }
      }
      var res = client.get(url);
      var hops = 0;
      // Open Food Facts sends beauty / pet / other products on to their own site.
      // If Memento does not follow that automatically, follow it here.
      while (res && isRedirect(Number(res.code)) && hops < 3) {
        var next = headerOf(res, "Location");
        if (next === "") break;
        if (next.charAt(0) === "/") next = url.replace(/^(https?:\/\/[^\/]+).*$/, "$1") + next;
        res = client.get(next);
        hops++;
      }
      out.code = Number(res.code);
      try { out.json = JSON.parse(String(res.body)); } catch (ej) { out.json = null; }
    } catch (e) {
      var msg = txt(e && e.message ? e.message : e);
      // Some HTTP clients throw on "not found" (404) or "bad request" (400)
      // instead of returning the code. Treat those as normal answers.
      var m = /response code:?\s*([0-9]{3})/i.exec(msg);
      if (m) out.code = Number(m[1]);
      else if (/FileNotFound/i.test(msg)) out.code = 404;
      else out.error = "error: " + cut(msg, 120);
    }
    return out;
  }

  // ---------- build one pick-list row with every mappable property ----------
  function makeItem(d) {
    var lines = [];
    function addLine(label, value) { if (value) lines.push(label + ": " + value); }
    addLine("Brand", d.brand);
    addLine("Size", d.size);
    addLine("Category", d.category);
    addLine("Type", d.type);
    addLine("Ingredients", d.ingredients);
    addLine("Description", d.description);
    addLine("Found in", d.source);

    var sub = [];
    if (d.brand) sub.push(d.brand);
    if (d.size) sub.push(d.size);
    sub.push(d.source);

    var item = {
      title:       d.name,                 // big text in the pick list
      desc:        sub.join(" | "),        // small text under it
      thumb:       d.thumb || d.image || "",
      id:          d.source + ":" + d.code,
      // ----- properties you can map to fields -----
      name:        d.name,
      brand:       d.brand,
      size:        d.size,
      category:    d.category,
      type:        d.type,
      ingredients: d.ingredients,
      description: d.description,
      image:       d.image,
      link:        d.link,
      source:      d.source,
      barcode:     scanned,                // exactly what was scanned, as text
      code:        d.code,                 // the barcode as the database stores it, as text
      details:     lines.join("\n")        // everything above in one multi-line summary
    };
    var n = asNumber(d.code);
    if (n !== null) item.number = n;       // the code as a whole number
    return item;
  }

  // ---------- lookup 1: Open Food Facts family (one universal call) ----------
  function lookupOpenFacts(code, problems) {
    var url = "https://world.openfoodfacts.org/api/v3/product/" + encodeURIComponent(code) +
              "?product_type=all&fields=" + OFF_FIELDS;
    var r = getUrl(url, {
      "User-Agent": "MementoAutofillBarcode/1.0 (" + CONTACT_EMAIL + ")",
      "Accept": "application/json"
    });
    if (r.error) { problems.push("Open Food Facts " + r.error); return []; }
    if (r.code === 404) return [];         // not in any of its 4 databases
    if (r.code !== 200) {
      problems.push("Open Food Facts answered HTTP " + r.code +
                    (r.code === 429 || r.code === 503 ? " (busy - try again in a minute)" : ""));
      return [];
    }
    var p = r.json && r.json.product;
    if (!p) return [];

    var kind = txt(p.product_type) || "food";
    var dbCode = txt(p.code) || code;
    var image = txt(p.image_front_url);
    return [makeItem({
      source:      OFF_SOURCE[kind] || OFF_SOURCE.food,
      name:        firstFilled([p.product_name_en, p.product_name, p.generic_name_en, p.generic_name]) ||
                   "(no name in database)",
      brand:       firstPart(p.brands),
      size:        txt(p.quantity),
      category:    offCategory(p.categories),
      type:        OFF_TYPE[kind] || kind,
      ingredients: cut(firstFilled([p.ingredients_text_en, p.ingredients_text]), 500),
      description: "",
      image:       image,
      thumb:       txt(p.image_front_small_url) || image,
      link:        "https://world." + (OFF_SITE[kind] || OFF_SITE.food) + "/product/" + dbCode,
      code:        dbCode
    })];
  }

  // ---------- lookup 2: UPCitemdb (general shop products) ----------
  function lookupUpcItemDb(code, problems) {
    var r = getUrl("https://api.upcitemdb.com/prod/trial/lookup?upc=" + encodeURIComponent(code),
                   { "Accept": "application/json" });
    if (r.error) { problems.push("UPCitemdb " + r.error); return []; }
    if (r.code === 200) {
      var list = (r.json && r.json.items) || [];
      var out = [];
      for (var i = 0; i < list.length && i < 3; i++) out.push(upcRow(list[i], code));
      return out;                          // empty list = not in UPCitemdb
    }
    var why = r.json ? txt(r.json.message || r.json.code) : "";
    if (r.code === 429) why = "too many scans - wait 10 seconds (free limit: 6 a minute, 100 a day)";
    if (r.code === 400) why = "says this is not a valid barcode - try scanning again";
    problems.push("UPCitemdb answered HTTP " + r.code + (why ? " - " + why : ""));
    return [];
  }
  function upcRow(it, code) {
    var path = txt(it.category).split(">");          // "Health & Beauty > ... > Body Powder"
    var category = path.length ? txt(path[path.length - 1]) : "";
    var type = path.length ? txt(path[0]) : "";
    var imgs = it.images || [];
    var image = "";
    for (var i = 0; i < imgs.length; i++) {          // prefer https pictures
      var u = txt(imgs[i]);
      if (/^https:/i.test(u)) { image = u; break; }
    }
    if (image === "" && imgs.length) image = txt(imgs[0]);
    var dbCode = firstFilled([it.ean, it.upc, code]);
    var extra = [];
    if (txt(it.model)) extra.push("Model " + txt(it.model));
    if (txt(it.color)) extra.push("Colour " + txt(it.color));
    var description = cut(txt(it.description), 500);
    if (extra.length) description = extra.join(", ") + (description ? ". " + description : "");
    return makeItem({
      source:      UPC_SOURCE,
      name:        txt(it.title) || "(no name in database)",
      brand:       txt(it.brand),
      size:        txt(it.size),
      category:    category,
      type:        type,
      ingredients: "",
      description: description,
      image:       image,
      thumb:       image,
      link:        "https://www.upcitemdb.com/upc/" + dbCode,
      code:        dbCode
    });
  }

  // ======================= MAIN =======================
  var raw = "";
  try { raw = (typeof query === "undefined" || query === null) ? "" : txt(query); } catch (eq) { raw = ""; }
  var testMode = (raw === "");
  var scanned = testMode ? TEST_BARCODE : raw;
  var digits = scanned.replace(/[^0-9]/g, "");
  var code = digits.length >= 8 ? digits : scanned;   // shop barcodes are 8-14 digits

  var problems = [];
  var rows = lookupOpenFacts(code, problems);
  if (CHECK_UPCITEMDB || rows.length === 0) rows = rows.concat(lookupUpcItemDb(code, problems));

  if (rows.length === 0) {
    var failed = problems.length > 0;
    var none = {
      title: (failed ? "Could not look up " : "No match for ") + code,
      desc: failed ? "See the Problem row(s) below"
                   : "Not in Open Food Facts or UPCitemdb - type the details in yourself",
      id: "none:" + code,
      name: "", details: "", source: "Not found",
      barcode: scanned, code: code
    };
    var n = asNumber(code);
    if (n !== null) none.number = n;
    rows.push(none);
  }
  for (var k = 0; k < problems.length; k++) {
    rows.push({ title: "Problem: " + problems[k],
                desc: "Info only, no product data. If it mentions http or permission, switch Network permission ON",
                id: "problem:" + k });
  }
  if (testMode) {
    for (var t = 0; t < rows.length; t++) rows[t].title = "[TEST " + TEST_BARCODE + "] " + rows[t].title;
  }
  return rows;
})();


// Hand the rows to Memento. Memento's own docs say to call result(...).
// If this Memento build has no result(), the list is left as the script's
// final value instead (the other way some builds read a data source).
var AUTOFILL_HAS_RESULT = false;
try { AUTOFILL_HAS_RESULT = (typeof result !== "undefined" && result !== null); } catch (er) { AUTOFILL_HAS_RESULT = false; }
if (AUTOFILL_HAS_RESULT) {
  result(AUTOFILL_RESULTS);
} else {
  AUTOFILL_RESULTS;
}
