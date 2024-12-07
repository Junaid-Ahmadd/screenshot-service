import { chromium } from 'playwright';
import { CrawlerQueue } from '../lib/crawler.js';

let browser = null;

async function initBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      args: ['--no-sandbox']
    });
  }
  return browser;
}

export default async function (context, req) {
  context.log('Processing crawler request');

  if (!req.body || !req.body.url) {
    return {
      status: 400,
      body: "Please provide a URL in the request body"
    };
  }

  const startUrl = req.body.url;
  const maxDepth = req.body.maxDepth || 3;
  const maxPages = req.body.maxPages || 20;

  try {
    const browser = await initBrowser();
    const context = await browser.newContext();
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
        const page = await context.newPage();
        await page.goto(next.url, { waitUntil: 'networkidle', timeout: 30000 });

        // Take screenshot
        if (crawler.needsScreenshot(next.url)) {
          const screenshot = await page.screenshot({
            fullPage: true,
            type: 'jpeg',
            quality: 80
          });
          
          results.screenshots.push({
            url: next.url,
            depth: next.depth,
            data: screenshot.toString('base64')
          });
          
          crawler.markScreenshotTaken(next.url);
        }

        // Extract links
        const links = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(href => href.startsWith('http'));
        });

        for (const link of links) {
          if (crawler.isValidUrl(link)) {
            crawler.addToQueue(link, next.depth + 1);
            results.links.push({
              url: link,
              depth: next.depth + 1,
              parent: next.url
            });
          }
        }

        await page.close();
        crawler.markAsProcessed(next.url);
        processedPages++;

      } catch (error) {
        results.errors.push({
          url: next.url,
          error: error.message
        });
        crawler.markAsProcessed(next.url);
      }
    }

    await context.close();

    return {
      status: 200,
      body: results
    };

  } catch (error) {
    context.log.error('Crawler error:', error);
    return {
      status: 500,
      body: {
        error: "Internal server error",
        details: error.message
      }
    };
  }
}
