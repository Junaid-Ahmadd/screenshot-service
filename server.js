import http from 'http';
import express from 'express';
import cors from 'cors';
import { chromium } from 'playwright';
import { CrawlerQueue } from './crawler.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const screenshotsDir = join(__dirname, 'screenshots');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
let browser = null;
let crawlerQueue = new CrawlerQueue();
let clients = new Set();

// Initialize browser
async function initBrowser() {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials'
      ]
    });
  }
  return browser;
}

// Handle client connection for SSE
function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  // Send initial connection message
  res.write('event: connected\ndata: Connected to screenshot service\n\n');

  // Add client to the set
  clients.add(res);

  // Handle client disconnect
  req.on('close', () => {
    clients.delete(res);
  });
}

// Send SSE message to all connected clients
function broadcastMessage(eventType, data) {
  const eventString = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  clients.forEach(client => {
    client.write(eventString);
  });
}

function logMemoryUsage(label) {
  const used = process.memoryUsage();
  console.log(`\n🔧 Memory Usage [${label}]:`);
  console.log(`RSS: ${Math.round(used.rss / 1024 / 1024)} MB`);
  console.log(`Heap Total: ${Math.round(used.heapTotal / 1024 / 1024)} MB`);
  console.log(`Heap Used: ${Math.round(used.heapUsed / 1024 / 1024)} MB`);
  console.log(`External: ${Math.round(used.external / 1024 / 1024)} MB`);
  return used;
}

function logMemoryDiff(start, end, url) {
  console.log(`\n📊 Memory Usage Summary for ${url}:`);
  console.log('Memory Change since processing start:');
  console.log(`RSS: ${Math.round((end.rss - start.rss) / 1024 / 1024)} MB`);
  console.log(`Heap Total: ${Math.round((end.heapTotal - start.heapTotal) / 1024 / 1024)} MB`);
  console.log(`Heap Used: ${Math.round((end.heapUsed - start.heapUsed) / 1024 / 1024)} MB`);
  console.log(`External: ${Math.round((end.external - start.external) / 1024 / 1024)} MB`);
}

async function extractLinks(page) {
  return await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a[href]'));
    return links.map(link => link.href);
  });
}

async function takeScreenshot(url) {
  if (!browser) {
    await initBrowser();
  }

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    bypassCSP: true,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'DNT': '1',
      'Connection': 'keep-alive'
    }
  });

  const page = await context.newPage();
  const screenshotStartMemory = logMemoryUsage(`Screenshot Start - ${url}`);

  try {
    // Set default timeout
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    // First try with regular navigation
    try {
      await page.goto(url, { 
        waitUntil: 'domcontentloaded',
        timeout: 30000 
      });
    } catch (navError) {
      console.log(`Initial navigation failed for ${url}, trying alternative method...`);
      // Alternative navigation method
      await page.setContent(`<html><body><script>window.location.href = "${url}";</script></body></html>`);
      await page.waitForLoadState('domcontentloaded');
    }

    // Handle common overlay selectors
    const commonOverlaySelectors = [
      'button:has-text("Accept")',
      'button:has-text("Accept All")',
      'button:has-text("OK")',
      'button:has-text("I Accept")',
      'button:has-text("Close")',
      '[aria-label="Accept cookies"]',
      '#cookie-notice button',
      '.cookie-banner button',
      '.consent-banner button'
    ];

    // Try to handle cookie banners and popups
    try {
      for (const selector of commonOverlaySelectors) {
        const button = await page.$(selector);
        if (button) {
          await button.click().catch(() => {});
          break;
        }
      }
    } catch (e) {
      // Ignore errors from popup handling
    }

    // Wait for any dynamic content with a shorter timeout
    try {
      await page.waitForLoadState('networkidle', { timeout: 5000 });
    } catch (e) {
      console.log(`Network idle wait timed out for ${url}, continuing with screenshot`);
    }

    // Ensure the page is scrolled to top before screenshot
    await page.evaluate(() => window.scrollTo(0, 0));

    const screenshotPath = join(screenshotsDir, `${Date.now()}.jpeg`);
    // Take the screenshot
    await page.screenshot({ path: screenshotPath, fullPage: true });
    
    const currentMemory = logMemoryUsage(`Screenshot Complete - ${url}`);
    const memoryDiff = {
      rss: currentMemory.rss - screenshotStartMemory.rss,
      heapTotal: currentMemory.heapTotal - screenshotStartMemory.heapTotal,
      heapUsed: currentMemory.heapUsed - screenshotStartMemory.heapUsed,
      external: currentMemory.external - screenshotStartMemory.external
    };
    
    console.log(`\n📊 Memory Usage Summary for ${url}:`);
    console.log(`Memory Change since screenshot start:`);
    console.log(`RSS: ${memoryDiff.rss > 0 ? '+' : ''}${memoryDiff.rss} MB`);
    console.log(`Heap Total: ${memoryDiff.heapTotal > 0 ? '+' : ''}${memoryDiff.heapTotal} MB`);
    console.log(`Heap Used: ${memoryDiff.heapUsed > 0 ? '+' : ''}${memoryDiff.heapUsed} MB`);
    console.log(`External: ${memoryDiff.external > 0 ? '+' : ''}${memoryDiff.external} MB\n`);

    const screenshot = await page.screenshot({
      fullPage: true,
      type: 'jpeg',
      quality: 80
    });

    // Convert the screenshot buffer to base64 and create a data URL
    const base64Image = Buffer.from(screenshot).toString('base64');
    const dataUrl = `data:image/jpeg;base64,${base64Image}`;

    return dataUrl;
  } catch (error) {
    console.error(`Screenshot error for ${url}:`, error);
    
    // Retry logic for specific errors
    if (error.message.includes('ERR_SOCKET_NOT_CONNECTED') ||
        error.message.includes('net::ERR') ||
        error.message.includes('Navigation failed')) {
      console.log(`Retrying screenshot for ${url}`);
      await context.close();
      return takeScreenshot(url);
    }
    
    throw new Error(`Failed to take screenshot of ${url}: ${error.message}`);
  } finally {
    await context.close();
  }
}

async function processUrl(url, depth) {
  if (!browser) {
    await initBrowser();
  }

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
    bypassCSP: true,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'DNT': '1',
      'Connection': 'keep-alive'
    }
  });

  const page = await context.newPage();
  const screenshotStartMemory = logMemoryUsage(`Processing Start - ${url}`);

  try {
    // Set default timeout
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    // Navigate to the page
    await page.goto(url, { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });

    // Handle cookie banners and popups
    try {
      const commonOverlaySelectors = [
        'button:has-text("Accept")',
        'button:has-text("Accept All")',
        'button:has-text("OK")',
        'button:has-text("I Accept")',
        'button:has-text("Close")',
        '[aria-label="Accept cookies"]',
        '#cookie-notice button',
        '.cookie-banner button',
        '.consent-banner button'
      ];

      for (const selector of commonOverlaySelectors) {
        const button = await page.$(selector);
        if (button) {
          await button.click().catch(() => {});
          break;
        }
      }
    } catch (e) {
      // Ignore errors from popup handling
    }

    // Extract links before taking screenshot
    const links = await extractLinks(page);
    const validLinks = links
      .map(link => crawlerQueue.normalizeUrl(link))
      .filter(link => crawlerQueue.isValidUrl(link));

    // Send discovered links to frontend
    broadcastMessage('links_found', {
      url,
      links: validLinks,
      depth
    });

    // Take screenshot only if not already taken
    if (crawlerQueue.needsScreenshot(url)) {
      // Wait for any dynamic content
      try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch (e) {
        console.log(`Network idle wait timed out for ${url}, continuing with screenshot`);
      }

      // Take screenshot
      await page.evaluate(() => window.scrollTo(0, 0));
      const screenshot = await page.screenshot({
        fullPage: true,
        type: 'jpeg',
        quality: 80
      });

      // Convert and send screenshot
      const base64Image = Buffer.from(screenshot).toString('base64');
      const dataUrl = `data:image/jpeg;base64,${base64Image}`;

      broadcastMessage('screenshot_complete', {
        url,
        data: dataUrl
      });

      crawlerQueue.markScreenshotTaken(url);
    }

    // Add valid links to queue
    validLinks.forEach(link => {
      crawlerQueue.addToQueue(link, depth + 1);
    });

    const currentMemory = logMemoryUsage(`Processing Complete - ${url}`);
    logMemoryDiff(screenshotStartMemory, currentMemory, url);

  } catch (error) {
    console.error(`Failed to process ${url}:`, error);
    broadcastMessage('error', {
      url,
      error: error.message
    });
  } finally {
    await context.close();
    crawlerQueue.markAsProcessed(url);
    processQueue();
  }
}

async function processQueue() {
  while (crawlerQueue.canProcess()) {
    const next = crawlerQueue.getNext();
    if (next) {
      processUrl(next.url, next.depth);
    }
  }
}

// API Endpoints
app.get('/events', handleSSE);

app.post('/start', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    // Reset state
    crawlerQueue = new CrawlerQueue();
    crawlerQueue.setBaseUrl(url);
    crawlerQueue.addToQueue(url, 0);
    processQueue();
    res.json({ message: 'Crawling started' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/stop', (req, res) => {
  crawlerQueue = new CrawlerQueue();
  res.json({ message: 'Crawling stopped' });
});

app.post('/take_screenshot', async (req, res) => {
  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const screenshot = await takeScreenshot(url);
    res.json({ data: screenshot });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Screenshot service running on port ${PORT}`);
});

// Cleanup on exit
process.on('exit', async () => {
  if (browser) {
    await browser.close();
  }
});
