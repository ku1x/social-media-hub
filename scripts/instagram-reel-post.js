#!/usr/bin/env node
// instagram-reel-post.js — Upload video to Instagram as Reel
// Usage: node instagram-reel-post.js --video video.mp4 --caption "Caption text"

const {WebSocket} = require('ws');
const fs = require('fs');

const CDP_PORT = 9222;

// Parse args
const args = process.argv.slice(2);
let video = '', caption = '';
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--video') video = args[++i];
  if (args[i] === '--caption') caption = args[++i];
}
if (!video || !caption) {
  console.error('Usage: node instagram-reel-post.js --video <video.mp4> --caption "Caption"');
  process.exit(1);
}

async function run() {
  const resp = await fetch('http://localhost:' + CDP_PORT + '/json');
  const targets = await resp.json();
  const page = targets.find(t => t.type === 'page') || targets[0];
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const handlers = new Map();

  ws.on('message', data => {
    const msg = JSON.parse(data.toString());
    if (msg.id && handlers.has(msg.id)) { handlers.get(msg.id)(msg); handlers.delete(msg.id); }
  });

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const myId = id++;
      handlers.set(myId, resolve);
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  }

  function evaluate(expr) {
    return send('Runtime.evaluate', { expression: expr, returnByValue: true });
  }

  function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  await new Promise(r => ws.on('open', r));
  console.log('[1/6] Connected to Chrome CDP');

  // Navigate to Instagram create
  await send('Page.navigate', { url: 'https://www.instagram.com/create/select/' });
  await wait(3000);
  console.log('[2/6] Navigated to Instagram create page');

  // Find file input and upload video
  const doc = (await send('DOM.getDocument')).result.root.nodeId;
  const fileNodeId = (await send('DOM.querySelector', { nodeId: doc, selector: 'input[type=file]' })).result.nodeId;
  console.log('[3/6] File input nodeId:', fileNodeId);

  if (fileNodeId > 0) {
    await send('DOM.setFileInputFiles', { nodeId: fileNodeId, files: [video] });
    console.log('    Video uploaded');
  } else {
    throw new Error('No file input found');
  }

  // Wait for video to process
  console.log('[4/6] Waiting for video to process...');
  await wait(10000);

  // Click Next button (crop/filter page)
  const nextResult = await evaluate(
    `const btns = [...document.querySelectorAll('button')];
     const next = btns.find(b => b.textContent.trim() === 'Next' || b.textContent.trim() === 'Weiter');
     if (next) { next.click(); 'clicked'; } else { 'no next: ' + btns.map(b=>b.textContent.trim()).filter(t=>t).slice(0,10).join(','); }`
  );
  console.log('    Next:', nextResult.result?.value);
  await wait(3000);

  // Click Next again (to caption page)
  const next2 = await evaluate(
    `const btns = [...document.querySelectorAll('button')];
     const next = btns.find(b => b.textContent.trim() === 'Next' || b.textContent.trim() === 'Weiter');
     if (next) { next.click(); 'clicked'; } else { 'no next'; }`
  );
  console.log('    Next2:', next2.result?.value);
  await wait(2000);

  // Type caption
  console.log('[5/6] Typing caption...');
  await evaluate(
    `const textarea = document.querySelector('textarea[aria-label="Caption"], textarea');
     if (textarea) {
       textarea.focus();
       textarea.value = ${JSON.stringify(caption)};
       textarea.dispatchEvent(new Event('input', { bubbles: true }));
       'typed ' + textarea.value.length + ' chars';
     } else { 'no textarea'; }`
  );
  await wait(1000);

  // Click Share
  console.log('[6/6] Publishing...');
  const shareResult = await evaluate(
    `const btns = [...document.querySelectorAll('button')];
     const share = btns.find(b => b.textContent.trim() === 'Share' || b.textContent.trim() === 'Teilen');
     if (share) { share.click(); 'clicked'; } else { 'no share: ' + btns.map(b=>b.textContent.trim()).filter(t=>t).slice(0,10).join(','); }`
  );
  console.log('    Share:', shareResult.result?.value);

  await wait(8000);

  // Check result
  const url = (await evaluate('document.location.href')).result?.value;
  console.log('    Final URL:', url);

  if (url && !url.includes('create')) {
    console.log('\n✅ Reel published!');
  } else {
    console.log('\n⚠️ Status unclear - check Instagram manually');
  }

  ws.close();
}

run().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
