# Screenshot Service

Node.js service that handles web crawling and screenshot capture for the Web Crawler & Screenshot Tool.

## Features

- **Efficient Web Crawling**
  - Concurrent URL processing
  - Smart URL normalization and deduplication
  - Domain-specific crawling
  - Configurable crawl depth and limits

- **Screenshot Capabilities**
  - Full-page screenshots using Playwright
  - Automatic popup and cookie banner handling
  - Memory-optimized image processing
  - Base64 JPEG encoding
  - Duplicate screenshot prevention

- **WebSocket Communication**
  - Real-time updates to frontend
  - Link discovery notifications
  - Screenshot completion events
  - Error reporting

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Install Playwright Browser**
   ```bash
   npx playwright install chromium
   ```

## Configuration

The service can be configured through the following parameters in `server.js`:

- **Crawler Settings**
  ```javascript
  maxConcurrent = 5  // Maximum concurrent URL processing
  maxDepth = 3       // Maximum crawl depth
  ```

- **Screenshot Settings**
  ```javascript
  // In the screenshot options
  fullPage: true,    // Capture full page
  type: 'jpeg',      // Image format
  quality: 80        // JPEG quality
  ```

## WebSocket API

The service exposes a WebSocket server on port 3000 with the following message types:

### Incoming Messages

- **start_crawl**
  ```javascript
  {
    type: 'start_crawl',
    url: 'https://example.com'
  }
  ```

- **stop_crawl**
  ```javascript
  {
    type: 'stop_crawl'
  }
  ```

### Outgoing Messages

- **links_found**
  ```javascript
  {
    type: 'links_found',
    url: 'https://example.com',
    links: ['https://example.com/page1', ...],
    depth: 1
  }
  ```

- **screenshot_complete**
  ```javascript
  {
    type: 'screenshot_complete',
    url: 'https://example.com',
    data: 'data:image/jpeg;base64,...'
  }
  ```

- **error**
  ```javascript
  {
    type: 'error',
    url: 'https://example.com',
    error: 'Error message'
  }
  ```

## Memory Management

The service includes several optimizations for memory efficiency:

- URL deduplication using normalized URLs
- Screenshot caching with Set data structure
- Memory usage tracking and logging
- Efficient image compression
- Automatic cleanup of browser contexts

## Error Handling

- Automatic retry for failed requests
- Timeout handling for slow pages
- Domain validation
- Resource type filtering
- Cookie consent handling

## Running the Service

```bash
node server.js
```

The service will start on `ws://localhost:3000`
