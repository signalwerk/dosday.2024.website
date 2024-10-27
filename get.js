#!/usr/bin/env node

import { queue } from "./packages/scrape-helpers/src/queue.js";
import process from "process";
import { fileURLToPath } from "url";
import { dirname } from "path";
import path from "path";
import prettier from "prettier";
import * as cheerio from "cheerio";
import fs from "fs";
import { adjustCSSpaths } from "./packages/scrape-helpers/src/css/adjustCSSpaths.js";
import { fixFilename } from "./packages/scrape-helpers/src/cleanups/fixFilename.js";
import { getNewUrl } from "./packages/scrape-helpers/src/cleanups/getNewUrl.js";

const PROTOCOL = "https";
const DOMAIN = "dostag.ch";
const allowDomains = ["unpkg.com"];

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DATA_FOLDER = path.join(__dirname, "DATA");

// Get command line arguments
const args = process.argv.slice(2);

const normalizeOptions = {
  enforceHttps: true,
  removeTrailingSlash: true,
  removeHash: true,
  searchParameters: "keep", // "remove",
};

async function runQueue() {
  console.log("Scraping...");

  const HTML_DIR = path.join(DATA_FOLDER, "html");
  const DOWNLOAD_FILE = path.join(DATA_FOLDER, "download.json");
  const LOG_FILE = path.join(DATA_FOLDER, "dl.log");

  const response = await queue({
    toDownload: [`${PROTOCOL}://${DOMAIN}/`],
    typesToDownload: ["html", "image", "stylesheet", "script", "icon"],
    downloadedFile: DOWNLOAD_FILE,
    logFile: LOG_FILE,
    downloadDir: HTML_DIR,
    allowDomains: [DOMAIN, ...allowDomains],
    disallowDomains: [],
    normalizeOptions,
    rejectRegex:
      ".*(Diskussion|action|Spezial|Benutzer.*oldid|Hauptseite.*oldid|title=.*oldid).*",
    includeRegex: ".*(load.php|resources/).*",
    process: {
      ["text/html"]: async ({ url, path }) => {
        // change content that is different for each request

        // example:
        // "wgRequestId":"ZPchjOTAYiLjttz0qQ7NtQADnR4"
        // "cputime":"0.012"
        // "walltime":"0.015"
        // "timestamp":"20230902192625"
        // "wgBackendResponseTime":103

        let newContent = fs.readFileSync(path, "utf8");
        const matchString =
          /"(wgRequestId|cputime|walltime|timestamp)":"[^"]*"/g;
        newContent = newContent.replace(matchString, `"$1":""`);

        const matchArray = /"(timingprofile)":\[[^\]]*\]/gm;
        newContent = newContent.replace(matchArray, `"$1":[]`);

        const matchNumber = /"(wgBackendResponseTime)":[0-9]+/g;
        newContent = newContent.replace(matchNumber, `"$1":0`);

        fs.writeFileSync(path, newContent);
      },
    },
    postProcess: {
      ["text/css"]: async ({
        downloadedFile,
        downloadedFiles,
        appendToLog,
      }) => {
        const content = fs.readFileSync(downloadedFile.path, "utf8");
        const formattedCss = await adjustCSSpaths({
          downloadedFile,
          downloadedFiles,
          content,
          appendToLog,
        });
        fs.writeFileSync(downloadedFile.path, formattedCss);
      },
      ["text/html"]: async ({
        downloadedFile,
        downloadedFiles,
        appendToLog,
      }) => {
        const content = fs.readFileSync(downloadedFile.path, "utf8");
        const $ = cheerio.load(content);

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
        $("#p-tb").remove(); // remvoe «Werkzeuge»

        $("#right-navigation").remove(); // remove «Hauptseite | Diskussion»
        $("#left-navigation").remove(); // remvoe «Lesen | Bearbeiten | Versionsgeschichte | Search»
        $("#mw-head").remove(); // remove «Nicht angemeldet | Diskussionsseite | Beiträge | Benutzerkonto erstellen | Anmelden»

        // remove some js comming from loader/modules
        $('script[src^="/load.php"]').remove();

        // remove links to creat new pages
        $("a.new").each(function () {
          $(this).replaceWith($(this).text());
        });

        // remove «(Diskussion | Beiträge)» form user links
        $(".mw-usertoollinks").remove();

        const fix = (url) =>
          getNewUrl({
            url,
            refferer: downloadedFile.url,
            downloadedFiles: downloadedFiles,
            appendToLog,
          });

        const fixButKeepHash = (url) => {
          let hash = "";
          if (url.includes("#")) {
            const parts = url.split("#");
            url = parts[0];
            hash = "#" + parts[1];
          }
          return fix(url) + hash;
        };

        fixFilename($, "a", "href", fixButKeepHash);
        fixFilename($, "img", "src", fix);
        fixFilename($, "img", "srcset", fix);
        fixFilename($, "source", "srcset", fix);
        fixFilename($, "script", "src", fix);
        fixFilename($, "link[rel=stylesheet]", "href", fix);
        fixFilename($, "link[rel=icon]", "href", fix);
        fixFilename($, "link[rel=canonical]", "href", fix);
        fixFilename($, "link[rel=alternate]", "href", fix);

        const formattedHtml = await prettier.format($.html(), {
          parser: "html",
        });

        fs.writeFileSync(downloadedFile.path, formattedHtml);
      },
    },
  }); // wait for response
}

// Handle different cases using a switch statement
switch (args[0]) {
  case "--clear":
    console.log("Clearing...");
    fs.rmSync(DATA_FOLDER, { recursive: true, force: true });
    break;
  case "--dl":
    runQueue();
    break;
  case "--help":
    console.log("Usage: node cli.js [options]");
    console.log("");
    console.log("Options:");
    console.log("  --clear     Delete the data folder");
    console.log("  --dl        Download all files from domain");
    console.log("  --help      Show help");
    break;
  default:
    console.log("Unknown option. Use --help for available options.");
    break;
}
