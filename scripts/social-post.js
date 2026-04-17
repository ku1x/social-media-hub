#!/usr/bin/env node
/**
 * Social Media Hub — Unified posting script
 * 
 * Instagram:  ig sync | ig check | ig reel|photo|video|carousel <files> --caption "..."
 * RedNote:    rn image <files> --title "..." --body "..." | rn video <file> --title "..." --body "..."
 */

const WebSocket = require('ws');
const http = require('http');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CDP_PORT = parseInt(process.env.CDP_PORT || '9222', 10);
const CDP_HOST = process.env.CDP_HOST || '127.0.0.1';
const IG_PYTHON = '/home/node/.local/share/uv/tools/clinstagram/bin/python3';
const IG_SESSION = path.join(process.env.HOME || '/home/node', '.openclaw', 'data', 'clinstagram', 'session.json');
const RN_DIR = path.join(process.env.HOME || '/home/node', '.openclaw', 'workspace', 'rednote-cli');
const RN_UV = path.join(process.env.HOME || '/home/node', '.openclaw', 'tools', 'uv', 'uv');
const RN_COOKIES = path.join(process.env.HOME || '/home/node', '.rednote-cli', 'cookies.json');
const TT_DIR = path.join(process.env.HOME || '/home/node', '.openclaw/tools/TiktokAutoUploader');
const TT_PYTHON = path.join(TT_DIR, '.venv/bin/python');
const TT_CLI = path.join(TT_DIR, 'cli.py');
const TT_VIDEO_DIR = path.join(TT_DIR, 'VideosDirPath');
const TT_USER = 'acg_ai';

async function getCDP() {
  const pages = await new Promise((resolve, reject) => {
    http.get(`http://${CDP_HOST}:${CDP_PORT}/json/list`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
  const page = pages.find(p => p.type === 'page');
  if (!page) throw new Error('No browser tab');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1;
  const handlers = new Map();
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && handlers.has(msg.id)) { handlers.get(msg.id)(msg); handlers.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const msgId = id++;
    const timer = setTimeout(() => reject(new Error(`CDP timeout: ${method}`)), 30000);
    handlers.set(msgId, (msg) => { clearTimeout(timer); if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result); });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  return { send, close: () => ws.close() };
}

function runPython(pythonBin, script, args = [], options = {}) {
  const scriptFile = `/tmp/sp-${Date.now()}.py`;
  fs.writeFileSync(scriptFile, script);
  const cmd = `"${pythonBin}" "${scriptFile}" ${args.map(a => `"${a}"`).join(' ')}`;
  try {
    const output = execSync(cmd, { encoding: 'utf-8', timeout: options.timeout || 120000, stdio: ['pipe', 'pipe', 'pipe'] });
    const lines = output.trim().split('\n');
    const jsonLine = lines.find(l => l.trim().startsWith('{')) || lines[lines.length - 1];
    try { return JSON.parse(jsonLine); } catch { return { success: true, raw: output.trim() }; }
  } catch (err) {
    const stdout = err.stdout?.trim() || '';
    try { const lines = stdout.split('\n'); const jl = lines.find(l => l.trim().startsWith('{')); if (jl) return JSON.parse(jl); } catch {}
    return { success: false, error: err.message };
  } finally { try { fs.unlinkSync(scriptFile); } catch {} }
}

// ─── Instagram ────────────────────────────────────────────────
async function igExtractCookies() {
  const cdp = await getCDP();
  const { cookies } = await cdp.send('Network.getAllCookies');
  const ig = cookies.filter(c => c.domain.includes('instagram.com'));
  const sid = ig.find(c => c.name === 'sessionid');
  const dsu = ig.find(c => c.name === 'ds_user_id');
  cdp.close();
  if (!sid) throw new Error('No sessionid cookie. Is Instagram logged in?');
  return { sessionid: sid.value, ds_user_id: dsu?.value || '' };
}

async function igSync() {
  console.log('[1/3] Extracting Instagram cookies from Chrome CDP...');
  const ck = await igExtractCookies();
  console.log(`      sessionid: ${ck.sessionid.substring(0, 10)}...`);
  fs.mkdirSync(path.dirname(IG_SESSION), { recursive: true });
  console.log('[2/3] Logging in via sessionid...');
  const r = runPython(IG_PYTHON, `
import json, sys, os
os.environ["TQDM_DISABLE"]="1"
from instagrapi import Client
cl=Client()
try:
    r=cl.login_by_sessionid(sys.argv[1])
    if r:
        cl.dump_settings(sys.argv[3])
        try:
            i=cl.account_info()
            print(json.dumps({"success":True,"username":i.username,"user_id":str(i.pk)}))
        except:
            print(json.dumps({"success":True,"username":"unknown","user_id":sys.argv[2]}))
    else:
        print(json.dumps({"success":False,"error":"login_by_sessionid returned False"}))
except Exception as e:
    print(json.dumps({"success":False,"error":str(e)}))
`, [ck.sessionid, ck.ds_user_id, IG_SESSION]);
  if (!r.success) { console.log(`❌ Login failed: ${r.error}`); process.exit(1); }
  console.log(`      ✅ Logged in as @${r.username} (ID: ${r.user_id})`);
  console.log(`[3/3] Session saved to: ${IG_SESSION}`);
  console.log('\n✅ Instagram cookie sync complete!');
}

function igCheck() {
  if (!fs.existsSync(IG_SESSION)) { console.log('❌ No session file'); process.exit(1); }
  const r = runPython(IG_PYTHON, `
import json, sys, os
os.environ["TQDM_DISABLE"]="1"
from instagrapi import Client
cl=Client()
try:
    with open(sys.argv[1]) as f: cl.set_settings(json.load(f))
    i=cl.account_info()
    print(json.dumps({"valid":True,"username":i.username,"user_id":str(i.pk)}))
except Exception as e:
    print(json.dumps({"valid":False,"error":str(e)}))
`, [IG_SESSION]);
  if (r.valid) console.log(`✅ Session valid: @${r.username} (ID: ${r.user_id})`);
  else console.log(`❌ Session invalid: ${r.error}`);
  process.exit(r.valid ? 0 : 1);
}

function igPost(type, filePaths, caption) {
  if (!fs.existsSync(IG_SESSION)) { console.log('❌ No session. Run `ig sync` first.'); process.exit(1); }
  for (const f of filePaths) { if (!fs.existsSync(f)) { console.log(`❌ File not found: ${f}`); process.exit(1); } }
  const method = { reel:'clip_upload', photo:'photo_upload', video:'video_upload', carousel:'album_upload' }[type];
  if (!method) { console.log(`❌ Unknown type: ${type}`); process.exit(1); }

  let uploadCode;
  if (type === 'carousel') {
    uploadCode = `paths=sys.argv[2:-1]\ncap=sys.argv[-1]\nmedia=[cl.PhotoUpload(path=p) if p.lower().endswith(('.jpg','.jpeg','.png','.webp')) else cl.VideoUpload(path=p) for p in paths]\nresult=cl.album_upload(media,caption=cap)`;
  } else {
    uploadCode = `fp=sys.argv[2]\ncap=sys.argv[3]\nresult=cl.${method}(fp,caption=cap)`;
  }

  const r = runPython(IG_PYTHON, `
import json, sys, os
os.environ["TQDM_DISABLE"]="1"
from instagrapi import Client
cl=Client()
with open(sys.argv[1]) as f: cl.set_settings(json.load(f))
cl.account_info()
${uploadCode}
code=getattr(result,'code',None) or ''
pk=str(getattr(result,'pk',''))
pt=getattr(result,'product_type',None)
url=f"https://www.instagram.com/reel/{code}/" if pt=='clips' else (f"https://www.instagram.com/p/{code}/" if code else '')
print(json.dumps({"success":True,"media_id":pk,"code":code,"product_type":pt,"url":url}))
`, type==='carousel' ? [IG_SESSION,...filePaths,caption] : [IG_SESSION,filePaths[0],caption], {timeout:180000});

  if (r.success) { console.log(`✅ Instagram ${type} posted!`); if (r.url) console.log(`   URL: ${r.url}`); console.log(`   ID: ${r.media_id}, code: ${r.code}`); }
  else { console.log(`❌ Failed: ${r.error}`); }
  process.exit(r.success ? 0 : 1);
}

// ─── RedNote ──────────────────────────────────────────────────
function rnImage(imagePaths, title, body, topic) {
  for (const f of imagePaths) { if (!fs.existsSync(f)) { console.log(`❌ File not found: ${f}`); process.exit(1); } }
  const args = ['post', '--title', title, '--body', body];
  for (const p of imagePaths) args.push('--images', p);
  if (topic) args.push('--topic', topic);
  args.push('--json');
  try {
    const cmd = `cd "${RN_DIR}" && "${RN_UV}" run rednote ${args.map(a => `"${a}"`).join(' ')}`;
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 60000 });
    const data = JSON.parse(output.trim());
    if (data.ok) console.log(`✅ RedNote image note posted! ID: ${data.data?.id}`);
    else console.log(`❌ Failed: ${JSON.stringify(data.error || data)}`);
    process.exit(data.ok ? 0 : 1);
  } catch (err) { console.log(`❌ Failed: ${err.message}`); process.exit(1); }
}

function rnVideo(videoPath, title, body) {
  if (!fs.existsSync(videoPath)) { console.log(`❌ File not found: ${videoPath}`); process.exit(1); }
  const r = runPython(`${RN_DIR}/.venv/bin/python3`, `
import json, sys, os, time
os.environ["TQDM_DISABLE"]="1"
sys.path.insert(0,"${RN_DIR}")
from rednote_cli.client import XhsClient
from rednote_cli.client_mixins import CREATOR_HOST

video_path=sys.argv[1]
title=sys.argv[2]
desc=sys.argv[3]

with open("${RN_COOKIES}") as f: cookies=json.load(f)
client=XhsClient(cookies)

permit=client.get_upload_permit(file_type="video",count=1)
file_id=permit["fileId"]
client.upload_file(file_id,permit["token"],video_path,content_type="video/mp4",upload_addr=permit.get("uploadAddr"))
time.sleep(10)

import json as _j
bb={"version":1,"noteId":0,"noteOrderBind":{},"notePostTiming":{"postTime":None},"noteCollectionBind":{"id":""}}
data={
    "common":{
        "type":"video","title":title,"note_id":"","desc":desc,
        "source":'{"type":"web","ids":"","extraInfo":"{\\"subType\\":\\"official\\"}"}',
        "business_binds":_j.dumps(bb),"ats":[],"hash_tag":[],"post_loc":{},
        "privacy_information":{"op_type":1,"type":0},
    },
    "image_info":None,
    "video_info":{"file_id":file_id,"metadata":{"source":-1}},
}

try:
    result=client._main_api_post("/web_api/sns/v2/note",data,{"origin":CREATOR_HOST,"referer":f"{CREATOR_HOST}/"})
    nid=result.get("id","")
    print(_j.dumps({"success":True,"note_id":nid}))
except Exception as e:
    print(_j.dumps({"success":False,"error":str(e)}))
`, [videoPath, title, body], {timeout:120000});
  if (r.success) console.log(`✅ RedNote video note posted! ID: ${r.note_id}`);
  else console.log(`❌ Failed: ${r.error}`);
  process.exit(r.success ? 0 : 1);
}

// ─── TikTok ───────────────────────────────────────────────────
function ttPost(videoPath, title, schedule, visibility) {
  if (!fs.existsSync(videoPath)) { console.log(`❌ File not found: ${videoPath}`); process.exit(1); }
  if (!fs.existsSync(TT_CLI)) { console.log('❌ TiktokAutoUploader not found'); process.exit(1); }

  // Copy video to TiktokAutoUploader's video dir
  fs.mkdirSync(TT_VIDEO_DIR, { recursive: true });
  const destPath = path.join(TT_VIDEO_DIR, path.basename(videoPath));
  fs.copyFileSync(videoPath, destPath);

  const ttArgs = [
    TT_CLI, 'upload',
    '-u', TT_USER,
    '-v', destPath,
    '-t', title,
  ];
  if (schedule > 0) ttArgs.push('-sc', String(schedule));
  if (visibility !== undefined) ttArgs.push('-vi', String(visibility));

  try {
    const cmd = `"${TT_PYTHON}" ${ttArgs.map(a => `"${a}"`).join(' ')}`;
    const output = execSync(cmd, { encoding: 'utf-8', timeout: 180000, stdio: ['pipe', 'pipe', 'pipe'] });
    console.log(`✅ TikTok video posted! @${TT_USER}`);
    if (output.trim()) console.log(`   ${output.trim().split('\n').pop()}`);
  } catch (err) {
    const stdout = err.stdout?.trim() || '';
    if (stdout.includes('successfully') || stdout.includes('Uploaded')) {
      console.log(`✅ TikTok video posted! @${TT_USER}`);
    } else {
      console.log(`❌ Failed: ${err.message}`);
      if (stdout) console.log(`   stdout: ${stdout.substring(0, 200)}`);
      process.exit(1);
    }
  }
}

// ─── CLI ──────────────────────────────────────────────────────
function val(args, ...flags) { for (const f of flags) { const i=args.indexOf(f); if(i>=0&&i+1<args.length) return args[i+1]; } return null; }

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) { console.log('Usage: social-post.js ig|rn|tt <command> [options]'); process.exit(0); }
  const [platform, command] = args;

  if (platform === 'ig') {
    if (command === 'sync') { await igSync(); return; }
    if (command === 'check') { igCheck(); return; }
    if (['reel','photo','video','carousel'].includes(command)) {
      const caption = val(args,'--caption','-c') || '';
      const ci = args.indexOf(command);
      const capi = args.indexOf('--caption');
      const files = args.slice(ci+1, capi>ci ? capi : args.length).filter(a=>!a.startsWith('-'));
      if (!files.length) { console.log('❌ No file specified'); process.exit(1); }
      if (!caption) { console.log('❌ --caption required'); process.exit(1); }
      igPost(command, files, caption);
      return;
    }
    console.log('❌ Use: sync, check, reel, photo, video, carousel'); process.exit(1);
  }

  if (platform === 'rn') {
    if (command === 'image') {
      const title = val(args,'--title','-t') || '';
      const body = val(args,'--body','-b') || '';
      const topic = val(args,'--topic') || null;
      const ci = args.indexOf('image');
      const ti = args.indexOf('--title');
      const files = args.slice(ci+1, ti>ci ? ti : args.length).filter(a=>!a.startsWith('-'));
      if (!files.length||!title||!body) { console.log('❌ Need files, --title, --body'); process.exit(1); }
      rnImage(files, title, body, topic);
      return;
    }
    if (command === 'video') {
      const ci = args.indexOf('video');
      const ti = args.indexOf('--title');
      const file = args[ci+1];
      const title = val(args,'--title','-t') || '';
      const body = val(args,'--body','-b') || '';
      if (!file||!title||!body) { console.log('❌ Need file, --title, --body'); process.exit(1); }
      rnVideo(file, title, body);
      return;
    }
    console.log('❌ Use: image, video'); process.exit(1);
  }

  // ─── TikTok ───────────────────────────────────────────────
  if (platform === 'tt' || platform === 'tiktok') {
    if (command === 'video' || !command) {
      const ci = args.indexOf(command || 'tt') + 1;
      const file = args[ci];
      const title = val(args, '--title', '-t') || '';
      const schedule = parseInt(val(args, '--schedule', '-sc') || '0', 10);
      const visibility = parseInt(val(args, '--visibility', '-vi') || '0', 10);
      if (!file || !title) { console.log('❌ Need file and --title'); process.exit(1); }
      ttPost(file, title, schedule, visibility);
      return;
    }
    console.log('❌ Use: video (or just tt <file> --title "...")'); process.exit(1);
  }

  console.log('❌ Platform: ig, rn, or tt'); process.exit(1);
}

main().catch(err => { console.error(`❌ Error: ${err.message}`); process.exit(1); });
