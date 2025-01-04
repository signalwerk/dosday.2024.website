# dostag.ch – scrape 2024

At the end run `npm run build:post` to move the files to the dist folder.

<!-- readme-start -->

## Website Scraper

A configurable web scraper with a visual interface to monitor and control the scraping process.

### Quick Start

1. Install dependencies:

```sh
  npm install
```

2. Start the application:

```sh
  npm run dev
```

This launches both the server (port 3000) and client interface.

### How it Works

The scraper operates using 4 sequential queues:

- Request Queue: Validates and initiates new URL requests
- Fetch Queue: Downloads content from validated URLs
- Parse Queue: Processes downloaded content
- Write Queue: Saves processed content to disk

#### Frontend Controls

The frontend interface allows you to:

- Start a new scrape: "Download to Cache" button
- Write cached content: "Write from Cache to Output" button
- Monitor active jobs in each queue
- View job history and details
- Filter and search through completed jobs
- Clear history and cache

### Queue Modules

Each queue module performs a specific task and can be configured.
The queues process jobs sequentially, with each module performing specific validation or transformation tasks. Failed jobs can be monitored and retried through the frontend interface.

The following modules are available:

#### Request Queue

- `isDomainValid`: Checks if URL matches allowed domains
- `isPathValid`: Validates URL path against rules
- `isAlreadyRequested`: Prevents duplicate requests
- `addFetchJob`: Adds URL to fetch queue

#### Fetch Queue

- `isCached`: Checks if content already exists in cache
- `fetchHttp`: Downloads content from URL
- `addParseJob`: Queues content for parsing

#### Parse Queue

- `guessMimeType`: Determines content type
- `parseFiles`: Processes content based on type

#### Write Queue

- `isAlreadyWritten`: Prevents duplicate writes
- `handleRedirected`: Manages redirected URLs
- `writeOutput`: Saves processed content to disk
