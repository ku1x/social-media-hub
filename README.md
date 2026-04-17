# Social Media Hub

Multi-platform social media automation: **browser keepalive + API posting**.

## Architecture

| Layer | Tool | Purpose |
|-------|------|---------|
| Keepalive | agent-browser (Playwright) | Maintain login sessions, visual login |
| Posting | clinstagram / instagrapi | API-based posting, no browser UI needed |

## Instagram (clinstagram)

Cookie bridge: Chrome CDP → `sessionid` → instagrapi → API posting

```bash
# Sync cookies from Chrome to instagrapi
node scripts/ig-cookie-bridge.js

# Post a Reel
node scripts/ig-cookie-bridge.js --test-reel video.mp4 --caption "Hello!"

# Check session
node scripts/ig-cookie-bridge.js --check
```

## Supported Platforms

| Platform | Keepalive | Posting | Account |
|----------|-----------|---------|---------|
| Instagram | Chrome CDP | clinstagram API | @loudsy.ai |
| Bilibili | agent-browser | bili-cli | Quark97 |
| Twitter/X | agent-browser | twitter-cli | @Ghosty4I |
| LinkedIn | agent-browser | agent-browser | Kui XU |
| Reddit | agent-browser | CDP + fetch | GhostyAi |
| RedNote | agent-browser | rednote-cli | Loudsy |
| TikTok | agent-browser | TiktokAutoUploader | @acg_ai |

## Scripts

- `ig-cookie-bridge.js` — Instagram cookie → instagrapi session bridge
- `keepalive.sh` — Multi-platform keepalive
- `login-*.sh` — Platform login scripts
- `reddit-text-post.js` / `reddit-image-post.js` — Reddit posting
- `linkedin-post.js` — LinkedIn posting

## Session Storage

- Instagram: `~/.openclaw/data/clinstagram/session.json`
- Browser cookies: `~/.openclaw/data/social-media-hub/cookies/`

## License

MIT
