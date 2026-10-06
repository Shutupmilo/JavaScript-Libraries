/* milo-barcode.js  v1.1  2026-10-06  (replaces barcode.js v1.0)
   MiloBarcode: the barcode autofill engine for Memento custom sources.
   Looks a scanned barcode up in this order, and stops at the first that knows it:
     1. your own library (only if you set ownLibrary)
     2. Open Food Facts - food, drink, beauty, pet food and other products
     3. EAN-Search (only if you give it a token)
     4. UPCitemdb (by default only when nothing above matched)
   Needs: the calling library's Network permission, and helpers/milo-web.js
          ticked alongside this file.

   The whole Custom source script inside Memento:
     var email = MiloSecrets.get("OFF_CONTACT_EMAIL");
     result(new MiloBarcode({ contactEmail: email }).search(query));

   Options (all optional):
     contactEmail   - sent to Open Food Facts, which asks every app for a contact
     upcItemDb      - "fallback" (default), "always" or "off"
     eanSearchToken - EAN-Search token; leave it out to skip EAN-Search
     ownLibrary     - { name: "Autofill Barcode", barcodeField: "Barcode Text",
                        fields: { name: "Name", brand: "Brand", ... } }
     testMode       - true adds a "Test" row per source showing what came back
     testBarcode    - used when there is no scan, e.g. the editor's Run button

   Every product row carries these properties for the autofill mapping rules:
     name, brand, size, category, type, ingredients, description, image, link,
     source, barcode, code, details

   Defines one global name (MiloBarcode) and runs nothing when Memento loads it. */

function MiloBarcode(options) {
  options = options || {};
  this.contactEmail = MiloBarcode.text(options.contactEmail);
  this.upcItemDb = options.upcItemDb || "fallback";
  this.eanSearchToken = MiloBarcode.text(options.eanSearchToken);
  this.ownLibrary = options.ownLibrary || null;
  this.testMode = options.testMode === true;
  this.testBarcode = MiloBarcode.text(options.testBarcode) || "3068320080000";
}

MiloBarcode.version = "1.1";

MiloBarcode.prototype.search = function (scanned) {
  if (typeof MiloWeb === "undefined") {
    return [MiloBarcode.problemRow("milo-web.js isn't ticked - tick it under this script's JavaScript libraries", 0)];
  }
  var job = this.startJob(scanned);
  this.addRows(job, this.lookupOwnLibrary(job));
  if (job.rows.length === 0) this.addRows(job, this.lookupOpenFoodFacts(job));
  if (job.rows.length === 0 && this.eanSearchToken !== "") this.addRows(job, this.lookupEanSearch(job));
  if (this.upcItemDb === "always" || (this.upcItemDb === "fallback" && job.rows.length === 0)) {
    this.addRows(job, this.lookupUpcItemDb(job));
  }
  return this.finishJob(job);
};

/* ---------- the four sources ---------- */

MiloBarcode.prototype.lookupOwnLibrary = function (job) {
  var own = this.ownLibrary;
  if (!own || !own.name || !own.barcodeField) return [];
  var library = null;
  try { library = libByName(own.name); } catch (e) { library = null; }
  if (!library) {
    job.problems.push("Your library: can't open " + own.name + " - tick it under this library's script permissions (Libraries)");
    return [];
  }
  var found;
  try {
    found = MiloBarcode.listItems(library.find(job.code));
  } catch (e2) {
    job.problems.push("Your library: the search failed (" + MiloWeb.safeMessage(e2) + ")");
    return [];
  }
  var rows = [];
  var i;
  for (i = 0; i < found.length && rows.length < 3; i++) {
    var stored = MiloBarcode.text(found[i].field(own.barcodeField)).replace(/[^0-9]/g, "");
    if (stored === job.code) rows.push(this.ownRow(job, found[i], own));
  }
  this.noteTest(job, "Your library", null, rows.length + " match(es) out of " + found.length + " search result(s)");
  return rows;
};

MiloBarcode.prototype.lookupOpenFoodFacts = function (job) {
  var url = "https://world.openfoodfacts.org/api/v3/product/" + encodeURIComponent(job.code) +
            "?product_type=all&fields=" + MiloBarcode.OFF_FIELDS;
  var reply = MiloWeb.getJson(url, {
    "User-Agent": "MiloBarcode/" + MiloBarcode.version + " (" + (this.contactEmail || "no contact given") + ")",
    "Accept": "application/json"
  });
  this.noteTest(job, "Open Food Facts", reply, "");
  if (reply.code === 404 && reply.error === "") return [];
  var product = reply.json && reply.json.product;
  if (reply.code === 200 && product) return [this.offRow(job, product)];
  if (reply.code === 200 && reply.json !== null) {
    job.problems.push("Open Food Facts: the reply had no product in it");
  } else {
    job.problems.push(MiloWeb.describe("Open Food Facts", reply));
  }
  return [];
};

MiloBarcode.prototype.lookupEanSearch = function (job) {
  var url = "https://api.ean-search.org/api?token=" + encodeURIComponent(this.eanSearchToken) +
            "&op=barcode-lookup&format=json&ean=" + encodeURIComponent(job.code);
  var reply = MiloWeb.getJson(url, { "Accept": "application/json" });
  this.noteTest(job, "EAN-Search", reply, "");
  var list = reply.json;
  if (list && list.length && list[0].error) {
    /* EAN-Search reports problems as [{ "error": "..." }], e.g. "Invalid token". */
    if (!/not found/i.test(String(list[0].error))) job.problems.push("EAN-Search: " + MiloBarcode.text(list[0].error));
    return [];
  }
  if (reply.code !== 200 || !list) {
    job.problems.push(MiloWeb.describe("EAN-Search", reply));
    return [];
  }
  var rows = [];
  var i;
  for (i = 0; i < list.length && i < 3; i++) rows.push(this.eanRow(job, list[i]));
  return rows;
};

MiloBarcode.prototype.lookupUpcItemDb = function (job) {
  var reply = MiloWeb.getJson("https://api.upcitemdb.com/prod/trial/lookup?upc=" + encodeURIComponent(job.code),
                              { "Accept": "application/json" });
  this.noteTest(job, "UPCitemdb", reply, "");
  if (reply.code === 200 && reply.json) {
    var items = reply.json.items || [];
    var rows = [];
    var i;
    for (i = 0; i < items.length && i < 3; i++) rows.push(this.upcRow(job, items[i]));
    return rows;
  }
  if (reply.code === 429) {
    job.problems.push("UPCitemdb: too many scans - wait 10 seconds (free limit: 6 a minute, 100 a day)");
  } else if (reply.code === 400) {
    job.problems.push("UPCitemdb: says this is not a valid barcode - try scanning again");
  } else {
    job.problems.push(MiloWeb.describe("UPCitemdb", reply));
  }
  return [];
};

/* ---------- turning each source's data into pick-list rows ---------- */

MiloBarcode.prototype.ownRow = function (job, entry, own) {
  var map = own.fields || {};
  var d = { source: "Your library (" + own.name + ")", code: job.code };
  var properties = ["name", "brand", "size", "category", "type", "ingredients", "description", "link", "details"];
  var i;
  for (i = 0; i < properties.length; i++) {
    var fieldName = map[properties[i]];
    d[properties[i]] = fieldName ? MiloBarcode.text(entry.field(fieldName)) : "";
  }
  d.name = d.name || "(no name in your entry)";
  var row = this.makeRow(job, d);
  if (map.details) row.details = d.details;
  return row;
};

MiloBarcode.prototype.offRow = function (job, p) {
  var kind = MiloBarcode.text(p.product_type) || "food";
  var code = MiloBarcode.text(p.code) || job.code;
  var image = MiloBarcode.text(p.image_front_url);
  return this.makeRow(job, {
    source: MiloBarcode.OFF_SOURCE[kind] || MiloBarcode.OFF_SOURCE.food,
    name: MiloBarcode.firstFilled([p.product_name_en, p.product_name, p.generic_name_en, p.generic_name]) || "(no name in database)",
    brand: MiloBarcode.firstPart(p.brands),
    size: MiloBarcode.text(p.quantity),
    category: MiloBarcode.offCategory(p.categories),
    type: MiloBarcode.OFF_TYPE[kind] || kind,
    ingredients: MiloBarcode.cut(MiloBarcode.firstFilled([p.ingredients_text_en, p.ingredients_text]), 500),
    description: "",
    image: image,
    thumb: MiloBarcode.text(p.image_front_small_url) || image,
    link: "https://world." + (MiloBarcode.OFF_SITE[kind] || MiloBarcode.OFF_SITE.food) + "/product/" + code,
    code: code
  });
};

MiloBarcode.prototype.eanRow = function (job, item) {
  var code = MiloBarcode.text(item.ean) || job.code;
  var country = MiloBarcode.text(item.issuingCountry);
  return this.makeRow(job, {
    source: "EAN-Search",
    name: MiloBarcode.text(item.name) || "(no name in database)",
    brand: "", size: "",
    category: MiloBarcode.text(item.categoryName),
    type: "", ingredients: "",
    description: country ? "Barcode registered in " + country : "",
    image: "", thumb: "",
    link: "https://www.ean-search.org/?q=" + code,
    code: code
  });
};

MiloBarcode.prototype.upcRow = function (job, item) {
  var path = MiloBarcode.text(item.category).split(">");
  var image = MiloBarcode.firstHttpsImage(item.images || []);
  var extra = [];
  if (MiloBarcode.text(item.model)) extra.push("Model " + MiloBarcode.text(item.model));
  if (MiloBarcode.text(item.color)) extra.push("Colour " + MiloBarcode.text(item.color));
  var description = MiloBarcode.cut(MiloBarcode.text(item.description), 500);
  if (extra.length) description = extra.join(", ") + (description ? ". " + description : "");
  var code = MiloBarcode.firstFilled([item.ean, item.upc, job.code]);
  return this.makeRow(job, {
    source: "UPCitemdb",
    name: MiloBarcode.text(item.title) || "(no name in database)",
    brand: MiloBarcode.text(item.brand),
    size: MiloBarcode.text(item.size),
    category: path.length ? MiloBarcode.text(path[path.length - 1]) : "",
    type: path.length ? MiloBarcode.text(path[0]) : "",
    ingredients: "",
    description: description,
    image: image,
    thumb: image,
    link: "https://www.upcitemdb.com/upc/" + code,
    code: code
  });
};

MiloBarcode.prototype.makeRow = function (job, d) {
  var lines = [];
  MiloBarcode.addLine(lines, "Brand", d.brand);
  MiloBarcode.addLine(lines, "Size", d.size);
  MiloBarcode.addLine(lines, "Category", d.category);
  MiloBarcode.addLine(lines, "Type", d.type);
  MiloBarcode.addLine(lines, "Ingredients", d.ingredients);
  MiloBarcode.addLine(lines, "Description", d.description);
  MiloBarcode.addLine(lines, "Found in", d.source);
  var subtitle = [];
  if (d.brand) subtitle.push(d.brand);
  if (d.size) subtitle.push(d.size);
  subtitle.push(d.source);
  return {
    title: d.name,
    desc: subtitle.join(" | "),
    thumb: d.thumb || d.image || "",
    id: d.source + ":" + d.code,
    name: d.name,
    brand: d.brand || "",
    size: d.size || "",
    category: d.category || "",
    type: d.type || "",
    ingredients: d.ingredients || "",
    description: d.description || "",
    image: d.image || "",
    link: d.link || "",
    source: d.source,
    barcode: job.scanned,
    code: d.code,
    details: lines.join("\n")
  };
};

/* ---------- one search, start to finish ---------- */

MiloBarcode.prototype.startJob = function (scanned) {
  var raw = MiloBarcode.text(scanned);
  var used = raw === "" ? this.testBarcode : raw;
  var digits = used.replace(/[^0-9]/g, "");
  var job = {
    scanned: used,
    code: digits.length >= 8 ? digits : used,
    isTestRun: raw === "",
    rows: [],
    problems: [],
    testNotes: []
  };
  if (this.contactEmail === "" && typeof MiloSecrets !== "undefined" && MiloSecrets.problem) {
    job.problems.push("Contact email: " + MiloSecrets.problem);
  }
  return job;
};

MiloBarcode.prototype.addRows = function (job, rows) {
  var i;
  for (i = 0; i < rows.length; i++) job.rows.push(rows[i]);
};

MiloBarcode.prototype.noteTest = function (job, sourceName, reply, note) {
  if (!this.testMode) return;
  var text = note;
  if (reply) {
    text = reply.error ? reply.error :
      "HTTP " + reply.code + ", " + reply.text.length + " characters, starts: " + MiloWeb.preview(reply.text);
  }
  job.testNotes.push("Test - " + sourceName + ": " + text);
};

MiloBarcode.prototype.finishJob = function (job) {
  var rows = job.rows;
  var i;
  if (rows.length === 0) {
    var failed = job.problems.length > 0;
    rows.push({
      title: (failed ? "Could not look up " : "No match for ") + job.code,
      desc: failed ? "See the Problem row(s) below" : "No source knows this barcode - type the details in yourself",
      id: "none:" + job.code,
      name: "", details: "", source: "Not found",
      barcode: job.scanned, code: job.code
    });
  }
  for (i = 0; i < job.problems.length; i++) rows.push(MiloBarcode.problemRow(job.problems[i], i));
  for (i = 0; i < job.testNotes.length; i++) {
    rows.push({ title: job.testNotes[i], desc: "Test mode is on - set testMode: false to hide these rows", id: "test:" + i });
  }
  if (job.isTestRun) {
    for (i = 0; i < rows.length; i++) rows[i].title = "[TEST " + job.code + "] " + rows[i].title;
  }
  return rows;
};

/* ---------- small shared tools ---------- */

MiloBarcode.OFF_FIELDS = "code,product_type,product_name,product_name_en,generic_name,generic_name_en," +
  "brands,quantity,categories,ingredients_text,ingredients_text_en,image_front_url,image_front_small_url";
MiloBarcode.OFF_SOURCE = { food: "Open Food Facts", beauty: "Open Beauty Facts", petfood: "Open Pet Food Facts", product: "Open Products Facts" };
MiloBarcode.OFF_SITE = { food: "openfoodfacts.org", beauty: "openbeautyfacts.org", petfood: "openpetfoodfacts.org", product: "openproductsfacts.org" };
MiloBarcode.OFF_TYPE = { food: "Food & drink", beauty: "Beauty & personal care", petfood: "Pet food", product: "Other product" };

MiloBarcode.problemRow = function (message, index) {
  return { title: "Problem: " + message, desc: "Information only - this row has no product data", id: "problem:" + index };
};

MiloBarcode.text = function (value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
};

MiloBarcode.cut = function (text, max) {
  return text.length > max ? text.substring(0, max - 3) + "..." : text;
};

MiloBarcode.firstFilled = function (values) {
  var i;
  for (i = 0; i < values.length; i++) {
    var t = MiloBarcode.text(values[i]);
    if (t !== "") return t;
  }
  return "";
};

MiloBarcode.firstPart = function (commaList) {
  return MiloBarcode.text(MiloBarcode.text(commaList).split(",")[0]);
};

MiloBarcode.offCategory = function (categories) {
  /* Open Food Facts lists categories general-to-specific; take the last English one. */
  var parts = MiloBarcode.text(categories).split(",");
  var english = [];
  var i;
  for (i = 0; i < parts.length; i++) {
    var p = MiloBarcode.text(parts[i]);
    if (p !== "" && !/^[a-z]{2}:/.test(p)) english.push(p);
  }
  if (english.length) return english[english.length - 1];
  return MiloBarcode.text(parts[parts.length - 1]).replace(/^[a-z]{2}:/, "");
};

MiloBarcode.firstHttpsImage = function (images) {
  var i;
  for (i = 0; i < images.length; i++) {
    if (/^https:/i.test(MiloBarcode.text(images[i]))) return MiloBarcode.text(images[i]);
  }
  return images.length ? MiloBarcode.text(images[0]) : "";
};

MiloBarcode.addLine = function (lines, label, value) {
  if (value) lines.push(label + ": " + value);
};

MiloBarcode.listItems = function (list) {
  /* Memento may hand back a JavaScript array or a Java list; return a plain array. */
  if (!list) return [];
  if (list.length !== undefined) return list;
  var items = [];
  var i;
  for (i = 0; i < list.size(); i++) items.push(list.get(i));
  return items;
};
