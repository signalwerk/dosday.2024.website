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
  isAlreadyRequested,
} from "../packages/scrape-helpers/src/server/processor/request.js";
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
} from "../packages/scrape-helpers/src/server/processor/write.js";

// Create instances of required components
const cache = new Cache();
const requestTracker = new RequestTracker();
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
  cache,
  dataPatcher,
  requestTracker,
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
            /.*(Diskussion|action|Spezial|Benutzer.*oldid|Hauptseite.*oldid|title=.*oldid|printable=yes).*/i,
          ],
        },
        next,
      ),
    async (job, next) =>
      await isAlreadyRequested(
        {
          job,
          requestTracker,
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

        await rewriteHtml(
          {
            job,
            cache,
            getKey: (url) => url,
            getUrl: ({ url, baseUrl }) =>
              getRelativeURL(url, baseUrl, true, false, true),
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
