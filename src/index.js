import { WebServer } from "../packages/scrape-helpers/src/server/server.js";
import { getRelativeURL } from "../packages/scrape-helpers/src/server/utils/getRelativeURL.js";
import { DataPatcher } from "../packages/scrape-helpers/src/server/utils/DataPatcher.js";

import {
  isDomainValid,
  isPathValid,
} from "../packages/scrape-helpers/src/server/processor/request.js";
import { isAlreadyRequested } from "../packages/scrape-helpers/src/server/processor/general.js";
import {
  addParseJob,
  guessMimeType,
  parseFiles,
} from "../packages/scrape-helpers/src/server/processor/parse.js";
import { addFetchJob } from "../packages/scrape-helpers/src/server/processor/fetch.js";
import {
  isCached,
  fetchHttp,
} from "../packages/scrape-helpers/src/server/processor/fetch.js";
import {
  handleRedirected,
  writeOutput,
} from "../packages/scrape-helpers/src/server/processor/write.js";

const dataPatcher = new DataPatcher();

// Configure data patcher rules
// change content that is different for each request

dataPatcher
  .addRule({
    includes: [/.*/],
    search: /"(wgRequestId|cputime|walltime|timestamp)":"[^"]*"/g,
    replace: `"$1":""`,
  })
  .addRule({
    includes: [/.*/],
    search: /"(timingprofile)":\[[^\]]*\]/gm,
    replace: `"$1":[]`,
  })
  .addRule({
    includes: [/.*/],
    search: /"(wgBackendResponseTime)":[0-9]+/g,
    replace: `"$1":0`,
  })
  .addRule({
    includes: [/.*/],
    search: /(mw.loader.implement\("user.tokens@)[^"]+"/g,
    replace: `$10000000"`,
  });

// Create server instance
const server = new WebServer({
  urls: ["https://dostag.ch"],
  dataPatcher,
});

// Configure queue processors
server.configureQueues({
  request: [
    isDomainValid({
      allowed: [/^([a-z0-9-]+\.)*dostag\.ch$/i],
    }),
    isPathValid({
      disallowed: [
        /.*(Diskussion|action=|Spezial|Benutzer.*oldid|Hauptseite.*oldid|title=.*oldid|printable=yes).*/i,
      ],
    }),
    isAlreadyRequested({
      tracker: "requestTracker",
    }),
    addFetchJob(),
  ],
  fetch: [isCached(), fetchHttp(), addParseJob()],
  parse: [guessMimeType(), parseFiles()],
  write: [
    isAlreadyRequested({
      tracker: "writeTracker",
    }),
    handleRedirected(),
    guessMimeType(),
    writeOutput({
      getUrl: ({ absoluteUrl, baseUrl }) =>
        getRelativeURL(absoluteUrl, baseUrl, true, false, true),
      rewrite: {
        ["text/html"]: ($) => {
          // Traverse the DOM and remove soeme comment nodes
          $("*")
            .contents()
            .each(function () {
              if (
                this.type === "comment" &&
                (this.data.includes("Saved in parser cache with") ||
                  this.data.includes("NewPP limit report"))
              ) {
                $(this).remove();
              }
            });

          $(".wiki-no-archive").remove(); // hand-curated elements to remove

          $("#footer-icons").remove(); // remove footer mediawiki icon
          $("#footer-places").remove(); // remove «Datenschutz | Über DDOS | Haftungsausschluss»

          $(".mw-editsection").remove(); // remove edit links
          $(".printfooter").remove(); // remove footer in print view

          $('link[type="application/x-wiki"]').remove(); // remove feeds
          $('link[type="application/rsd+xml"]').remove(); // remove feeds
          $('link[type="application/atom+xml"]').remove(); // remove feeds
          $('link[type="application/opensearchdescription+xml"]').remove(); // remove feeds

          $("#n-recentchanges").remove(); // remove «Letzte Änderungen»
          $("#n-randompage").remove(); // remove «Zufällige Seite»
          $("#n-help-mediawiki, #n-help").remove(); // remove «Hilfe zu MediaWiki»  1.39.1, v1.31.0
          $("#p-tb").remove(); // remove «Werkzeuge»

          $("#right-navigation").remove(); // remove «Lesen | Bearbeiten | Versionsgeschichte | Search»
          $("#left-navigation").remove(); // remove «$page | Diskussion»

          $("#mw-head").remove(); // remove «Nicht angemeldet | Diskussionsseite | Beiträge | Benutzerkonto erstellen | Anmelden»

          // remove some js comming from loader/modules
          $('script[src^="/load.php"]').remove();

          // remove links to creat new pages
          $("a.new").each(function () {
            $(this).replaceWith($(this).text());
          });

          // remove «(Diskussion | Beiträge)» form user links (on media/image pages)
          $(".mw-usertoollinks").remove();
        },
      },
    }),
  ],
});

// Start the server
server.start(3000);
