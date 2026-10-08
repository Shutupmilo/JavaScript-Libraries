/* milo-products.js  v1.0  2026-10-08
   MiloProducts: the "Barcode Products" master library (one entry per barcode), and
   keeping every library that scans barcodes in step with it.
   Needs: the script's Libraries permission must tick "Barcode Products" and every
          library listed in MiloProducts.libraries below.

   Used inside Memento:
     Custom source in a scanning library   ownLibrary: MiloProducts.source()
         checks Barcode Products before any website
     Custom source in Barcode Products     ownLibrary: MiloProducts.source(true)
         says "Already in Barcode Products" instead of making a duplicate
     Automation in a scanning library      MiloProducts.remember(entry());
         (Creating an entry + Updating an entry, both "After saving the entry")
         copies what you saved into Barcode Products, then updates every matching entry
     Automation in Barcode Products        MiloProducts.spread(entry());
         (Creating an entry + Updating an entry, both "After saving the entry")
         updates every entry with that barcode in every library listed below

   Rules: an empty field never wipes saved data; only fields that differ are changed,
   so an update can't bounce back and forth. A short message appears when something
   changed or went wrong; nothing appears when nothing needed changing.

   Defines one global name (MiloProducts) and runs nothing when Memento loads it. */

var MiloProducts = {

  version: "1.0",
  libraryName: "Barcode Products",
  barcodeField: "Barcode Text",

  /* Product property -> field name, in Barcode Products and (unless a library below
     says otherwise) in every scanning library. */
  fields: {
    name: "Name",
    brand: "Brand",
    size: "Size",
    category: "Category",
    type: "Type",
    ingredients: "Ingredients",
    description: "Description",
    imageLink: "Image Link",
    link: "Product Link",
    source: "Found In"
  },

  /* Every library that scans barcodes into this system. List only field names that
     differ from the ones above; "details" names a summary field to keep up to date. */
  libraries: [
    { name: "Autofill Barcode", barcodeField: "Barcode Text", details: "Details" }
  ],

  source: function (isThisLibrary) {
    return {
      name: MiloProducts.libraryName,
      label: MiloProducts.libraryName,
      barcodeField: MiloProducts.barcodeField,
      fields: MiloProducts.fields,
      isThisLibrary: isThisLibrary === true
    };
  },

  remember: function (entry, libraryName) {
    var notes = [];
    try {
      var setup = MiloProducts.setupFor(libraryName);
      var code = MiloProducts.codeOf(MiloProducts.read(entry, setup.barcodeField));
      if (code === "") return "";
      var values = MiloProducts.valuesOf(entry, setup.fields);
      if (values.source === MiloProducts.libraryName) delete values.source;
      if (!values.name || /^\(no name/.test(values.name)) {
        return MiloProducts.say(MiloProducts.libraryName + ": not saved - type a " + setup.fields.name + " first");
      }
      var products = MiloProducts.open(MiloProducts.libraryName);
      var product = MiloProducts.findAll(products, MiloProducts.barcodeField, code)[0];
      if (!product) {
        product = MiloProducts.create(products, code, values);
        notes.push(MiloProducts.libraryName + ": added " + values.name);
      } else {
        var changed = MiloProducts.copyInto(product, MiloProducts.fields, values);
        if (changed.length) notes.push(MiloProducts.libraryName + ": updated " + changed.join(", "));
      }
      if (notes.length) notes = notes.concat(MiloProducts.spreadValues(code, MiloProducts.valuesOf(product, MiloProducts.fields)));
    } catch (e) {
      notes.push(MiloProducts.libraryName + ": " + MiloProducts.problemText(e));
    }
    return MiloProducts.say(notes.join("\n"));
  },

  spread: function (product) {
    var notes = [];
    try {
      var code = MiloProducts.codeOf(MiloProducts.read(product, MiloProducts.barcodeField));
      if (code !== "") notes = MiloProducts.spreadValues(code, MiloProducts.valuesOf(product, MiloProducts.fields));
    } catch (e) {
      notes.push(MiloProducts.libraryName + ": " + MiloProducts.problemText(e));
    }
    return MiloProducts.say(notes.join("\n"));
  },

  spreadValues: function (code, values) {
    var notes = [];
    var i;
    for (i = 0; i < MiloProducts.libraries.length; i++) {
      var name = MiloProducts.libraries[i].name;
      try {
        var setup = MiloProducts.setupFor(name);
        var entries = MiloProducts.findAll(MiloProducts.open(name), setup.barcodeField, code);
        var updated = 0;
        var j;
        for (j = 0; j < entries.length; j++) {
          var changed = MiloProducts.copyInto(entries[j], setup.fields, values);
          if (setup.details && MiloProducts.setIfDifferent(entries[j], setup.details, MiloProducts.details(values))) changed.push(setup.details);
          if (changed.length) updated++;
        }
        if (updated) notes.push(name + ": updated " + updated + (updated === 1 ? " entry" : " entries"));
      } catch (e) {
        notes.push(name + ": " + MiloProducts.problemText(e));
      }
    }
    return notes;
  },

  /* ---------- small tools ---------- */

  setupFor: function (libraryName) {
    var setup = { barcodeField: MiloProducts.barcodeField, fields: MiloProducts.fields, details: "" };
    var i, p;
    for (i = 0; i < MiloProducts.libraries.length; i++) {
      var listed = MiloProducts.libraries[i];
      if (listed.name !== libraryName) continue;
      setup.barcodeField = listed.barcodeField || setup.barcodeField;
      setup.details = listed.details || "";
      if (listed.fields) {
        var merged = {};
        for (p in MiloProducts.fields) merged[p] = MiloProducts.fields[p];
        for (p in listed.fields) merged[p] = listed.fields[p];
        setup.fields = merged;
      }
    }
    return setup;
  },

  open: function (name) {
    var library = null;
    try { library = libByName(name); } catch (e) { library = null; }
    if (!library) throw new Error("can't open " + name + " - tick it under this script's permissions (Libraries)");
    return library;
  },

  findAll: function (library, fieldName, code) {
    /* find() is a text search across all fields, so keep only exact barcode matches. */
    var found = MiloProducts.listItems(library.find(code));
    var matches = [];
    var i;
    for (i = 0; i < found.length; i++) {
      if (MiloProducts.codeOf(MiloProducts.read(found[i], fieldName)) === code) matches.push(found[i]);
    }
    return matches;
  },

  create: function (library, code, values) {
    /* Plain text only: Memento rejects text joined with + (see milo-web.js 1.1). */
    var data = {};
    var p;
    data[MiloProducts.barcodeField] = String(code);
    for (p in values) {
      if (values.hasOwnProperty(p) && MiloProducts.fields[p]) data[String(MiloProducts.fields[p])] = String(values[p]);
    }
    return library.create(data);
  },

  copyInto: function (target, fieldMap, values) {
    var changed = [];
    var p;
    for (p in values) {
      if (values.hasOwnProperty(p) && fieldMap[p] && MiloProducts.setIfDifferent(target, fieldMap[p], values[p])) changed.push(fieldMap[p]);
    }
    return changed;
  },

  setIfDifferent: function (target, fieldName, value) {
    var wanted = String(value).replace(/^\s+|\s+$/g, "");
    if (wanted === "" || MiloProducts.read(target, fieldName) === wanted) return false;
    target.set(String(fieldName), wanted);
    return true;
  },

  valuesOf: function (entry, fieldMap) {
    var values = {};
    var p;
    for (p in fieldMap) {
      if (!fieldMap.hasOwnProperty(p)) continue;
      var value = MiloProducts.read(entry, fieldMap[p]);
      if (value !== "") values[p] = value;
    }
    return values;
  },

  details: function (v) {
    /* Same layout as MiloBarcode.details. */
    var lines = [];
    var labels = [["brand", "Brand"], ["size", "Size"], ["category", "Category"], ["type", "Type"],
                  ["ingredients", "Ingredients"], ["description", "Description"], ["source", "Found in"]];
    var i;
    for (i = 0; i < labels.length; i++) {
      if (v[labels[i][0]]) lines.push(labels[i][1] + ": " + v[labels[i][0]]);
    }
    return lines.join("\n");
  },

  read: function (entry, fieldName) {
    var value;
    try { value = entry.field(fieldName); } catch (e) { return ""; }
    if (value === null || value === undefined) return "";
    return String(value).replace(/^\s+|\s+$/g, "");
  },

  codeOf: function (text) {
    var digits = String(text).replace(/[^0-9]/g, "");
    return digits.length >= 8 ? digits : String(text).replace(/^\s+|\s+$/g, "");
  },

  problemText: function (e) {
    return e && e.message ? String(e.message) : String(e);
  },

  say: function (text) {
    if (text && typeof message === "function") message(text);
    return text;
  },

  listItems: function (list) {
    if (!list) return [];
    if (list.length !== undefined) return list;
    var items = [];
    var i;
    for (i = 0; i < list.size(); i++) items.push(list.get(i));
    return items;
  }
};
