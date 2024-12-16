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
        return browserInstance;
    } catch (error) {
        console.error('Failed to launch browser for this specific request:', error);
        throw error;
    }
}

export default async function (context, req) {
    context.log('Starting crawler function with SSE support');

    if (!req.body || !req.body.url) {
        context.log.error('No URL provided in request body');
        context.res = {
            status: 400,
            body: { error: "Please provide a URL in the request body" }
        };
        return;
    }

    const startUrl = req.body.url;
    const maxDepth = req.body.maxDepth || 3;
    const maxPages = req.body.maxPages || 20;

    // Set up the SSE headers
    context.res = {
        status: 200,
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        },
    };

    const sendSSE = (data) => {
        context.res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
        const browser = await initBrowser();
        context.log('Browser initialized successfully');
        sendSSE({ message: 'Browser initialized successfully' });

        const browserContext = await browser.newContext();
        context.log('Browser context created');
        sendSSE({ message: 'Browser context created' });

        const crawler = new CrawlerQueue(10, maxDepth);
        crawler.setBaseUrl(startUrl);

        let processedPages = 0;
        crawler.addToQueue(startUrl, 0);

        while (crawler.canProcess() && processedPages < maxPages) {
            const next = crawler.getNext();
            if (!next) break;

            try {
                const page = await browserContext.newPage();
                context.log(`Processing page ${processedPages + 1}/${maxPages}: ${next.url}`);
                sendSSE({ status: 'processing', url: next.url });

                await page.goto(next.url, {
                    waitUntil: 'networkidle',
                    timeout: 30000
                });

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

                for (const link of links) {
                    if (crawler.isValidUrl(link)) {
                        const normalizedUrl = crawler.normalizeUrl(link);
                        if (normalizedUrl) {
                            crawler.addToQueue(normalizedUrl, next.depth + 1);
                        }
                    }
                }

                await page.close();

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

        await browserContext.close();
        context.log('Crawler completed successfully');
        sendSSE({ message: 'Crawler completed successfully' });
    } catch (error) {
        context.log.error('Crawler failed:', error);
        sendSSE({ status: 'error', message: error.message });
    } finally {
        context.res.end();
    }
}
