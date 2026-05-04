# Architecture — Unity Rewards Dashboard

## Overview

Unity Rewards Dashboard is a Web3-enabled analytics application that visualizes on-chain rewards allocations for Unity node operators. Users authenticate via MetaMask, and the dashboard fetches allocation data from Supabase to render charts, summaries, and breakdowns per device (license).

The application supports two deployment modes:
- **Static-only** — `dashboard/public/` deployed to GitHub Pages, calling Supabase directly from the browser.
- **Full-stack** — an optional Express.js server at port 3000 that proxies and pre-aggregates Supabase data before serving it to the browser.

---

## Repository Layout

```
unity-rewards/
├── .github/workflows/deploy.yml   # GitHub Actions: deploy dashboard/public/ to GitHub Pages
├── dashboard/
│   ├── public/                    # Static frontend (served as-is to GitHub Pages)
│   │   ├── index.html             # Application shell (SPA)
│   │   ├── app.js                 # All client-side logic (~1 500 lines)
│   │   ├── config.js              # API endpoints & constants
│   │   ├── dateFilterUtils.js     # Date range helpers (tested)
│   │   ├── style.css              # Responsive stylesheet
│   │   └── licenses.json          # Device alias map (licenseId → friendly name)
│   ├── src/
│   │   ├── routes/api.js          # Express route handlers
│   │   └── services/
│   │       ├── authService.js     # In-memory bearer token store
│   │       ├── supabaseClient.js  # Supabase RPC calls
│   │       ├── aggregator.js      # Raw → metrics transformation
│   │       └── licensesService.js # Alias file loader
│   ├── tests/dateFilter.test.js   # Vitest unit tests
│   ├── server.js                  # Express entry point
│   └── package.json
├── frontend-design.md             # UI/UX reference document
└── README.md
```

---

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JavaScript (ES Modules), Chart.js (CDN) |
| Backend | Node.js ≥ 18, Express 4.x |
| Database | Supabase (PostgreSQL, accessed via RPC over HTTPS) |
| Authentication | MetaMask Web3 wallet + Ethereum-compatible chain (ID 869) |
| Testing | Vitest 2.x |
| Deployment | GitHub Pages (static), GitHub Actions (CI/CD) |

---

## Data Flow

```
Browser (MetaMask)
       │
       │  1. Sign Web3 message → POST /auth/v1/token
       ▼
api.unityedge.io  ──── access_token ────▶  sessionStorage
                                                 │
                          ┌──────────────────────┘
                          │  2. Fetch allocations
                          ▼
               Option A — Static deployment:
                  Browser ──▶ Supabase RPC directly

               Option B — Full-stack deployment:
                  Browser ──▶ Express /api/allocations/live
                                      │
                                      ▼
                               supabaseClient.js
                                      │
                                      ▼
                               aggregator.js  (group, sum, average)
                                      │
                                      ▼
                  Browser ◀── JSON { summaries, totals, averages, meta }
                          │
                          ▼
                   Chart.js renders charts + table
```

---

## Authentication Flow

1. User clicks **Connect Wallet** → MetaMask prompts for account access.
2. App signs a message with MetaMask (`personal_sign`).
3. Signed payload is `POST`ed to `https://api.unityedge.io/auth/v1/token?grant_type=web3`.
4. Response contains `access_token` + `refresh_token`; both are stored in `sessionStorage` (cleared on tab close).
5. All subsequent Supabase calls include `Authorization: Bearer {access_token}`.
6. A 5-minute skew tolerance is applied before triggering token refresh.
7. On 401 from Supabase, the server clears the token and the client re-prompts for login.

---

## Backend Services

### `server.js`
Express entry point. Registers CORS, serves `dashboard/public/` as static assets, mounts `/api` router, and falls back to `index.html` for all unmatched routes (SPA support).

### `routes/api.js`

| Method | Path | Auth required | Purpose |
|--------|------|:---:|---------|
| `POST` | `/api/auth/token` | No | Store bearer token in memory |
| `GET` | `/api/auth/status` | No | Return whether a token is held |
| `GET` | `/api/allocations/live` | Yes | Fetch from Supabase and return aggregated data |

### `services/authService.js`
Single-module in-memory token store. Provides `setToken`, `getToken`, `clearToken`, and `isAuthenticated`. No persistence — restarts lose the token.

### `services/supabaseClient.js`
Calls the Supabase RPC function `rewards_get_allocations` with the bearer token and returns the raw array:
```js
{ completedAt: "2026-02-25T10:30:00Z", licenseId: "0x046e...", amountMicros: 1500000 }
```

### `services/aggregator.js`
Transforms raw allocations into dashboard-ready metrics:
- Groups by UTC date + `licenseId`.
- Converts `amountMicros` → amounts (`÷ 1 000 000`).
- Computes `count`, `totalAmount`, `averageAmount` per (date, license) pair.
- Derives per-device averages (`averages.perDevice`) and per-day totals (`averages.perDay`).
- Returns `{ summaries, totals, averages, meta }`.

### `services/licensesService.js`
Lazy-loads `licenses.json` on first request and maps `licenseId → { alias, group? }`. Falls back to the last 4 characters of the license ID when no alias is defined.

---

## Frontend (`app.js`)

`app.js` is a single-file client application (~1 500 lines) with no build step. Key responsibilities:

### State
A mutable global state object tracks: authenticated user, current raw data, active filter, chart instances, and sort configuration.

### Authentication
- Detects existing `sessionStorage` tokens on load and skips MetaMask if still valid.
- Handles token refresh with retry logic before expiry.
- `logout()` clears all session state and returns to the auth screen.

### Data Loading
- `loadData()` — fetches `/api/allocations/live` (server) or Supabase directly (static mode), applies the active date filter, and drives all chart/table renders.
- `loadSummary()` — calls `rewards_get_allocations_summary` for KPI cards (All Time, Last 7 Days, This Week, Today).
- `loadBalance()` — calls `rewards_get_balance` for the Redeemable KPI card.
- Auto-refresh runs every 5 minutes (`REFRESH_INTERVAL_MS`).

### Charts (Chart.js)
| Chart | Type | Data |
|-------|------|------|
| Daily Total | Line | `averages.perDay` |
| Average per License | Bar | `averages.perDevice` |
| Distribution | Custom histogram | `summaries` |
| Daily by Group | Area/Line | `summaries` filtered by group |
| Single License | Line | `summaries` for selected license |

Charts are rendered into `<canvas>` elements and destroyed/recreated on data refresh.

### UI Features
- **Date filter** — 5 presets: Current Week, Last Week, Current Month, Last Month, Last 3 Months.
- **Card overlay** — clicking the expand icon opens a chart full-screen; ESC or outside click closes it.
- **Sortable table** — click column headers to toggle ascending/descending sort.
- **Device filter** — per-group and per-device dropdowns filter chart and table data.
- **Daily Movers** — top 5 gainers and losers by day-over-day delta.
- **License file upload** — users can upload a JSON alias file without a server restart.

---

## Date Filtering (`dateFilterUtils.js`)

Encapsulates all date arithmetic to keep `app.js` clean:

- `getDateFilterRange(filter)` → `{ start, end }` as `YYYY-MM-DD` strings.
- Uses UTC dates and Monday-based weeks (ISO 8601).
- Handles leap years and month-boundary edge cases.
- `filterDataByDateRange(data, filter)` — non-mutating filter that recomputes all derived metrics (`totals`, `averages`) from the filtered `summaries`.

Tested via Vitest with a frozen clock (Feb 25 2026) and 30+ test cases.

---

## Data Models

### Raw allocation (Supabase)
```ts
{
  completedAt: string;   // ISO 8601 UTC timestamp
  licenseId:   string;   // "0x046e..."
  amountMicros: number;  // integer, divide by 1 000 000 for display
}
```

### Processed summary (aggregator output)
```ts
{
  date:          string;  // "YYYY-MM-DD" UTC
  licenseId:     string;
  licenseAlias:  string;  // friendly name from licenses.json
  count:         number;
  totalAmount:   number;
  averageAmount: number;
}
```

### Full dashboard payload
```ts
{
  summaries: Summary[];
  totals:    { count: number; totalAmount: number };
  averages: {
    perDevice: { licenseAlias: string; totalAmount: number; averageAmount: number }[];
    perDay:    { date: string; count: number; totalAmount: number; averageAmount: number }[];
  };
  meta: { generatedAtUtc: string };
}
```

---

## Deployment

### GitHub Pages (static)
Triggered automatically on every push to `main`. The workflow uploads only `dashboard/public/` as the Pages artifact — no server is involved.

**Live URL**: `https://daniel1941.github.io/unity-rewards/dashboard/public/`

### Local (full-stack)
```bash
cd dashboard
npm install
npm start        # production
npm run dev      # watch mode (node --watch)
```
Server listens on `process.env.PORT` or `3000`.

---

## Testing

```bash
cd dashboard
npm test
```

Vitest runs `tests/dateFilter.test.js` with fake timers. No network calls are made. The server and aggregator are not yet covered by automated tests.

---

## Key Design Decisions

- **No build step** — The frontend uses native ES modules and CDN-hosted Chart.js. This eliminates tooling complexity at the cost of no bundling or tree-shaking.
- **`sessionStorage` for tokens** — Tokens are intentionally ephemeral; closing the tab forces re-authentication. This reduces the risk of token leakage compared to `localStorage`.
- **Server as optional proxy** — The aggregation server is optional. The static GitHub Pages deployment calls Supabase directly, while the full-stack mode adds server-side aggregation and a single `/api/allocations/live` endpoint.
- **Micros throughout** — All monetary amounts are stored and transmitted as integers (`amountMicros`) and converted only at the display layer.
- **UTC-only dates** — All date grouping and filtering uses UTC to avoid timezone drift across node operators in different regions.
