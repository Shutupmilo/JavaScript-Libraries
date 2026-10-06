/* milo-secrets.js  v1.0  2026-10-06
   MiloSecrets: reads private values from your Memento "Secrets" library,
   so no script and no GitHub file ever holds them.
   Needs: in the calling library, Automations > Scripts > shield icon >
          Libraries > tick "Secrets".

   Use:   var email = MiloSecrets.get("OFF_CONTACT_EMAIL");
          Returns the entry's "Secret value" as text, or "" when it can't.
          When it returns "", MiloSecrets.problem says why. It never
          contains the value itself.

   Defines one global name (MiloSecrets) and runs nothing when Memento loads it. */

var MiloSecrets = {

  version: "1.0",
  libraryName: "Secrets",
  nameField: "Secret name",
  valueField: "Secret value",
  problem: "",

  get: function (secretName) {
    MiloSecrets.problem = "";
    var library = MiloSecrets.openLibrary();
    if (!library) return "";
    var entry = MiloSecrets.findEntry(library, secretName);
    if (!entry) {
      MiloSecrets.problem = "the " + MiloSecrets.libraryName + " library has no entry named " + secretName;
      return "";
    }
    var value = entry.field(MiloSecrets.valueField);
    if (value === null || value === undefined || String(value) === "") {
      MiloSecrets.problem = "the entry " + secretName + " has an empty " + MiloSecrets.valueField;
      return "";
    }
    return String(value);
  },

  openLibrary: function () {
    var library = null;
    try {
      library = libByName(MiloSecrets.libraryName);
    } catch (e) {
      library = null;
    }
    if (!library) {
      MiloSecrets.problem = "can't open the " + MiloSecrets.libraryName +
        " library - tick it under this library's script permissions (Libraries)";
    }
    return library;
  },

  findEntry: function (library, secretName) {
    /* findByKey finds an entry by its name (proven on the phone in Test S2, 06/10/2026).
       The loop is a fallback in case a Memento build lacks findByKey. */
    try {
      var byKey = library.findByKey(secretName);
      if (byKey) return byKey;
    } catch (e) {
      /* fall through to the loop */
    }
    var entries = library.entries();
    var i;
    for (i = 0; i < entries.length; i++) {
      if (String(entries[i].field(MiloSecrets.nameField)) === secretName) return entries[i];
    }
    return null;
  }
};
