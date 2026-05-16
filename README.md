# Appian Associate Developer Exam Prep

A Progressive Web App (PWA) for practising the **Appian Associate Developer** certification exam. 60 questions, 60-minute countdown timer, proportional category sampling, and instant scoring with explanations — all in a self-contained vanilla HTML/CSS/JS app with no build tools or frameworks.

---

## Features

- **60-question timed sessions** — randomly sampled from your full question bank, weighted to mirror real exam category proportions
- **Single and multi-answer questions** — radio buttons for single-answer, checkboxes for multi-answer
- **Partial credit scoring** — 2 pts for fully correct, partial credit for correct-only selections, 0 for any wrong selection
- **Post-answer explanations** — see the correct answer and explanation before moving on
- **Results screen** — overall score, pass/fail badge, category-by-category breakdown
- **Answer review mode** — scroll through all 60 answers with colour-coded results
- **Session persistence** — refresh the page during a test and resume exactly where you left off (timer continues)
- **Offline support** — static assets cached by service worker; last-fetched questions available offline
- **PWA install** — installable on iOS and Android home screens

---

## Question Bank (Google Sheets)

Questions are loaded live from a public Google Sheet via CSV export.

### How to make the sheet public

1. Open your Google Sheet
2. Click **Share** → **Change to anyone with the link**
3. Set permission to **Viewer**
4. Click **Done**

The app uses the CSV export URL directly — no API key required once the sheet is public:

```
https://docs.google.com/spreadsheets/d/<YOUR_SHEET_ID>/export?format=csv&gid=0
```

### Expected column layout (row 1 = header)

| Column | Field |
|--------|-------|
| A | Sr. No. |
| B | Category |
| C | Question |
| D | Option A |
| E | Option B |
| F | Option C |
| G | Option D |
| H | Option E (optional) |
| I | Correct Answer(s) — single letter `B` or comma-separated `A, C` |
| J | Explanation |

---

## Deploy to GitHub Pages

The repo is already on GitHub. Enable Pages in three clicks:

1. Go to your repo → **Settings** → **Pages**
2. Under **Source**, select branch `main` and folder `/ (root)`
3. Click **Save**

GitHub will publish the app at `https://<your-username>.github.io/AppianCertificationPrep/` within a minute or two.

> **CORS note:** The Google Sheets CSV URL works from GitHub Pages because Google allows cross-origin CSV requests on public sheets. If you see a load error, double-check the sheet is set to "Anyone with the link can view."

---

## Run Locally

Browsers block service worker registration on `file://` URLs. Serve over HTTP instead:

```bash
# Option 1 — npx (no install)
npx serve . -l 3000

# Option 2 — Python (if installed)
python -m http.server 3000

# Option 3 — VS Code Live Server extension
# Right-click index.html → Open with Live Server
```

Then open `http://localhost:3000`.

---

## File Structure

```
AppianCertificationPrep/
├── index.html          — App shell and all screen markup
├── style.css           — All styles; CSS custom properties for theming
├── app.js              — All application logic (no frameworks)
├── manifest.json       — PWA manifest
├── service-worker.js   — Cache-first SW; network-first for CSV
├── icons/
│   ├── icon.svg        — Scalable app icon
│   ├── icon-maskable.svg — Android adaptive icon (full-bleed)
│   ├── icon-192.png    — Required by PWA spec
│   └── icon-512.png    — Required by PWA spec
└── README.md
```

---

## Scoring Rules

| Scenario | Points |
|----------|--------|
| Single-answer: correct | 2 |
| Single-answer: wrong | 0 |
| Multi-answer: all correct, none wrong | 2 |
| Multi-answer: K of N correct, zero wrong | floor(K/N × 2) |
| Multi-answer: any wrong selected | 0 |
| Skipped / timed out | 0 |

Maximum score: **120 points** (60 questions × 2 pts). Passing threshold: **73%** (≈ 88 pts).

---

## Category Weights

The question selector mirrors real exam proportions:

| Category | Weight |
|----------|--------|
| Interface Design | 19% |
| Process Models | 17% |
| Expression Rules | 15% |
| Introduction to Appian Platform | 14% |
| Data Persistence | 13% |
| Records | 13% |
| General Appian Principles | 9% |
