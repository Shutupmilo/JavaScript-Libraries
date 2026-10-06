/* milo-web.js  v1.0  2026-10-06
   MiloWeb: web requests for Memento scripts that never fail silently.
   Needs: the calling library's Network permission.

   Use:   var reply = MiloWeb.getJson(url, headers);
          reply.code  = the HTTP status (0 when nothing answered)
          reply.json  = the reply as data, or null when it was not readable JSON
          reply.text  = the raw reply text ("" when there was none)
          reply.error = "" when a reply arrived, otherwise what went wrong

          MiloWeb.describe("Source name", reply) turns a failed reply into one
          plain sentence for a Problem row.

   Defines one global name (MiloWeb) and runs nothing when Memento loads it. */

var MiloWeb = {

  version: "1.0",

  getJson: function (url, headers) {
    var reply = { code: 0, json: null, text: "", error: "" };
    try {
      var client = MiloWeb.newClient(headers);
      var response = MiloWeb.followRedirects(client, url, client.get(url));
      reply.code = Number(response.code);
      reply.text = (response.body === null || response.body === undefined) ? "" : String(response.body);
      reply.json = MiloWeb.parseJson(reply.text);
    } catch (e) {
      MiloWeb.readThrownStatus(reply, e);
    }
    return reply;
  },

  describe: function (sourceName, reply) {
    if (reply.error) return sourceName + ": " + reply.error;
    if (reply.code === 200 && reply.json === null) {
      return sourceName + ": the reply could not be read (it starts: " + MiloWeb.preview(reply.text) + ")";
    }
    if (reply.code === 429 || reply.code === 503) {
      return sourceName + ": busy (HTTP " + reply.code + ") - try again in a minute";
    }
    return sourceName + ": answered HTTP " + reply.code;
  },

  newClient: function (headers) {
    var client = http();
    /* Ask for uncompressed replies: a compressed reply may not be unpacked on the phone. */
    var all = { "Accept-Encoding": "identity" };
    var name;
    if (headers) {
      for (name in headers) {
        if (headers.hasOwnProperty(name)) all[name] = headers[name];
      }
    }
    try {
      client.headers(all);
    } catch (e) {
      /* This Memento build refused custom headers; the request still works without them. */
    }
    return client;
  },

  followRedirects: function (client, url, response) {
    /* Open Food Facts sends beauty, pet food and other products on to their own site. */
    var hops = 0;
    while (response && MiloWeb.isRedirect(Number(response.code)) && hops < 3) {
      var next = MiloWeb.header(response, "Location");
      if (next === "") break;
      if (next.charAt(0) === "/") next = url.replace(/^(https?:\/\/[^\/]+).*$/, "$1") + next;
      response = client.get(next);
      hops++;
    }
    return response;
  },

  readThrownStatus: function (reply, error) {
    /* Some HTTP clients throw on 404 or 400 instead of returning the code. */
    var message = MiloWeb.safeMessage(error);
    var found = /response code:?\s*([0-9]{3})/i.exec(message);
    if (found) {
      reply.code = Number(found[1]);
    } else if (/FileNotFound/i.test(message)) {
      reply.code = 404;
    } else {
      reply.error = "no answer (" + message + ") - check the library's Network permission";
    }
  },

  safeMessage: function (error) {
    /* Web addresses can carry tokens after the "?", so never show that part. */
    var message = MiloWeb.oneLine(error && error.message ? error.message : error);
    message = message.replace(/\?[^\s)]*/g, "?...");
    return MiloWeb.cut(message, 120);
  },

  preview: function (text) {
    var shown = "";
    var i;
    for (i = 0; i < text.length && i < 40; i++) {
      var c = text.charCodeAt(i);
      shown += (c >= 32 && c < 127) ? text.charAt(i) : "?";
    }
    if (text.length > 0 && text.charCodeAt(0) === 31) shown += " - looks compressed";
    return shown === "" ? "nothing" : shown;
  },

  parseJson: function (text) {
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  },

  header: function (response, name) {
    var value = "";
    try { value = MiloWeb.oneLine(response.header(name)); } catch (e1) { value = ""; }
    if (value === "") {
      try { value = MiloWeb.oneLine(response.header(name.toLowerCase())); } catch (e2) { value = ""; }
    }
    return value === "null" ? "" : value;
  },

  isRedirect: function (code) {
    return code === 301 || code === 302 || code === 303 || code === 307 || code === 308;
  },

  oneLine: function (value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
  },

  cut: function (text, max) {
    return text.length > max ? text.substring(0, max - 3) + "..." : text;
  }
};
