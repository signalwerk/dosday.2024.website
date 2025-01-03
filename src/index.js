import { WebServer } from "../packages/scrape-helpers/src/server/server.js";
import { Cache } from "../packages/scrape-helpers/src/server/utils/Cache.js";
import { RequestTracker } from "../packages/scrape-helpers/src/server/utils/RequestTracker.js";
import { DataPatcher } from "../packages/scrape-helpers/src/server/utils/DataPatcher.js";
import { getRelativeURL } from "../packages/scrape-helpers/src/server/utils/getRelativeURL.js";
import { getMimeWithoutEncoding } from "../packages/scrape-helpers/src/server/utils/mime.js";
import prettier from "prettier";
import * as cheerio from "cheerio";

import {
  isDomainValid,
  isPathValid,
} from "../packages/scrape-helpers/src/server/processor/request.js";
import { isAlreadyRequested } from "../packages/scrape-helpers/src/server/processor/general.js";
import {
  addParseJob,
  guessMimeType,
  parseHtml,
  parseCss,
} from "../packages/scrape-helpers/src/server/processor/parse.js";
import { addFetchJob } from "../packages/scrape-helpers/src/server/processor/fetch.js";
import {
  isCached,
  fetchHttp,
} from "../packages/scrape-helpers/src/server/processor/fetch.js";
import {
  writeData,
  handleRedirected,
  rewriteHtml,
  rewriteCss,
} from "../packages/scrape-helpers/src/server/processor/write.js";

// Create instances of required components
const cache = new Cache();
const requestTracker = new RequestTracker();
const writeTracker = new RequestTracker();
const dataPatcher = new DataPatcher();

// Configure data patcher rules
// dataPatcher
//   //  .addRule()
//   .addRule({
//     includes: ["https://example.com/style.css"],
//     search: "hello",
//     replace: "world",
//   });

// Create server instance
const server = new WebServer({
  urls: ["https://dostag.ch"],
  cache,
  dataPatcher,
  requestTracker,
  writeTracker,
  requestConcurrency: 100,
  fetchConcurrency: 10,
  parseConcurrency: 100,
});

// Configure queue processors
server.configureQueues({
  request: [
    async (job, next) =>
      await isDomainValid(
        {
          job,
          allowed: [/^([a-z0-9-]+\.)*dostag\.ch$/i],
        },
        next,
      ),
    async (job, next) =>
      await isPathValid(
        {
          job,
          disallowed: [
            /.*(Diskussion|action=|Spezial|Benutzer.*oldid|Hauptseite.*oldid|title=.*oldid|printable=yes).*/i,
          ],
        },
        next,
      ),
    async (job, next) =>
      await isAlreadyRequested(
        {
          job,
          tracker: requestTracker,
          getKey: (job) => job.data.uri,
        },
        next,
      ),
    async (job, next) =>
      await addFetchJob(
        {
          job,
          events: server.events,
        },
        next,
      ),
  ],
  fetch: [
    async (job, next) =>
      await isCached(
        {
          job,
          events: server.events,
          cache,
          getKey: (job) => job.data.uri,
        },
        next,
      ),
    async (job, next) =>
      await fetchHttp(
        {
          job,
          cache,
          events: server.events,
        },
        next,
      ),
    async (job, next) =>
      await addParseJob(
        {
          job,
          events: server.events,
        },
        next,
      ),
  ],
  parse: [
    async (job, next) =>
      await guessMimeType(
        {
          job,
          cache,
        },
        next,
      ),
    async (job, next) => {
      const { data: dataFromCache, metadata } = cache.get(job.data.cache.key);

      const data = dataPatcher.patch(job.data.uri, `${dataFromCache}`, (log) =>
        job.log(log),
      );

      if (!data || !metadata) {
        throw new Error(
          `No data or metadata found in cache ${job.data.cache.key}`,
        );
      }

      const mimeType = job.data.mimeType;

      switch (mimeType) {
        case "application/xhtml+xml":
        case "text/html": {
          await parseHtml({ job, events: server.events, data }, next);
          break;
        }
        case "text/css": {
          await parseCss({ job, events: server.events, data }, next);
          break;
        }
        case "application/javascript":
        //
        case "text/plain":
        case "image/png":
        case "image/jpeg":
        case "image/jpg":
        case "image/gif":
        case "image/webp":
        case "image/svg+xml":
        case "image/avif":
        case "image/apng":
        case "image/bmp":
        case "image/tiff":
        case "image/x-icon":
        case "text/xml":
        case "image/vnd.microsoft.icon":
        case "application/vnd.oasis.opendocument.text":
        case "application/pdf":
        case "application/json":
        case "application/x-font-ttf":
        case "font/ttf":
        case "font/woff":
        case "font/woff2":
        case "application/vnd.ms-fontobject": // eot
        case "application/rss+xml":
        case "application/atom+xml":
        case "application/rdf+xml":
        case "application/rss+xml":
        case "application/rdf+xml":
        case "application/x-rss+xml":
        case "application/xml":
        case "application/x-www-form-urlencoded":
        case "application/x-shockwave-flash":
        case "application/epub+zip": {
          // we don't need to parse these
          break;
        }
        default: {
          throw new Error(
            `Unsupported content type: ${
              metadata.headers["content-type"] || "undefined"
            }`,
          );
        }
      }

      next();
    },
  ],
  write: [
    async (job, next) =>
      await isAlreadyRequested(
        {
          job,
          tracker: writeTracker,
          getKey: (job) => job.data.uri,
        },
        next,
      ),
    async (job, next) =>
      await handleRedirected(
        {
          job,
          events: server.events,
          cache,
          getKey: (job) => job.data.uri,
        },
        next,
      ),
    async (job, next) => {
      const { data: dataOrignal, metadata } = cache.get(job.data.cache.key);

      let data = dataOrignal;

      const mime = getMimeWithoutEncoding(metadata.headers["content-type"]);

      if (mime === "text/html") {
        const $ = cheerio.load(dataOrignal);

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
        $("#left-navigation").remove(); // remove «Hauptseite | Diskussion»

        $("#mw-head").remove(); // remove «Nicht angemeldet | Diskussionsseite | Beiträge | Benutzerkonto erstellen | Anmelden»

        // remove some js comming from loader/modules
        $('script[src^="/load.php"]').remove();

        // remove links to creat new pages
        $("a.new").each(function () {
          $(this).replaceWith($(this).text());
        });

        // remove «(Diskussion | Beiträge)» form user links (on media/image pages)
        $(".mw-usertoollinks").remove();

        await rewriteHtml(
          {
            job,
            mime,
            cache,
            getKey: (url) => url,
            getUrl: ({ absoluteUrl, baseUrl }) =>
              getRelativeURL(absoluteUrl, baseUrl, true, false, true),
            events: server.events,
            $,
          },
          next,
        );

        data = $.html();

        try {
          data = await prettier.format(data, { parser: "html" });
        } catch (error) {
          throw new Error(`Error formatting HTML: ${error}`);
        }
      }

      if (mime === "text/css") {
        data = await rewriteCss({
          content: data,
          job,
          mime,
          cache,
          getKey: (url) => url,
          getUrl: ({ absoluteUrl, baseUrl }) =>
            getRelativeURL(absoluteUrl, baseUrl, true, false, true),
          events: server.events,
        });

        try {
          data = await prettier.format(`${data}`, { parser: "css" });
        } catch (error) {
          throw new Error(`Error formatting CSS: ${error}`);
        }
      }

      await writeData(
        {
          job,
          data,
          metadata,
        },
        next,
      );
    },
  ],
});

// Start the server
server.start(3000);
