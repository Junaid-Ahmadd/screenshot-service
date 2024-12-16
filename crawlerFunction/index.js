export default async function (context, req) {
    context.log('Starting crawler function with SSE support');

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
