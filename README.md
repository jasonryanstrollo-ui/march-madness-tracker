# 🏀 March Madness Upset Tracker

A real-time dashboard that monitors all college basketball games during March Madness and alerts you when a **favored team is trailing** — potential upsets in progress.

**Live on your phone in 5 minutes.**

---

## Features

- **Live score monitoring** — polls ESPN every 30 seconds for real-time scores
- **Upset detection** — flags games where the favorite is losing, using odds, seeds, or home-court advantage
- **Mobile-first** — designed for phones, installable as a home screen app (PWA)
- **Smart filtering** — view all games, live only, or just upset alerts
- **NCAA tournament toggle** — filter to March Madness games only
- **Team logos & seeds** — shows NCAA seeds when available
- **Zero config** — no API keys needed; uses ESPN's public scoreboard API

---

## Deploy to Vercel (5 min)

### Prerequisites
- A free [Vercel account](https://vercel.com/signup)
- A free [GitHub account](https://github.com/signup)

### Step-by-step

1. **Create a GitHub repository**
   - Go to https://github.com/new
   - Name it `march-madness-tracker`
   - Leave it public or private — either works
   - Click **Create repository**

2. **Push this code to GitHub**
   ```bash
   cd march-madness-tracker
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/march-madness-tracker.git
   git push -u origin main
   ```

3. **Deploy on Vercel**
   - Go to https://vercel.com/new
   - Click **Import Git Repository**
   - Select your `march-madness-tracker` repo
   - Framework preset should auto-detect **Next.js**
   - Click **Deploy**
   - Wait ~60 seconds for the build

4. **Open on your phone**
   - Vercel gives you a URL like `march-madness-tracker.vercel.app`
   - Open it on your phone's browser
   - **iOS**: Tap Share → "Add to Home Screen"
   - **Android**: Tap the menu → "Add to Home Screen"

That's it. You now have a live upset tracker on your phone.

---

## Project Structure

```
march-madness-tracker/
├── app/
│   ├── layout.js          # Root layout with PWA meta tags
│   ├── page.js            # Main dashboard UI (client component)
│   └── api/
│       └── scores/
│           └── route.js   # Serverless API — fetches ESPN scores
├── public/
│   └── manifest.json      # PWA manifest for home screen install
├── next.config.js
├── package.json
└── README.md
```

---

## How Favorites Are Determined

The tracker uses a priority system to figure out who's favored:

1. **Betting odds** (most accurate) — if ESPN provides spread data, the favored team from the line is used
2. **NCAA seed** — if seeds are available (tournament games), the lower seed number is the favorite
3. **Home court** — fallback for games without odds or seeds

An **upset alert** fires when a live game has the underdog leading.

---

## Customization

**Change poll interval** — in `app/page.js`, adjust `POLL_INTERVAL` (in milliseconds):
```js
const POLL_INTERVAL = 15000; // 15 seconds (more aggressive)
```

**Add app icons** — drop `icon-192.png` and `icon-512.png` into the `public/` folder for a proper home screen icon.

---

## Local Development

```bash
npm install
npm run dev
```

Open http://localhost:3000

---

## Notes

- ESPN's public API is free and doesn't require an API key, but it's unofficial — rate limiting is possible under heavy use
- The 30-second poll interval is a good balance between freshness and being respectful to the API
- Games are sorted: upset alerts first → live games → upcoming → completed
