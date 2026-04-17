#!/usr/bin/env node
/**
 * Instagram Reels Video Post Script
 * 
 * Usage:
 *   node instagram-reels.js --video video.mp4 --caption "Caption text"
 *   node instagram-reels.js --video video.mp4 --file caption.txt
 * 
 * Requirements:
 *   - Chrome running with CDP on port 9222
 *   - Instagram logged in (cookie persisted in Chrome profile)
 * 
 * Flow:
 *   1. Navigate to /create/select/
 *   2. Upload video via DOM.setFileInputFiles
 *   3. Click Next (select → crop page)
 *   4. Click Next (crop → caption page)
 *   5. Type caption in textarea
 *   6. Click Share
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
const TIMEOUT = parseInt(process.env.TIMEOUT || '120000', 10);

// ─── CDP Helper ───────────────────────────────────────────────
function createCDP(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 1;
  const handlers = new Map();

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && handlers.has(msg.id)) {
      handlers.get(msg.id)(msg);
      handlers.delete(msg.id);
    }
  });

  return {
    ready: new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    }),
    send: (method, params = {}) => new Promise((resolve, reject) => {
      const msgId = id++;
      const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), TIMEOUT);
      handlers.set(msgId, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`CDP error: ${msg.error.message}`));
        else resolve(msg.result);
      });
      ws.send(JSON.stringify({ id: msgId, method, params }));
    }),
    close: () => ws.close(),
  };
}

// ─── Get page from CDP ───────────────────────────────────────
async function getPage() {
  const pages = await new Promise((resolve, reject) => {
    http.get(`http://${CDP_HOST}:${CDP_PORT}/json/list`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
  let page = pages.find(p => p.url.includes('instagram.com') && p.type === 'page');
  if (!page) page = pages.find(p => p.type === 'page');
  if (!page) throw new Error('No browser tab available');
  return page;
}

// ─── Wait for element ────────────────────────────────────────
async function waitForElement(cdp, selector, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await cdp.send('Runtime.evaluate', {
      expression: `!!document.querySelector('${selector}')`,
      returnByValue: true,
    });
    if (result.result.value) return true;
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Timeout waiting for element: ${selector}`);
}

// ─── Click element ───────────────────────────────────────────
async function clickElement(cdp, selector) {
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('${selector}').click()`,
    returnByValue: true,
  });
}

// ─── Type text ───────────────────────────────────────────────
async function typeText(cdp, selector, text) {
  // Focus the element
  await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('${selector}').focus()`,
    returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 500));

  // Type character by character
  for (const char of text) {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      text: char,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      text: char,
    });
    await new Promise(r => setTimeout(r, 50));
  }
}

// ─── Main: Reels Post ────────────────────────────────────────
async function instagramReels(videoPath, caption = '') {
  if (!fs.existsSync(videoPath)) throw new Error(`Video not found: ${videoPath}`);
  const absVideoPath = path.resolve(videoPath);

  console.log('[1/6] Connecting to Chrome CDP...');
  const page = await getPage();
  const cdp = createCDP(page.webSocketDebuggerUrl);
  await cdp.ready;

  console.log('[2/6] Navigating to Instagram create page...');
  await cdp.send('Page.navigate', { url: 'https://www.instagram.com/create/select/' });
  await new Promise(r => setTimeout(r, 3000));

  // Wait for file input
  console.log('[3/6] Uploading video...');
  const inputResult = await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('input[type="file"][accept*="video"], input[type="file"]') ? 'found' : 'not_found'`,
    returnByValue: true,
  });

  if (inputResult.result.value !== 'found') {
    throw new Error('File input not found. Is Instagram loaded?');
  }

  // Set file input
  await cdp.send('DOM.setFileInputFiles', {
    nodeId: (await cdp.send('DOM.getDocument')).root.nodeId,
    files: [absVideoPath],
  });

  // Try more specific approach - find the input via DOM
  const doc = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: doc.root.nodeId,
    selector: 'input[type="file"]',
  });

  if (nodeId) {
    await cdp.send('DOM.setFileInputFiles', {
      nodeId,
      files: [absVideoPath],
    });
  }

  console.log('      Waiting for video to process...');
  await new Promise(r => setTimeout(r, 5000));

  // Click Next (select → crop/filter)
  console.log('[4/6] Clicking Next (crop)...');
  try {
    await waitForElement(cdp, 'button:has(> div) >> text="Next"', 10000);
  } catch {
    // Try alternative selectors
    const nextResult = await cdp.send('Runtime.evaluate', {
      expression: `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Next')?.click() || 'no_next'`,
      returnByValue: true,
    });
  }
  await new Promise(r => setTimeout(r, 3000));

  // Click Next again (crop → caption)
  console.log('[5/6] Clicking Next (caption)...');
  await cdp.send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Next')?.click()`,
    returnByValue: true,
  });
  await new Promise(r => setTimeout(r, 3000));

  // Type caption
  if (caption) {
    console.log('      Writing caption...');
    const textareaResult = await cdp.send('Runtime.evaluate', {
      expression: `!!document.querySelector('textarea[aria-label="Caption"], textarea[placeholder="Write a caption..."], textarea')`,
      returnByValue: true,
    });

    if (textareaResult.result.value) {
      await cdp.send('Runtime.evaluate', {
        expression: `document.querySelector('textarea[aria-label="Caption"], textarea[placeholder="Write a caption..."], textarea').focus()`,
        returnByValue: true,
      });
      await new Promise(r => setTimeout(r, 500));
      await typeText(cdp, 'textarea[aria-label="Caption"], textarea[placeholder="Write a caption..."], textarea', caption);
    }
  }

  // Click Share
  console.log('[6/6] Clicking Share...');
  await cdp.send('Runtime.evaluate', {
    expression: `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'Share')?.click()`,
    returnByValue: true,
  });

  // Wait for confirmation
  console.log('      Waiting for confirmation...');
  await new Promise(r => setTimeout(r, 10000));

  // Check if posted
  const postedResult = await cdp.send('Runtime.evaluate', {
    expression: `document.body.innerText.includes('Your reel has been shared') || document.body.innerText.includes('Your post has been shared') || document.body.innerText.includes('Posted') || document.location.href.includes('instagram.com/reel')`,
    returnByValue: true,
  });

  cdp.close();

  if (postedResult.result.value) {
    console.log('\n✅ Reels video published!');
    return { success: true };
  } else {
    console.log('\n⚠️  Post may have been submitted but confirmation not detected.');
    return { success: true, confirmed: false };
  }
}

// ─── CLI ──────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage:');
    console.error('  node instagram-reels.js --video video.mp4 --caption "Caption"');
    console.error('  node instagram-reels.js --video video.mp4 --file caption.txt');
    process.exit(1);
  }

  let videoPath = '', caption = '', filePath = '';
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--video': videoPath = args[++i]; break;
      case '--caption': caption = args[++i]; break;
      case '--file': filePath = args[++i]; break;
    }
  }

  if (filePath) {
    if (!fs.existsSync(filePath)) { console.error(`File not found: ${filePath}`); process.exit(1); }
    caption = fs.readFileSync(filePath, 'utf-8').trim();
  }
  if (!videoPath) { console.error('Error: --video is required'); process.exit(1); }

  console.log(`Instagram Reels | "${videoPath}" | ${caption.length} chars caption`);
  console.log('');

  try {
    const result = await instagramReels(videoPath, caption);
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
