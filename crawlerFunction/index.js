import { chromium } from 'playwright';
import { CrawlerQueue } from '../lib/crawler.js';

let browser = null;

async function initBrowser() {
  try {
    if (!browser) {
      console.log('Launching browser...');
      browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      console.log('Browser launched successfully');
    }
    return browser;
  } catch (error) {
    console.error('Failed to launch browser:', error);
    throw error;
  }
}

export default async function (context, req) {
  context.log('Starting crawler function');

  try {
    if (!req.body || !req.body.url) {
      context.log.error('No URL provided in request body');
      return {
        status: 400,
        body: { error: "Please provide a URL in the request body" }
      };
    }

    const startUrl = req.body.url;
    const maxDepth = req.body.maxDepth || 3;
    const maxPages = req.body.maxPages || 20;

    context.log(`Processing request for URL: ${startUrl}, maxDepth: ${maxDepth}, maxPages: ${maxPages}`);

    const browser = await initBrowser();
    context.log('Browser initialized');

    const browserContext = await browser.newContext();
    context.log('Browser context created');

    const crawler = new CrawlerQueue(5, maxDepth);
    crawler.setBaseUrl(startUrl);

    const results = {
      screenshots: [],
      links: [],
      errors: []
    };

    let processedPages = 0;
    crawler.addToQueue(startUrl, 0);

    while (crawler.canProcess() && processedPages < maxPages) {
      const next = crawler.getNext();
      if (!next) break;

      try {
        context.log(`Processing page ${processedPages + 1}/${maxPages}: ${next.url}`);
        const page = await browserContext.newPage();
        
        await page.goto(next.url, { 
          waitUntil: 'networkidle',
          timeout: 30000 
        });

        // Take screenshot
        const screenshot = await page.screenshot({
          type: 'jpeg',
          quality: 80,
          fullPage: true
        });

        results.screenshots.push({
          url: next.url,
          depth: next.depth,
          data: screenshot.toString('base64')
        });

        // Extract links
        const links = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a'))
            .map(a => a.href)
            .filter(href => href && !href.startsWith('javascript:'));
        });

        for (const link of links) {
          if (crawler.isValidUrl(link)) {
            const normalizedUrl = crawler.normalizeUrl(link);
            if (normalizedUrl) {
              crawler.addToQueue(normalizedUrl, next.depth + 1);
              if (!results.links.includes(normalizedUrl)) {
                results.links.push(normalizedUrl);
              }
            }
          }
        }

        await page.close();
        processedPages++;
      } catch (error) {
        context.log.error(`Error processing ${next.url}: ${error.message}`);
        results.errors.push({
          url: next.url,
          error: error.message
        });
      }
    }

    await browserContext.close();
    context.log('Crawler completed successfully');

    return {
      status: 200,
      body: results
    };
  } catch (error) {
    context.log.error('Function failed:', error);
    return {
      status: 500,
      body: { 
        error: "Internal server error",
        details: error.message
      }
    };
  }
}
