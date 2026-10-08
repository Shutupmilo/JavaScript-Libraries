/* milo-barcode.js  v1.2  2026-10-08  (replaces barcode.js v1.0)
   MiloBarcode: the barcode autofill engine for Memento custom sources.
   Looks a scanned barcode up in this order, and stops at the first that knows it:
     1. your product library (only if you set ownLibrary - normally MiloProducts.source())
     2. Open Food Facts - food, drink, beauty, pet food and other products
     3. EAN-Search (only if you give it a token)
     4. UPCitemdb (by default only when nothing above matched)
   Needs: the calling library's Network permission, and helpers/milo-web.js
          ticked alongside this file.

   The whole Custom source script inside Memento:
     var email = MiloSecrets.get("OFF_CONTACT_EMAIL");
     result(new MiloBarcode({ contactEmail: email, ownLibrary: MiloProducts.source() }).search(query));

   Options (all optional):
     contactEmail   - sent to Open Food Facts, which asks every app for a contact
     upcItemDb      - "fallback" (default), "always" or "off"
     eanSearchToken - EAN-Search token; leave it out to skip EAN-Search
     ownLibrary     - { name, label, barcodeField, fields: { name: "Name", ... }, isThisLibrary }
     testBarcode    - used when there is no scan, e.g. the editor's Run button

   The pick list shows products only. Every row carries these properties for the
   autofill mapping rules:
     name, brand, size, category, type, ingredients, description, image, imageLink,
     link, source, barcode, code, details, lookupLog, lookupProblem
   lookupLog says what each source answered, in full; lookupProblem is "Yes" or "No".

   Defines one global name (MiloBarcode) and runs nothing when Memento loads it. */

function MiloBarcode(options) {
  options = options || {};
  this.contactEmail = MiloBarcode.text(options.contactEmail);
  this.upcItemDb = options.upcItemDb || "fallback";
  this.eanSearchToken = MiloBarcode.text(options.eanSearchToken);
  this.ownLibrary = options.ownLibrary || null;
  this.testBarcode = MiloBarcode.text(options.testBarcode) || "3068320080000";
}

MiloBarcode.version = "1.2";

MiloBarcode.prototype.search = function (scanned) {
  if (typeof MiloWeb === "undefined") {
    return [MiloBarcode.problemRow("milo-web.js isn't ticked - tick it under this script's JavaScript libraries")];
  }
  var job = this.startJob(scanned);
  this.addRows(job, this.lookupOwnLibrary(job));
  if (job.stop) return this.finishJob(job);
  if (job.rows.length === 0) this.addRows(job, this.lookupOpenFoodFacts(job));
  else job.log.push("Open Food Facts: not asked - already found");
  if (this.eanSearchToken === "") job.log.push("EAN-Search: not used - no token given");
  else if (job.rows.length === 0) this.addRows(job, this.lookupEanSearch(job));
  else job.log.push("EAN-Search: not asked - already found");
  if (this.upcItemDb === "always" || (this.upcItemDb === "fallback" && job.rows.length === 0)) {
    this.addRows(job, this.lookupUpcItemDb(job));
  } else {
    job.log.push("UPCitemdb: " + (this.upcItemDb === "off" ? "switched off" : "not asked - already found"));
  }
  return this.finishJob(job);
};

/* ---------- the four sources ---------- */

MiloBarcode.prototype.lookupOwnLibrary = function (job) {
  var own = this.ownLibrary;
  if (!own || !own.name || !own.barcodeField) {
    job.log.push("Your product library: not used");
    return [];
  }
  var label = own.label || own.name;
  var library = null;
  try { library = libByName(own.name); } catch (e) { library = null; }
  if (!library) {
    MiloBarcode.problem(job, label + ": can't open it - tick it under this library's script permissions (Libraries)");
    return [];
  }
  var found;
  try {
    found = MiloBarcode.listItems(library.find(job.code));
  } catch (e2) {
    MiloBarcode.problem(job, label + ": the search failed (" + MiloWeb.safeMessage(e2) + ")");
    return [];
  }
  var rows = [];
  var i;
  for (i = 0; i < found.length && rows.length < 3; i++) {
    var stored = MiloBarcode.read(found[i], own.barcodeField);
    if (stored.replace(/[^0-9]/g, "") === job.code || stored === job.scanned) rows.push(this.ownRow(job, found[i], own, label));
  }
  job.log.push(label + ": " + (rows.length ? "found" : "no match") + " (" + found.length + " search result(s) checked)");
  if (rows.length && own.isThisLibrary) {
    job.stop = true;
    return [{
      title: "Already in " + label + ": " + rows[0].name,
      desc: "Open the existing entry instead - a second one can't be saved",
      id: "already:" + job.code,
      barcode: job.scanned, code: job.code
    }];
  }
  return rows;
};

MiloBarcode.prototype.lookupOpenFoodFacts = function (job) {
  var url = "https://world.openfoodfacts.org/api/v3/product/" + encodeURIComponent(job.code) +
            "?product_type=all&fields=" + MiloBarcode.OFF_FIELDS;
  var reply = MiloWeb.getJson(url, {
    "User-Agent": "MiloBarcode/" + MiloBarcode.version + " (" + (this.contactEmail || "no contact given") + ")",
    "Accept": "application/json"
  });
  var product = reply.json && reply.json.product;
  if (reply.code === 200 && product) {
    job.log.push("Open Food Facts: found (" + MiloBarcode.replyFacts(reply) + ")");
    return [this.offRow(job, product)];
  }
  if (reply.code === 404 && reply.error === "") {
    job.log.push("Open Food Facts: not in its database (HTTP 404)");
    return [];
  }
  if (reply.code === 200 && reply.json !== null) {
    MiloBarcode.problem(job, "Open Food Facts: the reply had no product in it (" + MiloBarcode.replyFacts(reply) + ")");
  } else {
    MiloBarcode.problem(job, MiloWeb.describe("Open Food Facts", reply) + MiloBarcode.replyTail(reply));
  }
  return [];
};

MiloBarcode.prototype.lookupEanSearch = function (job) {
  var url = "https://api.ean-search.org/api?token=" + encodeURIComponent(this.eanSearchToken) +
            "&op=barcode-lookup&format=json&ean=" + encodeURIComponent(job.code);
  var reply = MiloWeb.getJson(url, { "Accept": "application/json" });
  var list = reply.json;
  if (list && list.length && list[0].error) {
    /* EAN-Search reports problems as [{ "error": "..." }], e.g. "Invalid token". */
    if (/not found/i.test(String(list[0].error))) {
      job.log.push("EAN-Search: not in its database");
    } else {
      MiloBarcode.problem(job, "EAN-Search: " + MiloBarcode.text(list[0].error));
    }
    return [];
  }
  if (reply.code !== 200 || !list) {
    MiloBarcode.problem(job, MiloWeb.describe("EAN-Search", reply) + MiloBarcode.replyTail(reply));
    return [];
  }
  var rows = [];
  var i;
  for (i = 0; i < list.length && i < 3; i++) rows.push(this.eanRow(job, list[i]));
  job.log.push("EAN-Search: " + (rows.length ? "found " + rows.length : "no products") + " (" + MiloBarcode.replyFacts(reply) + ")");
  return rows;
};

MiloBarcode.prototype.lookupUpcItemDb = function (job) {
  var reply = MiloWeb.getJson("https://api.upcitemdb.com/prod/trial/lookup?upc=" + encodeURIComponent(job.code),
                              { "Accept": "application/json" });
  if (reply.code === 200 && reply.json) {
    var items = reply.json.items || [];
    var rows = [];
    var i;
    for (i = 0; i < items.length && i < 3; i++) rows.push(this.upcRow(job, items[i]));
    job.log.push("UPCitemdb: " + (rows.length ? "found " + rows.length : "not in its database") + " (" + MiloBarcode.replyFacts(reply) + ")");
    return rows;
  }
  if (reply.code === 429) {
    MiloBarcode.problem(job, "UPCitemdb: too many scans - wait 10 seconds (free limit: 6 a minute, 100 a day)");
  } else if (reply.code === 400) {
    MiloBarcode.problem(job, "UPCitemdb: says this is not a valid barcode - try scanning again");
  } else {
    MiloBarcode.problem(job, MiloWeb.describe("UPCitemdb", reply) + MiloBarcode.replyTail(reply));
  }
  return [];
};

/* ---------- turning each source's data into pick-list rows ---------- */

MiloBarcode.prototype.ownRow = function (job, entry, own, label) {
  var map = own.fields || {};
  var d = { code: job.code };
  var properties = ["name", "brand", "size", "category", "type", "ingredients", "description", "link", "imageLink", "source"];
  var i;
  for (i = 0; i < properties.length; i++) {
    var fieldName = map[properties[i]];
    d[properties[i]] = fieldName ? MiloBarcode.read(entry, fieldName) : "";
  }
  /* Keep where the data first came from (e.g. Open Food Facts); the Lookup Log says it came via your library. */
  d.source = d.source || label;
  d.name = d.name || "(no name in your entry)";
  d.image = d.imageLink;
  d.thumb = d.imageLink;
  return this.makeRow(job, d);
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
    imageLink: d.image || "",
    link: d.link || "",
    source: d.source,
    barcode: job.scanned,
    code: d.code,
    details: MiloBarcode.details(d)
  };
};

/* The summary text for a "Details" field. MiloProducts uses the same layout. */
MiloBarcode.details = function (d) {
  var lines = [];
  MiloBarcode.addLine(lines, "Brand", d.brand);
  MiloBarcode.addLine(lines, "Size", d.size);
  MiloBarcode.addLine(lines, "Category", d.category);
  MiloBarcode.addLine(lines, "Type", d.type);
  MiloBarcode.addLine(lines, "Ingredients", d.ingredients);
  MiloBarcode.addLine(lines, "Description", d.description);
  MiloBarcode.addLine(lines, "Found in", d.source);
  return lines.join("\n");
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
    stop: false,
    rows: [],
    problems: [],
    log: []
  };
  job.log.push("Lookup " + MiloBarcode.now() + " for " + job.code + (job.isTestRun ? " (test run - no scan)" : "") +
               " - MiloBarcode " + MiloBarcode.version + ", MiloWeb " + MiloWeb.version);
  if (this.contactEmail === "") {
    var why = (typeof MiloSecrets !== "undefined" && MiloSecrets.problem) ? MiloSecrets.problem : "none given";
    MiloBarcode.problem(job, "Contact email for Open Food Facts: " + why);
  }
  return job;
};

MiloBarcode.prototype.addRows = function (job, rows) {
  var i;
  for (i = 0; i < rows.length; i++) job.rows.push(rows[i]);
};

MiloBarcode.prototype.finishJob = function (job) {
  var rows = job.rows;
  var i;
  if (rows.length === 0) {
    var failed = job.problems.length > 0;
    rows.push({
      title: failed ? "Could not look up " + job.code + " - pick it, then read Lookup Log"
                    : "No match for " + job.code + " - pick it, then type the details in",
      desc: failed ? "Something went wrong - Lookup Log says what" : "No source knows this barcode",
      id: "none:" + job.code,
      name: "", details: "", source: "Not found",
      barcode: job.scanned, code: job.code
    });
  }
  var log = job.log.join("\n");
  var problem = job.problems.length > 0 ? "Yes" : "No";
  for (i = 0; i < rows.length; i++) {
    rows[i].lookupLog = log;
    rows[i].lookupProblem = problem;
    if (job.isTestRun) rows[i].title = "[TEST " + job.code + "] " + rows[i].title;
  }
  return rows;
};

/* ---------- small shared tools ---------- */

MiloBarcode.OFF_FIELDS = "code,product_type,product_name,product_name_en,generic_name,generic_name_en," +
  "brands,quantity,categories,ingredients_text,ingredients_text_en,image_front_url,image_front_small_url";
MiloBarcode.OFF_SOURCE = { food: "Open Food Facts", beauty: "Open Beauty Facts", petfood: "Open Pet Food Facts", product: "Open Products Facts" };
MiloBarcode.OFF_SITE = { food: "openfoodfacts.org", beauty: "openbeautyfacts.org", petfood: "openpetfoodfacts.org", product: "openproductsfacts.org" };
MiloBarcode.OFF_TYPE = { food: "Food & drink", beauty: "Beauty & personal care", petfood: "Pet food", product: "Other product" };

MiloBarcode.problem = function (job, message) {
  job.problems.push(message);
  job.log.push("PROBLEM - " + message);
};

MiloBarcode.problemRow = function (message) {
  return { title: "Problem: " + message, desc: "Information only - this row has no product data", id: "problem:0" };
};

MiloBarcode.replyFacts = function (reply) {
  return "HTTP " + reply.code + ", " + reply.text.length + " characters";
};

MiloBarcode.replyTail = function (reply) {
  return reply.error ? "" : " - " + MiloBarcode.replyFacts(reply) + ", starts: " + MiloWeb.preview(reply.text);
};

MiloBarcode.read = function (entry, fieldName) {
  try {
    return MiloBarcode.text(entry.field(fieldName));
  } catch (e) {
    return "";
  }
};

MiloBarcode.now = function () {
  var d = new Date();
  var two = function (n) { return (n < 10 ? "0" : "") + n; };
  return two(d.getDate()) + "/" + two(d.getMonth() + 1) + "/" + d.getFullYear() + " " + two(d.getHours()) + ":" + two(d.getMinutes());
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
