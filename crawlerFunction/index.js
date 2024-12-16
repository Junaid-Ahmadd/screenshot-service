import { chromium } from 'playwright-chromium';
import { CrawlerQueue } from '../lib/crawler.js';
import { readdirSync } from 'fs';
import { join } from 'path';

async function initBrowser() {
    try {
        console.log('Launching brand new browser for this specific request');
        const browserInstance = await chromium.launch({
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
            chromiumSandbox: false,
            headless: true,
            executablePath: join(process.cwd(), '.playwright', 'browsers', 'chromium-1148', 'chrome-linux', 'chrome')
        });
        console.log('Browser launched successfully');
        return browserInstance;
    } catch (error) {
        console.error('Failed to launch browser for this specific request:', error);
        throw error;
    }
}

export default async function (context, req) {
    context.log('Starting crawler function with SSE support');

    // Extract the URL from query parameters
    const startUrl = req.query.url; // Get URL from query string
    if (!startUrl) {
        context.log.error('No URL provided in request query');
        context.res = {
            status: 400,
            body: { error: "Please provide a URL in the request query" }
        };
        return;
    }

    const maxDepth = req.query.maxDepth || 3;
    const maxPages = req.query.maxPages || 20;

    // Log the received parameters
    context.log(`Received parameters: URL: ${startUrl}, Max Depth: ${maxDepth}, Max Pages: ${maxPages}`);

    // Set up the SSE headers
    context.res = {
        status: 200,
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Access-Control-Allow-Origin': '*'  // Add this for CORS support
        },
    };

    const sendSSE = (data) => {
        context.res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        // Initialize the browser
        const browser = await initBrowser();
        context.log('Browser initialized successfully');
        sendSSE({ message: 'Browser initialized successfully' });

        // Create a new browser context
        const browserContext = await browser.newContext();
        context.log('Browser context created');
        sendSSE({ message: 'Browser context created' });

        // Set up the crawler
        const crawler = new CrawlerQueue(10, maxDepth);
        crawler.setBaseUrl(startUrl);

        let processedPages = 0;
        crawler.addToQueue(startUrl, 0);

        // Crawl the website
        while (crawler.canProcess() && processedPages < maxPages) {
            const next = crawler.getNext();
            if (!next) break;

            try {
                const page = await browserContext.newPage();
                context.log(`Processing page ${processedPages + 1}/${maxPages}: ${next.url}`);
                sendSSE({ status: 'processing', url: next.url });

                // Go to the page and wait until the network is idle
                await page.goto(next.url, {
                    waitUntil: 'networkidle',
                    timeout: 30000
                }).catch(err => {
                    context.log.error(`Error loading page ${next.url}: ${err.message}`);
                    sendSSE({
                        status: 'error',
                        url: next.url,
                        error: `Failed to load page: ${err.message}`
                    });
                    throw err;
                });

                // Take a screenshot of the page
                const screenshot = await page.screenshot({
                    type: 'jpeg',
                    quality: 80,
                    fullPage: true
                });

                // Extract links from the page
                const links = await page.evaluate(() => {
                    return Array.from(document.querySelectorAll('a'))
                        .map((a) => a.href)
                        .filter((href) => href && !href.startsWith('javascript:'));
                });

                // Add valid links to the crawler queue
                for (const link of links) {
                    if (crawler.isValidUrl(link)) {
                        const normalizedUrl = crawler.normalizeUrl(link);
                        if (normalizedUrl) {
                            crawler.addToQueue(normalizedUrl, next.depth + 1);
                        }
                    }
                }

                // Close the page
                await page.close();

                // Send SSE for the processed page
                sendSSE({
                    status: 'success',
                    url: next.url,
                    depth: next.depth,
                    screenshot: screenshot.toString('base64'),
                    links: links.slice(0, 10) // Send only the first 10 links for brevity
                });

                processedPages++;
            } catch (error) {
                context.log.error(`Error processing ${next.url}: ${error.message}`);
                sendSSE({
                    status: 'error',
                    url: next.url,
                    error: error.message
                });
            }
        }

        // Close the browser context
        await browserContext.close();
        context.log('Crawler completed successfully');
        sendSSE({ message: 'Crawler completed successfully' });
    } catch (error) {
        context.log.error('Crawler failed:', error);
        sendSSE({ status: 'error', message: error.message });
    } finally {
        // End the response
        context.res.end();
        context.log('Response ended');
    }
}
