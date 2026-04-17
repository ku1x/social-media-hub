#!/usr/bin/env node
/**
 * Instagram Image Post Script
 * 
 * Usage:
 *   node instagram-post.js "Caption text" --images img1.png img2.jpg
 *   node instagram-post.js --file caption.txt --images img1.png
 *   echo "Caption" | node instagram-post.js - --images img1.png
 * 
 * Requirements:
 *   - Chrome running with CDP on port 9222
 *   - Instagram logged in (cookie persisted in Chrome profile)
 * 
 * Flow:
 *   1. Navigate to /create/select/
 *   2. Upload images via DOM.setFileInputFiles
 *   3. Click Next (select → style/filter page)
 *   4. Click Next (style → caption page)
 *   5. Type caption in textarea
 *   6. Click Share
 */

const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
const TIMEOUT = parseInt(process.env.TIMEOUT || '60000', 10);

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
      const timer = setTimeout(() => reject(new Error(`Timeout: ${method}`)), TIMEOUT);
      handlers.set(msgId, (msg) => {
        clearTimeout(timer);
        resolve(msg);
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

// ─── DOM tree helpers ─────────────────────────────────────────
function findButtons(node) {
  const results = [];
  if ((node.nodeName || '').toLowerCase() === 'button') {
    function getText(n) { let t = n.nodeValue || ''; if (n.children) for (const c of n.children) t += getText(c); return t; }
    const text = getText(node).trim();
    const attrs = node.attributes || [];
    let disabled = false;
    for (let i = 0; i < attrs.length; i += 2) { if (attrs[i] === 'disabled') disabled = true; }
    results.push({ nodeId: node.nodeId, text, disabled });
  }
  if (node.children) for (const c of node.children) results.push(...findButtons(c));
  if (node.shadowRoots) for (const sr of node.shadowRoots) results.push(...findButtons(sr));
  return results;
}

function findFileInputs(node) {
  const results = [];
  if ((node.nodeName || '').toLowerCase() === 'input') {
    const attrs = node.attributes || [];
    let inputType = '', accept = '';
    for (let i = 0; i < attrs.length; i += 2) {
      if (attrs[i] === 'type') inputType = attrs[i + 1];
      if (attrs[i] === 'accept') accept = attrs[i + 1];
    }
    if (inputType === 'file') results.push({ nodeId: node.nodeId, accept });
  }
  if (node.children) for (const c of node.children) results.push(...findFileInputs(c));
  if (node.shadowRoots) for (const sr of node.shadowRoots) results.push(...findFileInputs(sr));
  return results;
}

// ─── Click a DOM node by nodeId ──────────────────────────────
async function clickNode(cdp, nodeId) {
  const box = await cdp.send('DOM.getBoxModel', { nodeId });
  const c = box.result.model.content;
  const cx = (c[0] + c[2] + c[4] + c[6]) / 4;
  const cy = (c[1] + c[3] + c[5] + c[7]) / 4;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 });
  return { x: cx, y: cy };
}

// ─── Find and click a button by text ─────────────────────────
async function findAndClickButton(cdp, buttonText) {
  const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const buttons = findButtons(doc.result.root);
  const btn = buttons.find(b => b.text === buttonText && !b.disabled);
  if (!btn) {
    const candidates = buttons.filter(b => !b.disabled && b.text.length < 30);
    throw new Error(`Button "${buttonText}" not found. Available: ${candidates.map(b => `"${b.text}"`).join(', ')}`);
  }
  return await clickNode(cdp, btn.nodeId);
}

// ─── Main: Post to Instagram ──────────────────────────────────
async function instagramPost(caption, imagePaths = []) {
  if (!imagePaths || imagePaths.length === 0) {
    throw new Error('Instagram requires at least one image. Use --images flag.');
  }

  console.log('[1/6] Connecting to Chrome CDP...');
  const page = await getPage();
  const cdp = createCDP(page.webSocketDebuggerUrl);
  await cdp.ready;

  console.log('[2/6] Navigating to Instagram create page...');
  await cdp.send('Page.navigate', { url: 'https://www.instagram.com/create/select/' });
  await new Promise(r => setTimeout(r, 5000));

  console.log('[3/6] Uploading images...');
  await cdp.send('DOM.enable');
  let doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  let fileInputs = findFileInputs(doc.result.root);

  if (fileInputs.length === 0) {
    await new Promise(r => setTimeout(r, 2000));
    doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    fileInputs = findFileInputs(doc.result.root);
  }

  if (fileInputs.length === 0) {
    throw new Error('File input not found on create page. Is Instagram logged in?');
  }

  const resolvedPaths = imagePaths.map(p => path.resolve(p));
  for (const p of resolvedPaths) {
    if (!fs.existsSync(p)) throw new Error(`Image file not found: ${p}`);
  }

  await cdp.send('DOM.setFileInputFiles', {
    nodeId: fileInputs[0].nodeId,
    files: resolvedPaths,
  });
  console.log(`      Uploading ${resolvedPaths.length} image(s)...`);
  await new Promise(r => setTimeout(r, 8000));

  console.log('[4/6] Proceeding to caption page...');
  await findAndClickButton(cdp, 'Next');
  await new Promise(r => setTimeout(r, 4000));
  await findAndClickButton(cdp, 'Next');
  await new Promise(r => setTimeout(r, 4000));

  console.log('[5/6] Typing caption...');
  const captionResult = await cdp.send('Runtime.evaluate', {
    expression: `(function() {
      const textarea = document.querySelector('textarea[aria-label="Write a caption…"], textarea[placeholder*="caption"], textarea[placeholder*="Write"]');
      if (textarea) {
        textarea.focus();
        const rect = textarea.getBoundingClientRect();
        return JSON.stringify({ found: true, x: rect.x + 10, y: rect.y + 10 });
      }
      const editable = document.querySelector('[contenteditable="true"]');
      if (editable) {
        editable.focus();
        const rect = editable.getBoundingClientRect();
        return JSON.stringify({ found: true, x: rect.x + 10, y: rect.y + 10 });
      }
      return JSON.stringify({ found: false });
    })()`
  });

  const captionInfo = JSON.parse(captionResult.result.result.value);
  if (!captionInfo.found) throw new Error('Caption textarea not found');

  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: captionInfo.x, y: captionInfo.y, button: 'left', clickCount: 1
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: captionInfo.x, y: captionInfo.y, button: 'left', clickCount: 1
  });
  await new Promise(r => setTimeout(r, 500));

  for (const char of caption) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: char });
  }
  console.log(`      Typed ${caption.length} characters`);
  await new Promise(r => setTimeout(r, 2000));

  console.log('[6/6] Publishing...');
  await findAndClickButton(cdp, 'Share');
  await new Promise(r => setTimeout(r, 8000));

  cdp.close();

  console.log('\n✅ Post published!');
  return { success: true };
}

// ─── CLI ──────────────────────────────────────────────────────
async function main() {
  let caption = '';
  let imagePaths = [];

  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage:');
    console.error('  node instagram-post.js "Caption text" --images img1.png img2.jpg');
    console.error('  node instagram-post.js --file caption.txt --images img1.png');
    console.error('  echo "Caption" | node instagram-post.js - --images img1.png');
    process.exit(1);
  }

  const imagesIdx = args.indexOf('--images');
  if (imagesIdx !== -1) {
    const afterImages = args.slice(imagesIdx + 1);
    imagePaths = [];
    for (const arg of afterImages) {
      if (arg.startsWith('--')) break;
      imagePaths.push(arg);
    }
    args.splice(imagesIdx, 1 + imagePaths.length);
  }

  if (args[0] === '--file' || args[0] === '-f') {
    const filePath = args[1];
    if (!filePath || !fs.existsSync(filePath)) {
      console.error(`File not found: ${filePath}`);
      process.exit(1);
    }
    caption = fs.readFileSync(filePath, 'utf-8').trim();
  } else if (args[0] === '-') {
    caption = fs.readFileSync('/dev/stdin', 'utf-8').trim();
  } else {
    caption = args.join(' ');
  }

  if (!caption) { console.error('Error: Caption is empty'); process.exit(1); }
  if (imagePaths.length === 0) { console.error('Error: --images is required'); process.exit(1); }

  console.log(`Caption (${caption.length} chars): "${caption.substring(0, 80)}${caption.length > 80 ? '...' : ''}"`);
  console.log(`Images: ${imagePaths.join(', ')}`);
  console.log('');

  try {
    const result = await instagramPost(caption, imagePaths);
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
