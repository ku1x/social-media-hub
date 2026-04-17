#!/usr/bin/env node
/**
 * LinkedIn Post Script (with image support)
 * 
 * Usage:
 *   node linkedin-post.js "Your post content here"
 *   node linkedin-post.js "Post text" --images img1.png img2.jpg
 *   echo "Your post content" | node linkedin-post.js -
 *   node linkedin-post.js --file post.txt
 *   node linkedin-post.js --file post.txt --images img1.png img2.jpg
 * 
 * Requirements:
 *   - Chrome running with CDP on port 9222
 *   - LinkedIn logged in (cookie persisted in Chrome profile)
 * 
 * Technical Notes:
 *   - LinkedIn post editor lives inside Shadow DOM
 *   - Uses CDP DOM.getDocument with pierce:true to find buttons
 *   - Uses Input.dispatchKeyEvent to type into Shadow DOM editor
 *   - Images uploaded via CDP DOM.setFileInputFiles (bypasses file picker)
 *   - Image flow: click "Add media" → file input appears → set files → click "Next" → type text → Post
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

// ─── Get LinkedIn page from CDP ──────────────────────────────
async function getLinkedInPage() {
  const pages = await new Promise((resolve, reject) => {
    http.get(`http://${CDP_HOST}:${CDP_PORT}/json/list`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });

  let page = pages.find(p => p.url.includes('linkedin.com') && p.type === 'page');
  if (!page) page = pages.find(p => p.type === 'page');
  if (!page) throw new Error('No browser tab available');
  return page;
}

// ─── DOM tree helpers (pierce Shadow DOM) ────────────────────
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
    let inputType = '';
    for (let i = 0; i < attrs.length; i += 2) { if (attrs[i] === 'type') inputType = attrs[i + 1]; }
    if (inputType === 'file') results.push({ nodeId: node.nodeId });
  }
  if (node.children) for (const c of node.children) results.push(...findFileInputs(c));
  if (node.shadowRoots) for (const sr of node.shadowRoots) results.push(...findFileInputs(sr));
  return results;
}

function findElementsByText(node, searchText) {
  const results = [];
  function getText(n) { let t = n.nodeValue || ''; if (n.children) for (const c of n.children) t += getText(c); return t; }
  const text = getText(node).trim();
  if (text === searchText) results.push({ nodeId: node.nodeId, tag: node.nodeName });
  if (node.children) for (const c of node.children) results.push(...findElementsByText(c, searchText));
  if (node.shadowRoots) for (const sr of node.shadowRoots) results.push(...findElementsByText(sr, searchText));
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

// ─── Type text into Shadow DOM editor ────────────────────────
async function typeInEditor(cdp, text) {
  const focusResult = await cdp.send('Runtime.evaluate', {
    expression: `(function() {
      const themeLight = document.querySelector('.theme--light');
      if (themeLight && themeLight.shadowRoot) {
        const editor = themeLight.shadowRoot.querySelector('[contenteditable="true"][data-placeholder]');
        if (editor) {
          editor.focus();
          const rect = editor.getBoundingClientRect();
          return JSON.stringify({ ok: true, x: rect.x + rect.width/2, y: rect.y + 20 });
        }
      }
      return JSON.stringify({ ok: false });
    })()`
  });

  const focusInfo = JSON.parse(focusResult.result.result.value);
  if (!focusInfo.ok) throw new Error('Could not find post editor in Shadow DOM');

  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: focusInfo.x, y: focusInfo.y, button: 'left', clickCount: 1
  });
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased', x: focusInfo.x, y: focusInfo.y, button: 'left', clickCount: 1
  });
  await new Promise(r => setTimeout(r, 500));

  for (const char of text) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'char', text: char });
  }
}

// ─── Main: Post to LinkedIn ──────────────────────────────────
async function linkedinPost(content, imagePaths = []) {
  if (!content || content.trim().length === 0) {
    throw new Error('Post content cannot be empty');
  }

  const hasImages = imagePaths.length > 0;

  console.log('[1/8] Connecting to Chrome CDP...');
  const page = await getLinkedInPage();
  const cdp = createCDP(page.webSocketDebuggerUrl);
  await cdp.ready;
  console.log(`      Connected: ${page.url.substring(0, 60)}`);

  // Navigate to LinkedIn feed
  console.log('[2/8] Navigating to LinkedIn feed...');
  await cdp.send('Page.navigate', { url: 'https://www.linkedin.com/feed/' });
  await new Promise(r => setTimeout(r, 6000));

  // Click "Start a post" via DOM domain
  console.log('[3/8] Opening post editor...');
  await cdp.send('DOM.enable');
  let doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const startPostEls = findElementsByText(doc.result.root, 'Start a post');
  if (startPostEls.length === 0) {
    throw new Error('Could not find "Start a post". Is LinkedIn logged in?');
  }
  // Click the last (most specific) match
  const target = startPostEls[startPostEls.length - 1];
  await clickNode(cdp, target.nodeId);
  console.log(`      Editor opened (clicked nodeId ${target.nodeId})`);

  await new Promise(r => setTimeout(r, 5000));

  // Upload images (if any)
  if (hasImages) {
    console.log('[4/8] Uploading images...');

    // Click "Add media" button in Shadow DOM
    const addMediaResult = await cdp.send('Runtime.evaluate', {
      expression: `(function() {
        const themeLight = document.querySelector('.theme--light');
        if (themeLight && themeLight.shadowRoot) {
          const btns = themeLight.shadowRoot.querySelectorAll('button');
          for (const btn of btns) {
            if (btn.getAttribute('aria-label') === 'Add media') {
              const rect = btn.getBoundingClientRect();
              return JSON.stringify({ found: true, x: rect.x + rect.width/2, y: rect.y + rect.height/2 });
            }
          }
        }
        return JSON.stringify({ found: false });
      })()`
    });

    const mediaInfo = JSON.parse(addMediaResult.result.result.value);
    if (!mediaInfo.found) throw new Error('Could not find "Add media" button');

    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed', x: mediaInfo.x, y: mediaInfo.y, button: 'left', clickCount: 1
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased', x: mediaInfo.x, y: mediaInfo.y, button: 'left', clickCount: 1
    });
    console.log('      Clicked "Add media"');

    await new Promise(r => setTimeout(r, 2000));

    // Find file input and set files
    doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    let fileInputs = findFileInputs(doc.result.root);

    if (fileInputs.length === 0) {
      // Retry after a short wait
      await new Promise(r => setTimeout(r, 2000));
      doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      fileInputs = findFileInputs(doc.result.root);
    }

    if (fileInputs.length === 0) throw new Error('File input not found after clicking "Add media"');

    // Resolve absolute paths and validate
    const resolvedPaths = imagePaths.map(p => path.resolve(p));
    for (const p of resolvedPaths) {
      if (!fs.existsSync(p)) throw new Error(`Image file not found: ${p}`);
    }

    await cdp.send('DOM.setFileInputFiles', {
      nodeId: fileInputs[0].nodeId,
      files: resolvedPaths,
    });
    console.log(`      Uploading ${resolvedPaths.length} image(s)...`);

    // Wait for upload
    await new Promise(r => setTimeout(r, 8000));

    // Click "Next" to proceed from image editor to text editor
    console.log('[5/8] Proceeding to text editor...');
    doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    const buttons = findButtons(doc.result.root);
    const nextBtn = buttons.find(b => b.text === 'Next' && !b.disabled);
    if (nextBtn) {
      await clickNode(cdp, nextBtn.nodeId);
      console.log('      Clicked "Next"');
    } else {
      throw new Error('Could not find "Next" button after image upload');
    }

    await new Promise(r => setTimeout(r, 4000));
  } else {
    console.log('[4/8] No images to upload');
    console.log('[5/8] Skipping image step');
  }

  // Type content into Shadow DOM editor
  console.log('[6/8] Typing post content...');
  await typeInEditor(cdp, content);
  console.log(`      Typed ${content.length} characters`);

  await new Promise(r => setTimeout(r, 2000));

  // Find and click Post button
  console.log('[7/8] Finding Post button (piercing Shadow DOM)...');
  doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const buttons = findButtons(doc.result.root);
  const postBtn = buttons.find(b => b.text === 'Post' && !b.disabled);

  if (!postBtn) {
    const candidates = buttons.filter(b =>
      b.text.toLowerCase().includes('post') || b.text.toLowerCase().includes('publish')
    );
    console.error('      Available buttons:', candidates.map(b => `"${b.text}" disabled:${b.disabled}`));
    throw new Error('Post button not found or disabled');
  }

  const coords = await clickNode(cdp, postBtn.nodeId);
  console.log(`      Clicked Post at (${Math.round(coords.x)}, ${Math.round(coords.y)})`);

  // Wait for publish
  await new Promise(r => setTimeout(r, 5000));

  cdp.close();

  console.log('\n✅ Post published!');
  return { success: true };
}

// ─── CLI Entry Point ─────────────────────────────────────────
async function main() {
  let content = '';
  let imagePaths = [];

  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage:');
    console.error('  node linkedin-post.js "Your post content"');
    console.error('  node linkedin-post.js "Post text" --images img1.png img2.jpg');
    console.error('  echo "Content" | node linkedin-post.js -');
    console.error('  node linkedin-post.js --file post.txt');
    console.error('  node linkedin-post.js --file post.txt --images img1.png img2.jpg');
    process.exit(1);
  }

  // Parse --images flag
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
    content = fs.readFileSync(filePath, 'utf-8').trim();
  } else if (args[0] === '-') {
    content = fs.readFileSync('/dev/stdin', 'utf-8').trim();
  } else {
    content = args.join(' ');
  }

  if (!content) {
    console.error('Error: Post content is empty');
    process.exit(1);
  }

  console.log(`Post content (${content.length} chars): "${content.substring(0, 80)}${content.length > 80 ? '...' : ''}"`);
  if (imagePaths.length > 0) {
    console.log(`Images: ${imagePaths.join(', ')}`);
  }
  console.log('');

  try {
    const result = await linkedinPost(content, imagePaths);
    process.exit(result.success ? 0 : 1);
  } catch (err) {
    console.error(`\n❌ Error: ${err.message}`);
    process.exit(1);
  }
}

main();
