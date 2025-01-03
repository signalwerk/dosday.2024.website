import { WebServer } from "../packages/scrape-helpers/src/server/server.js";
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
});

// Configure queue processors
server.configureQueues({
  request: [
    async ({ job, context }, next) =>
      await isDomainValid(
        {
          job,
          allowed: [/^([a-z0-9-]+\.)*dostag\.ch$/i],
        },
        next,
      ),
    async ({ job, context }, next) =>
      await isPathValid(
        {
          job,
          disallowed: [
            /.*(Diskussion|action=|Spezial|Benutzer.*oldid|Hauptseite.*oldid|title=.*oldid|printable=yes).*/i,
          ],
        },
        next,
      ),
    async ({ job, context }, next) =>
      await isAlreadyRequested(
        {
          job,
          tracker: context.requestTracker,
        },
        next,
      ),
    async ({ job, context }, next) =>
      await addFetchJob(
        {
          job,
          createFetchJob: (fetchJobData) =>
            context.events?.emit("createFetchJob", fetchJobData),
        },
        next,
      ),
  ],
  fetch: [
    async ({ job, context }, next) =>
      await isCached(
        {
          job,
          createRequestJob: (requestJobData) =>
            context.events?.emit("createRequestJob", requestJobData),
          cache: context.cache,
        },
        next,
      ),
    async ({ job, context }, next) =>
      await fetchHttp(
        {
          job,
          cache: context.cache,
          createRequestJob: (requestJobData) =>
            context.events?.emit("createRequestJob", requestJobData),
        },
        next,
      ),
    async ({ job, context }, next) =>
      await addParseJob(
        {
          job,
          createParseJob: (parseJobData) =>
            context.events?.emit("createParseJob", parseJobData),
        },
        next,
      ),
  ],
  parse: [
    async ({ job, context }, next) =>
      await guessMimeType(
        // adds mimeType to job.data
        {
          job,
          cache: context.cache,
        },
        next,
      ),
    async ({ job, context }, next) => {
      const { data: dataFromCache, metadata } = context.cache.get(
        job.data.cache.key,
      );

      const data = context.dataPatcher.patch(
        job.data.uri,
        `${dataFromCache}`,
        (log) => job.log(log),
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
          await parseHtml({ job, events: context.events, data }, next);
          break;
        }
        case "text/css": {
          await parseCss({ job, events: context.events, data }, next);
          break;
        }
        default: {
          // we don't need to parse the other mime types
          break;
        }
      }

      next();
    },
  ],
  write: [
    async ({ job, context }, next) =>
      await isAlreadyRequested(
        {
          job,
          tracker: context.writeTracker,
        },
        next,
      ),
    async ({ job, context }, next) =>
      await handleRedirected(
        {
          job,
          cache: context.cache,
          createWriteJob: (writeJobData) =>
            context.events?.emit("createWriteJob", writeJobData),
        },
        next,
      ),

    async ({ job, context }, next) =>
      await guessMimeType(
        // adds mimeType to job.data
        {
          job,
          cache: context.cache,
        },
        next,
      ),
    async ({ job, context }, next) => {
      const { data: dataOrignal, metadata } = context.cache.get(
        job.data.cache.key,
      );

      let data = dataOrignal;

      const mime = job.data.mimeType;

      if (mime === "text/html") {
        data = context.dataPatcher.patch(job.data.uri, data, (log) =>
          job.log(log),
        );

        const $ = cheerio.load(data);

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
            cache: context.cache,
            getUrl: ({ absoluteUrl, baseUrl }) =>
              getRelativeURL(absoluteUrl, baseUrl, true, false, true),
            createWriteJob: (writeJobData) =>
              context.events?.emit("createWriteJob", writeJobData),
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
        data = context.dataPatcher.patch(job.data.uri, data, (log) =>
          job.log(log),
        );

        data = await rewriteCss({
          content: data,
          job,
          mime,
          cache: context.cache,
          getUrl: ({ absoluteUrl, baseUrl }) =>
            getRelativeURL(absoluteUrl, baseUrl, true, false, true),
          createWriteJob: (writeJobData) =>
            context.events?.emit("createWriteJob", writeJobData),
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
