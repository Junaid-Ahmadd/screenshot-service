export class CrawlerQueue {
  constructor(maxConcurrent = 5, maxDepth = 3) {
    this.visitedUrls = new Set();
    this.queue = [];
    this.processing = new Set();
    this.screenshotsTaken = new Set();
    this.maxConcurrent = maxConcurrent;
    this.maxDepth = maxDepth;
    this.baseUrl = "";
    this.domain = "";
  }

  setBaseUrl(url) {
    try {
      const parsed = new URL(url);
      this.baseUrl = url;
      this.domain = parsed.hostname;
    } catch (error) {
      throw new Error('Invalid base URL: ' + error.message);
    }
  }

  isValidUrl(url) {
    console.log(`Validating URL: ${url}`);
    try {
      const parsedUrl = new URL(url, this.baseUrl);
      const isValid = !parsedUrl.pathname.match(/\.(jpg|jpeg|png|gif|css|js|json|xml|ico|pdf|zip|doc|docx)$/i) && parsedUrl.hostname === this.domain;
      console.log(`Is valid: ${isValid}`);
      return isValid;
    } catch {
      console.log(`Is valid: false`);
      return false;
    }
  }

  normalizeUrl(url) {
    console.log(`Normalizing URL: ${url}`);
    try {
      const parsedUrl = new URL(url, this.baseUrl);
      parsedUrl.hash = "";
      let normalized = parsedUrl.href;
      if (normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
      }
      if (parsedUrl.hostname.startsWith('www.')) {
        parsedUrl.hostname = parsedUrl.hostname.substring(4);
        normalized = parsedUrl.href;
      }
      console.log(`Normalized URL: ${normalized}`);
      return normalized;
    } catch {
      console.log(`Normalized URL: ""`);
      return "";
    }
  }

  addToQueue(url, depth) {
    const normalizedUrl = this.normalizeUrl(url);
    if (normalizedUrl && 
        !this.visitedUrls.has(normalizedUrl) && 
        !this.processing.has(normalizedUrl) && 
        !this.queue.some(item => item.url === normalizedUrl) && 
        depth <= this.maxDepth) {
      console.log(`Adding to queue: ${url} at depth ${depth}`);
      console.log(`Normalized URL: ${normalizedUrl}`);
      console.log(`Queue length: ${this.queue.length + 1}`);
      this.queue.push({ url: normalizedUrl, depth });
    } else {
      console.log(`Skipping URL: ${url} at depth ${depth}`);
      console.log(`Reason: URL is either visited, processing, or exceeds max depth`);
    }
  }

  markAsProcessed(url) {
    const normalizedUrl = this.normalizeUrl(url);
    this.visitedUrls.add(normalizedUrl);
    this.processing.delete(normalizedUrl);
  }

  markScreenshotTaken(url) {
    const normalizedUrl = this.normalizeUrl(url);
    this.screenshotsTaken.add(normalizedUrl);
  }

  needsScreenshot(url) {
    const normalizedUrl = this.normalizeUrl(url);
    return !this.screenshotsTaken.has(normalizedUrl);
  }

  canProcess() {
    return this.queue.length > 0 && this.processing.size < this.maxConcurrent;
  }

  getNext() {
    console.log(`Getting next URL from queue. Current queue length: ${this.queue.length}`);
    if (this.canProcess()) {
      const next = this.queue.shift();
      this.processing.add(next.url);
      console.log(`Processing URL: ${next.url} at depth ${next.depth}`);
      console.log(`Next URL: ${next.url}`);
      console.log(`Queue length after getting next URL: ${this.queue.length}`);
      return next;
    }
    console.log(`No next URL available`);
    return null;
  }

  reset() {
    this.visitedUrls.clear();
    this.queue = [];
    this.processing.clear();
    this.screenshotsTaken.clear();
  }
}
