import { chromium } from 'playwright-chromium';
import { CrawlerQueue } from '../lib/crawler.js';
import { readdirSync } from 'fs';
import { join } from 'path';

let browser = null;

async function initBrowser() {
  try {
    if (!browser) {
      console.log('Environment info:');
      console.log('Current directory:', process.cwd());
      console.log('Directory contents:', readdirSync(process.cwd()));
      console.log('Node version:', process.version);
      console.log('Platform:', process.platform);
      console.log('Arch:', process.arch);

      const browserPath = join(process.cwd(), '.playwright', 'browsers');
      console.log('Browser path:', browserPath);
      console.log('Browser directory contents:', readdirSync(browserPath));

      console.log('Launching browser...');
      browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
        chromiumSandbox: false,
        headless: true,
        executablePath: join(browserPath, 'chromium-1148', 'chrome-linux', 'chrome')
      });
      console.log('Browser launched successfully');
    }
    return browser;
  } catch (error) {
    console.error('Failed to launch browser. Error details:');
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error name:', error.name);
    if (error.code) console.error('Error code:', error.code);
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
    const maxDepth = req.body.maxDepth || 4;
    const maxPages = req.body.maxPages || 20;

    context.log('Request body:', req.body);
    context.log('Request parameters:', {
      url: startUrl,
      maxDepth: maxDepth,
      maxPages: maxPages
    });
    context.log(`Start URL: ${startUrl}, Max Depth: ${maxDepth}, Max Pages: ${maxPages}`);
    context.log(`Processing request for URL: ${startUrl}, maxDepth: ${maxDepth}, maxPages: ${maxPages}`);
    context.log('Environment:', {
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH,
      NODE_VERSION: process.version,
      PWD: process.cwd()
    });

    context.log('Initializing browser');
    const browser = await initBrowser();
    context.log('Browser initialized successfully');

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

        context.log(`Taking screenshot for URL: ${next.url}`);
        const screenshot = await page.screenshot({
          type: 'jpeg',
          quality: 80,
          fullPage: true
        });
        context.log(`Screenshot taken for ${next.url}`);
        context.log(`Screenshot saved for ${next.url}`);
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
        context.log.error('Error details:');
        context.log.error('Message:', error.message);
        context.log.error('Stack:', error.stack);
        context.log.error('Name:', error.name);
        if (error.code) context.log.error('Code:', error.code);
        
        results.errors.push({
          url: next.url,
          error: error.message
        });
      }
    }

    await browserContext.close();
    context.log('Crawler completed successfully');
    context.log('Crawler finished processing all pages');
    context.log('Crawler took screenshots for all pages');
    context.log('Crawler completed in ' + (new Date().getTime() - context.startTime) + 'ms');
    context.log('Crawler results:', results);

    return {
      status: 200,
      body: results
    };
  } catch (error) {
    context.log.error('Function failed with error:');
    context.log.error('Message:', error.message);
    context.log.error('Stack:', error.stack);
    context.log.error('Name:', error.name);
    if (error.code) context.log.error('Code:', error.code);
    
    return {
      status: 500,
      body: {
        error: 'Internal server error',
        details: error.message,
        stack: error.stack
      }
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
        context.log('Browser closed successfully');
      } catch (error) {
        context.log.error('Error closing browser:', error);
      }
    }
  }
}
