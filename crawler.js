class CrawlerQueue {
  constructor(maxConcurrent = 5, maxDepth = 3) {
    this.visitedUrls = new Set();
    this.queue = [];
    this.processing = new Set();
    this.screenshotsTaken = new Set(); // Track URLs that have been screenshotted
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
      console.error('Invalid base URL:', error);
    }
  }

  isValidUrl(url) {
    try {
      const parsedUrl = new URL(url, this.baseUrl);
      // Ignore non-HTML resources
      if (parsedUrl.pathname.match(/\.(jpg|jpeg|png|gif|css|js|json|xml|ico|pdf|zip|doc|docx)$/i)) {
        return false;
      }
      return parsedUrl.hostname === this.domain;
    } catch {
      return false;
    }
  }

  normalizeUrl(url) {
    try {
      const parsedUrl = new URL(url, this.baseUrl);
      // Remove hash
      parsedUrl.hash = "";
      // Remove trailing slash for consistency
      let normalized = parsedUrl.href;
      if (normalized.endsWith('/')) {
        normalized = normalized.slice(0, -1);
      }
      // Remove 'www.' from hostname for consistency
      if (parsedUrl.hostname.startsWith('www.')) {
        parsedUrl.hostname = parsedUrl.hostname.substring(4);
        normalized = parsedUrl.href;
      }
      return normalized;
    } catch {
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
      this.queue.push({ url: normalizedUrl, depth });
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
    if (this.canProcess()) {
      const next = this.queue.shift();
      this.processing.add(next.url);
      return next;
    }
    return null;
  }

  reset() {
    this.visitedUrls.clear();
    this.queue = [];
    this.processing.clear();
    this.screenshotsTaken.clear();
  }
}

export { CrawlerQueue };
