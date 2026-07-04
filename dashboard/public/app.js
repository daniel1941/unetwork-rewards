import { filterDataByDateRange } from './dateFilterUtils.js';

// Configuration
const UNITY_CONFIG = window.UNITY_CONFIG || {};
const AUTH_BASE_URL = UNITY_CONFIG.BASE_URL || "https://api.unityedge.io";
const REFRESH_INTERVAL_MS = UNITY_CONFIG.REFRESH_INTERVAL_MS || 300000;
const SUPABASE_URL = UNITY_CONFIG.SUPABASE_URL || "https://vtllpagtmncbkywsqccd.supabase.co/rest/v1/rpc/rewards_get_allocations";
const SUMMARY_URL = UNITY_CONFIG.SUMMARY_URL || "https://vtllpagtmncbkywsqccd.supabase.co/rest/v1/rpc/rewards_get_allocations_summary?limit=1";
const BALANCE_URL = UNITY_CONFIG.BALANCE_URL || "https://vtllpagtmncbkywsqccd.supabase.co/rest/v1/rpc/rewards_get_balance";
const LICENSES_URL = UNITY_CONFIG.LICENSES_URL || "https://api.unityedge.io/functions/v1/licenses_get_licenses";
const LICENSE_GROUPS_URL = UNITY_CONFIG.LICENSE_GROUPS_URL || "https://api.unityedge.io/functions/v1/license_groups_get_all";
const LICENSE_ANALYTICS_URL = UNITY_CONFIG.LICENSE_ANALYTICS_URL || "https://api.unityedge.io/rest/v1/rpc/license_analytics_get_by_license";
const API_KEY = UNITY_CONFIG.API_KEY || "";
const TOKEN_URL = UNITY_CONFIG.TOKEN_URL || "https://api.unityedge.io/auth/v1/token?grant_type=web3";
const CHAIN_ID = UNITY_CONFIG.CHAIN_ID || "";
const DOMAIN = UNITY_CONFIG.DOMAIN || "unitynodes.io";
const URI = UNITY_CONFIG.URI || "https://unitynodes.io";
const TERMS_URL = UNITY_CONFIG.TERMS_URL || "https://unitynodes.io/terms-and-conditions.html";
const DEBUG_INFO = UNITY_CONFIG.DEBUG_INFO !== undefined ? UNITY_CONFIG.DEBUG_INFO : true;

// State
let charts = {};
let currentData = null;
let expandedCardContext = null;
let tableSortState = { key: 'date', direction: 'desc' };
let licenseAliasMap = new Map();
let licenseGroupMap = new Map(); // Map<licenseId, Set<groupName>> — a license can belong to more than one group
let licenseUptimeMap = new Map(); // Map<licenseId, uptime 0–1> from LICENSES_URL
let licenseSearchQuery = '';
let licenseAnalyticsMap = new Map(); // Map<licenseId, Map<date, uptime 0–1>>
let availableGroups = [];
let selectedGroups = new Set();
let selectedLicenses = new Set();
let web3Account = '';
let web3Signature = '';
let web3Busy = false;
let refreshIntervalId = null;
let currentDateFilter = 'current_month';
let rawAllocations = null;

const tableComparators = {
    date: (a, b) => a.date.localeCompare(b.date),
    licenseId: (a, b) => (a.licenseId ?? '').localeCompare(b.licenseId ?? ''),
    license: (a, b) => resolveLicenseAlias(a.licenseId).localeCompare(resolveLicenseAlias(b.licenseId)),
    uptime: (a, b) => (licenseUptimeMap.get(a.licenseId) ?? -1) - (licenseUptimeMap.get(b.licenseId) ?? -1),
    count: (a, b) => a.count - b.count,
    totalAmount: (a, b) => a.totalAmount - b.totalAmount,
    averageAmount: (a, b) => a.averageAmount - b.averageAmount
};

const tableDefaultDirections = {
    date: 'desc',
    license: 'asc',
    count: 'desc',
    totalAmount: 'desc',
    averageAmount: 'desc'
};

function isLight() {
    return document.body.classList.contains('light');
}

function themeColor(dark, light) {
    return isLight() ? light : dark;
}

function getSeriesColor(index) {
    const dark  = ['#ff8c00','#00aaff','#cc44ff','#00cc44','#ff4444','#ffcc00','#4488ff','#ff6688'];
    const light = ['#cc6600','#0077aa','#9922bb','#007722','#aa1122','#aa8800','#2244aa','#aa2255'];
    const palette = isLight() ? light : dark;
    return palette[index % palette.length];
}

function bbgScales(opts = {}) {
    const base = {
        grid:   { color: themeColor('#1a1a1a', '#e0d8cc') },
        ticks:  { color: themeColor('#555555', '#88806e'), maxTicksLimit: 5 },
        border: { color: themeColor('#1e1e1e', '#d4cec0') }
    };
    return {
        x: { ...base, ...(opts.x || {}) },
        y: { ...base, beginAtZero: true, ...(opts.y || {}) }
    };
}

function applyChartTheme() {
    const light = isLight();
    Chart.defaults.color = light ? '#88806e' : '#555555';
    Chart.defaults.borderColor = light ? '#d4cec0' : '#1e1e1e';
    Chart.defaults.plugins.tooltip.backgroundColor = light ? '#f8f4ea' : '#111111';
    Chart.defaults.plugins.tooltip.titleColor      = light ? '#cc6600' : '#ff8c00';
    Chart.defaults.plugins.tooltip.bodyColor       = light ? '#1a1610' : '#d9d2c1';
    Chart.defaults.plugins.tooltip.borderColor     = light ? '#d4cec0' : '#1e1e1e';
}

function legendLabels() {
    return {
        color: themeColor('#555555', '#88806e'),
        font: { family: "'IBM Plex Mono', monospace", size: 11 },
        boxWidth: 8,
        boxHeight: 8,
        padding: 8
    };
}

function toggleTheme() {
    document.body.classList.toggle('light');
    localStorage.setItem('unity_theme', isLight() ? 'light' : 'dark');
    applyChartTheme();
    if (currentData) renderDashboard(getFilteredData());
}

// DOM Elements
const authStatus = document.getElementById('auth-status');
const walletMenu = document.getElementById('wallet-menu');
const summaryTotal = document.getElementById('summary-total');
const summaryDailyAverage = document.getElementById('summary-daily-average');
const summaryLast7 = document.getElementById('summary-last7');
const summaryWeek = document.getElementById('summary-week');
const summaryToday = document.getElementById('summary-today');
const summaryRedeemable = document.getElementById('summary-redeemable');
const debugAccessToken = document.getElementById('debug-access-token');
const debugRefreshToken = document.getElementById('debug-refresh-token');
const debugExpiresAt = document.getElementById('debug-expires-at');
const debugNextRefresh = document.getElementById('debug-next-refresh');
const authSection = document.getElementById('auth-section');
const dashboardContent = document.getElementById('dashboard-content');
const web3ConnectBtn = document.getElementById('web3-connect-btn');
const web3LoginBtn = document.getElementById('web3-login-btn');
const web3DisconnectBtn = document.getElementById('web3-disconnect-btn');
const web3Status = document.getElementById('web3-status');
const refreshBtn = document.getElementById('refresh-btn');
const logoutBtn = document.getElementById('logout-btn');
const cardOverlay = document.getElementById('card-overlay');
const cardOverlayBody = document.getElementById('card-overlay-body');
const cardOverlayClose = document.getElementById('card-overlay-close');
const dateFilterSelect = document.getElementById('date-filter');

// Init
document.addEventListener('DOMContentLoaded', () => {
    if (localStorage.getItem('unity_theme') === 'light') {
        document.body.classList.add('light');
    }

    Chart.defaults.font.family = "'IBM Plex Mono', 'Courier New', monospace";
    Chart.defaults.font.size = 12;
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.animation = false;
    Chart.defaults.interaction.mode = 'index';
    Chart.defaults.interaction.intersect = false;
    applyChartTheme();

    document.querySelectorAll('.theme-toggle-btn').forEach(btn => btn.addEventListener('click', toggleTheme));

    document.querySelectorAll('.date-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            currentDateFilter = btn.dataset.filter;
            document.querySelectorAll('.date-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            if (currentData) renderDashboard(getFilteredData());
        });
    });

    initFilterDropdowns();
    initializeCardExpansion();
    initializeTableSorting();
    updateWeb3Ui();
    if (!DEBUG_INFO) {
        const debugElement = document.getElementById('token-debug');
        if (debugElement) {
            debugElement.style.display = 'none';
        }
    }

    checkAuth();
});

// Event Listeners
if (dateFilterSelect) {
    dateFilterSelect.addEventListener('change', () => {
        currentDateFilter = dateFilterSelect.value;
        if (currentData) {
            renderDashboard(getFilteredData());
        }
    });
}

if (web3ConnectBtn) {
    web3ConnectBtn.addEventListener('click', connectWallet);
}

if (web3LoginBtn) {
    web3LoginBtn.addEventListener('click', loginWithWallet);
}

if (web3DisconnectBtn) {
    web3DisconnectBtn.addEventListener('click', disconnectWallet);
}


if (refreshBtn) {
    refreshBtn.addEventListener('click', loadData);
}
logoutBtn.addEventListener('click', logout);

// Functions
function getFilteredData() {
    if (!currentData) return null;
    return filterDataByDateRange(currentData, currentDateFilter);
}

function licenseInSelectedGroups(licenseId) {
    const groups = licenseGroupMap.get(licenseId);
    if (!groups) return false;
    for (const g of selectedGroups) {
        if (groups.has(g)) return true;
    }
    return false;
}

function getGlobalFilteredSummaries() {
    const filtered = getFilteredData();
    if (!filtered) return [];
    let summaries = filtered.summaries;

    if (selectedGroups.size > 0) {
        summaries = summaries.filter(s => licenseInSelectedGroups(s.licenseId));
    }
    if (selectedLicenses.size > 0) {
        summaries = summaries.filter(s => selectedLicenses.has(resolveLicenseAlias(s.licenseId)));
    }
    return summaries;
}

function getAvailableLicenses() {
    const filtered = getFilteredData();
    if (!filtered) return [];
    let summaries = filtered.summaries;

    if (selectedGroups.size > 0) {
        summaries = summaries.filter(s => licenseInSelectedGroups(s.licenseId));
    }

    return [...new Set(summaries.map(s => resolveLicenseAlias(s.licenseId)))].sort();
}

function getFilteredLicenses() {
    if (licenseAliasMap.size > 0) {
        let entries = [...licenseAliasMap.entries()];
        if (selectedGroups.size > 0 && licenseGroupMap.size > 0) {
            entries = entries.filter(([id]) => licenseInSelectedGroups(id));
        }
        return [...new Set(entries.map(([, alias]) => alias))].sort();
    }
    return getAvailableLicenses();
}

function getFilteredLicenseEntries() {
    if (licenseAliasMap.size > 0) {
        let entries = [...licenseAliasMap.entries()];
        if (selectedGroups.size > 0 && licenseGroupMap.size > 0) {
            entries = entries.filter(([id]) => licenseInSelectedGroups(id));
        }
        const seen = new Map();
        for (const [id, alias] of entries) {
            if (!seen.has(alias)) seen.set(alias, { shortId: id.slice(-4), hasAlias: alias !== id });
        }
        return [...seen.entries()].map(([alias, { shortId, hasAlias }]) => ({ alias, shortId, hasAlias })).sort((a, b) => a.alias.localeCompare(b.alias));
    }
    return getAvailableLicenses().map(alias => ({ alias, shortId: null, hasAlias: true }));
}

function startAutoRefresh() {
    if (refreshIntervalId) return;
    refreshIntervalId = setInterval(() => {
        loadData();
        if (debugNextRefresh) {
            debugNextRefresh.textContent = new Date(Date.now() + REFRESH_INTERVAL_MS).toLocaleString();
        }
    }, REFRESH_INTERVAL_MS);
}

function stopAutoRefresh() {
    if (!refreshIntervalId) return;
    clearInterval(refreshIntervalId);
    refreshIntervalId = null;
}

function getAuthState() {
    const accessToken = sessionStorage.getItem('unity_rewards_token');
    const refreshToken = sessionStorage.getItem('unity_rewards_refresh_token');
    const expiresAt = sessionStorage.getItem('unity_rewards_expires_at');
    return {
        accessToken,
        refreshToken,
        expiresAt: expiresAt ? Number(expiresAt) : null
    };
}

function setAuthState({ accessToken, refreshToken, expiresAt }) {
    if (accessToken) {
        sessionStorage.setItem('unity_rewards_token', accessToken);
    }
    if (refreshToken) {
        sessionStorage.setItem('unity_rewards_refresh_token', refreshToken);
    }
    if (expiresAt) {
        sessionStorage.setItem('unity_rewards_expires_at', String(expiresAt));
    }
}

function needsRefresh(expiresAt, skewMinutes = 5) {
    if (!expiresAt) return false;
    const nowSeconds = Math.floor(Date.now() / 1000);
    return (expiresAt - nowSeconds) < (skewMinutes * 60);
}

async function refreshAccessToken(authState) {
    if (!authState.refreshToken) {
        return authState;
    }

    const response = await fetch(`${AUTH_BASE_URL}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: {
            apikey: API_KEY,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ refresh_token: authState.refreshToken })
    });

    if (!response.ok) {
        throw new Error('Refresh token request failed.');
    }

    const payload = await response.json().catch(() => ({}));
    const expiresAt = payload.expires_at
        ? Number(payload.expires_at)
        : (payload.expires_in ? Math.floor(Date.now() / 1000) + Number(payload.expires_in) : null);

    const updated = {
        accessToken: payload.access_token || authState.accessToken,
        refreshToken: payload.refresh_token || authState.refreshToken,
        expiresAt
    };

    setAuthState(updated);
    return updated;
}

async function ensureFreshAuth() {
    let authState = getAuthState();
    if (!authState.accessToken) return authState;

    if (authState.refreshToken && needsRefresh(authState.expiresAt)) {
        authState = await refreshAccessToken(authState);
    }

    return authState;
}

async function fetchWithAuth(url, options = {}, retryCount = 0) {
    let authState = await ensureFreshAuth();
    if (!authState.accessToken) {
        return { response: null, authState };
    }

    const headers = {
        ...(options.headers || {}),
        apikey: API_KEY,
        Authorization: `Bearer ${authState.accessToken}`
    };

    const response = await fetch(url, { ...options, headers });

    if (response.status === 401 && retryCount === 0 && authState.refreshToken) {
        authState = await refreshAccessToken(authState);
        return fetchWithAuth(url, options, 1);
    }

    return { response, authState };
}

function formatMicros(value) {
    if (value === null || value === undefined) return '-';
    const numeric = Number(value);
    if (Number.isNaN(numeric)) return '-';
    const scaled = numeric / 1_000_000;
    return scaled.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function resetSummary() {
    if (!summaryTotal) return;
    if (summaryDailyAverage) {
        summaryDailyAverage.textContent = '-';
    }
    summaryTotal.textContent = '-';
    summaryLast7.textContent = '-';
    summaryWeek.textContent = '-';
    summaryToday.textContent = '-';
    if (summaryRedeemable) {
        summaryRedeemable.textContent = '-';
    }
}

async function loadSummary() {
    if (!summaryTotal) {
        resetSummary();
        return;
    }

    try {
        const { response } = await fetchWithAuth(SUMMARY_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });

        if (!response || response.status === 401) {
            resetSummary();
            return;
        }

        const payload = await response.json().catch(() => []);
        const summary = Array.isArray(payload) ? payload[0] : null;

        summaryTotal.textContent = formatMicros(summary?.totalAmountMicros);
        summaryLast7.textContent = formatMicros(summary?.last7DaysAmountMicros);
        summaryWeek.textContent = formatMicros(summary?.thisWeekAmountMicros);
        summaryToday.textContent = formatMicros(summary?.todayAmountMicros);
    } catch (err) {
        console.error(err);
        resetSummary();
    }
}

async function loadBalance() {
    if (!summaryRedeemable) {
        if (summaryRedeemable) summaryRedeemable.textContent = '-';
        return;
    }

    try {
        const { response } = await fetchWithAuth(BALANCE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({})
        });

        if (!response || response.status === 401) {
            summaryRedeemable.textContent = '-';
            return;
        }

        const payload = await response.json().catch(() => null);
        summaryRedeemable.textContent = formatMicros(payload);
    } catch (err) {
        console.error(err);
        summaryRedeemable.textContent = '-';
    }
}

async function loadLicenses() {
    try {
        const pageSize = 20;
        let page = 1;
        const allLicenses = [];

        while (true) {
            const { response } = await fetchWithAuth(LICENSES_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    role: 'uno',
                    page,
                    pageSize,
                    skip: (page - 1) * pageSize,
                    take: pageSize
                })
            });
            if (!response || !response.ok) break;
            const batch = await response.json().catch(() => []);
            if (!Array.isArray(batch) || batch.length === 0) break;
            allLicenses.push(...batch);
            if (batch.length < pageSize) break;
            page++;
        }

        const licenses = allLicenses;
        if (licenses.length === 0) return;

        licenseAliasMap = new Map();
        licenseUptimeMap = new Map();
        for (const lic of licenses) {
            if (!lic.id) continue;
            licenseAliasMap.set(lic.id, (lic.alias || lic.deviceName || lic.id).trim());
            if (lic.uptime != null) licenseUptimeMap.set(lic.id, lic.uptime);
        }

        buildGroupDropdown();
        buildLicensesDropdown();

        if (rawAllocations) {
            currentData = processAllocations(rawAllocations);
            renderDashboard(getFilteredData());
        } else if (currentData) {
            rerenderCharts();
        }

        loadLicenseAnalytics(); // fetches per-day uptime for all licenses, re-renders when done
    } catch (err) {
        console.error('Failed to load licenses:', err);
    }
}

async function loadGroups() {
    try {
        const { response } = await fetchWithAuth(LICENSE_GROUPS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        if (!response || !response.ok) return;
        const groups = await response.json();
        if (!Array.isArray(groups)) return;

        const groupMap = new Map();
        for (const group of groups) {
            for (const licenseId of (group.licenseIds || [])) {
                if (!groupMap.has(licenseId)) groupMap.set(licenseId, new Set());
                groupMap.get(licenseId).add(group.name);
            }
        }
        licenseGroupMap = groupMap;
        availableGroups = groups.map(g => g.name).sort();
        buildGroupDropdown();

        if (currentData) rerenderCharts();
    } catch (err) {
        console.error('Failed to load groups:', err);
    }
}

async function loadLicenseAnalytics() {
    const licenseIds = [...licenseAliasMap.keys()];
    if (licenseIds.length === 0) return;

    licenseAnalyticsMap = new Map();
    const BATCH = 20;

    for (let i = 0; i < licenseIds.length; i += BATCH) {
        await Promise.all(licenseIds.slice(i, i + BATCH).map(async licenseId => {
            try {
                const { response } = await fetchWithAuth(LICENSE_ANALYTICS_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ licenseId, startDate: '2025-01-01', endDate: '2030-01-01' })
                });
                if (!response || !response.ok) return;
                const data = await response.json();
                if (!Array.isArray(data)) return;
                const dayMap = new Map();
                data.forEach(({ date, uptime }) => { if (date && uptime != null) dayMap.set(date, uptime); });
                licenseAnalyticsMap.set(licenseId, dayMap);
            } catch (e) {
                console.warn('Analytics fetch failed for', licenseId, e);
            }
        }));
    }

    if (currentData) renderDashboard(getFilteredData());
}

function updateWeb3Ui(message) {
    if (!web3Status || !web3ConnectBtn || !web3LoginBtn || !web3DisconnectBtn) return;

    const hasConfig = Boolean(API_KEY && CHAIN_ID);
    const hasWallet = Boolean(web3Account);
    const statusMessage = message
        || (hasWallet ? `Wallet connected: ${web3Account}` : 'Wallet not connected.');

    web3Status.textContent = statusMessage;
    web3ConnectBtn.disabled = web3Busy;
    web3LoginBtn.disabled = web3Busy || !hasWallet || !hasConfig;
    web3DisconnectBtn.disabled = web3Busy || !hasWallet;

    if (!hasConfig && hasWallet) {
        web3Status.textContent = 'Missing API key or chain ID in config.js.';
    }
}

function buildWeb3Message(walletAddress) {
    const issuedAt = new Date().toISOString();
    return `${DOMAIN} wants you to sign in with your Ethereum account:\n${walletAddress}\n\nI accept the UnityNodes Terms of Service: ${TERMS_URL}\nURI: ${URI}\nVersion: 1\nChain ID: ${CHAIN_ID}\nIssued At: ${issuedAt}`;
}

async function connectWallet() {
    if (!window.ethereum) {
        updateWeb3Ui('MetaMask is not available in this browser.');
        return;
    }

    try {
        web3Busy = true;
        updateWeb3Ui('Connecting to MetaMask...');
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        web3Account = accounts?.[0] || '';
        updateWeb3Ui();
    } catch (err) {
        updateWeb3Ui(err?.message || 'Failed to connect wallet.');
    } finally {
        web3Busy = false;
        updateWeb3Ui();
    }
}

function disconnectWallet() {
    web3Account = '';
    web3Signature = '';
    updateWeb3Ui('Wallet disconnected.');
}

async function loginWithWallet() {
    if (!window.ethereum) {
        updateWeb3Ui('MetaMask is not available in this browser.');
        return;
    }

    if (!API_KEY || !CHAIN_ID) {
        updateWeb3Ui('Missing API key or chain ID in config.js.');
        return;
    }

    if (!web3Account) {
        updateWeb3Ui('Connect your wallet first.');
        return;
    }

    try {
        web3Busy = true;
        updateWeb3Ui('Signing message...');

        const message = buildWeb3Message(web3Account);
        const signed = await window.ethereum.request({
            method: 'personal_sign',
            params: [message, web3Account]
        });

        web3Signature = signed;

        const response = await fetch(TOKEN_URL, {
            method: 'POST',
            headers: {
                accept: '*/*',
                apikey: API_KEY,
                authorization: `Bearer ${API_KEY}`,
                'content-type': 'application/json;charset=UTF-8',
                'x-client-info': 'supabase-js-web/2.84.0',
                'x-supabase-api-version': '2024-01-01'
            },
            body: JSON.stringify({
                chain: 'ethereum',
                message,
                signature: signed
            })
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload?.error || payload?.message || 'Web3 login failed.');
        }

        const accessToken = payload?.access_token || payload?.token || payload?.session?.access_token;
        if (!accessToken) {
            throw new Error('Token missing from Web3 response.');
        }

        const refreshToken = payload?.refresh_token;
        const expiresAt = payload?.expires_at
            ? Number(payload.expires_at)
            : (payload?.expires_in ? Math.floor(Date.now() / 1000) + Number(payload.expires_in) : null);

        setAuthState({ accessToken, refreshToken, expiresAt });
        sessionStorage.setItem('unity_rewards_wallet', web3Account);
        updateWeb3Ui('Web3 login successful. Token stored.');
        checkAuth();
    } catch (err) {
        updateWeb3Ui(err?.message || 'Web3 login failed.');
    } finally {
        web3Busy = false;
        updateWeb3Ui();
    }
}


function resolveLicenseAlias(licenseId) {
    if (licenseAliasMap.has(licenseId)) {
        return licenseAliasMap.get(licenseId);
    }
    if (!licenseId) return 'Unknown';
    return licenseId.length > 4 ? `...${licenseId.slice(-4)}` : licenseId;
}

// ── Filter Dropdowns ──────────────────────────────────────

const GROUP_LIMIT = 3;
const LICENSE_LIMIT = 5;

function refreshGroupDisabledState() {
    const panel = document.getElementById('group-dropdown-panel');
    if (!panel) return;
    const atLimit = selectedGroups.size >= GROUP_LIMIT;
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.disabled = atLimit && !cb.checked;
    });
}

function refreshLicensesDisabledState() {
    const panel = document.getElementById('licenses-dropdown-panel');
    if (!panel) return;
    const atLimit = selectedLicenses.size >= LICENSE_LIMIT;
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.disabled = atLimit && !cb.checked;
    });
}

function updateFilterCount(countId, count) {
    const countEl = document.getElementById(countId);
    if (!countEl) return;
    countEl.textContent = count;
    countEl.classList.toggle('visible', count > 0);
    const trigger = countEl.closest('.filter-dropdown')?.querySelector('.filter-dropdown-btn');
    if (trigger) trigger.classList.toggle('has-selection', count > 0);
}

function buildGroupDropdown() {
    const panel = document.getElementById('group-dropdown-panel');
    const trigger = document.getElementById('group-dropdown-trigger');
    if (!panel || !trigger) return;

    const hasGroups = availableGroups.length > 0;
    trigger.disabled = !hasGroups;
    panel.innerHTML = '';

    if (!hasGroups) {
        updateFilterCount('group-count', 0);
        return;
    }

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'filter-dropdown-clear';
    clearBtn.textContent = 'Clear all';
    clearBtn.style.display = selectedGroups.size > 0 ? '' : 'none';
    clearBtn.addEventListener('click', e => {
        e.stopPropagation();
        selectedGroups.clear();
        const available = new Set(getFilteredLicenses());
        for (const lic of [...selectedLicenses]) {
            if (!available.has(lic)) selectedLicenses.delete(lic);
        }
        updateFilterCount('group-count', 0);
        buildGroupDropdown();
        buildLicensesDropdown();
        rerenderCharts();
    });
    panel.appendChild(clearBtn);

    availableGroups.forEach(group => {
        const item = document.createElement('label');
        item.className = 'filter-dropdown-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = group;
        cb.checked = selectedGroups.has(group);
        cb.addEventListener('change', () => {
            if (cb.checked) selectedGroups.add(group);
            else selectedGroups.delete(group);

            // Drop selected licenses no longer in scope
            const available = new Set(getFilteredLicenses());
            for (const lic of [...selectedLicenses]) {
                if (!available.has(lic)) selectedLicenses.delete(lic);
            }

            updateFilterCount('group-count', selectedGroups.size);
            refreshGroupDisabledState();
            buildLicensesDropdown();
            rerenderCharts();
        });
        item.appendChild(cb);
        item.appendChild(document.createTextNode(' ' + group));
        panel.appendChild(item);
    });

    updateFilterCount('group-count', selectedGroups.size);
    refreshGroupDisabledState();
}

function buildLicensesDropdown() {
    const panel = document.getElementById('licenses-dropdown-panel');
    const trigger = document.getElementById('licenses-dropdown-trigger');
    if (!panel || !trigger) return;

    panel.innerHTML = '';

    const searchWrap = document.createElement('div');
    searchWrap.className = 'filter-dropdown-search';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'Search...';
    searchInput.value = licenseSearchQuery;
    searchInput.className = 'filter-dropdown-search-input';
    searchInput.addEventListener('click', e => e.stopPropagation());
    searchInput.addEventListener('input', e => {
        licenseSearchQuery = e.target.value;
        applyLicenseSearch(panel);
    });
    searchWrap.appendChild(searchInput);
    panel.appendChild(searchWrap);

    const licenseEntries = getFilteredLicenseEntries();
    trigger.disabled = licenseEntries.length === 0;

    licenseEntries.forEach(({ alias, shortId, hasAlias }) => {
        const item = document.createElement('label');
        item.className = 'filter-dropdown-item';
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.value = alias;
        cb.checked = selectedLicenses.has(alias);
        cb.addEventListener('change', () => {
            if (cb.checked) selectedLicenses.add(alias);
            else selectedLicenses.delete(alias);
            updateFilterCount('licenses-count', selectedLicenses.size);
            refreshLicensesDisabledState();
            rerenderCharts();
        });
        item.appendChild(cb);
        const label = hasAlias ? alias + (shortId ? ' (' + shortId + ')' : '') : shortId ?? alias;
        item.appendChild(document.createTextNode(' ' + label));
        panel.appendChild(item);
    });

    applyLicenseSearch(panel);
    updateFilterCount('licenses-count', selectedLicenses.size);
    refreshLicensesDisabledState();
}

function applyLicenseSearch(panel) {
    const q = licenseSearchQuery.toLowerCase();
    panel.querySelectorAll('.filter-dropdown-item').forEach(item => {
        item.style.display = !q || item.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
}
function initFilterDropdowns() {
    document.querySelectorAll('.filter-dropdown').forEach(dropdown => {
        const trigger = dropdown.querySelector('.filter-dropdown-btn');
        const panel = dropdown.querySelector('.filter-dropdown-panel');
        if (!trigger || !panel) return;
        trigger.addEventListener('click', e => {
            e.stopPropagation();
            document.querySelectorAll('.filter-dropdown-panel').forEach(p => {
                if (p !== panel) p.classList.remove('open');
            });
            panel.classList.toggle('open');
            if (panel.classList.contains('open')) {
                const si = panel.querySelector('.filter-dropdown-search-input');
                if (si) setTimeout(() => si.focus(), 0);
            }
        });
    });

    document.addEventListener('click', () => {
        document.querySelectorAll('.filter-dropdown-panel.open').forEach(p => p.classList.remove('open'));
    });
}

// ── Auth ──────────────────────────────────────────────────

function checkAuth() {
    const authState = getAuthState();
    const token = authState.accessToken;
    if (!web3Account) {
        const storedWallet = sessionStorage.getItem('unity_rewards_wallet');
        if (storedWallet) {
            web3Account = storedWallet;
        }
    }
    const shortWallet = web3Account
        ? `${web3Account.slice(0, 4)}...${web3Account.slice(-4)}`
        : 'Not connected';

    if (token) {
        document.body.classList.remove('wallet-disconnected');
        authStatus.textContent = `Wallet: ${shortWallet}`;
        authStatus.className = 'status-badge active';
        authStatus.style.display = 'inline-flex';
        if (walletMenu) {
            walletMenu.style.display = 'inline-flex';
        }
        if (debugAccessToken) {
            const access = authState.accessToken;
            debugAccessToken.textContent = access
                ? `${access.slice(0, 5)}...${access.slice(-5)}`
                : '-';
        }
        if (debugRefreshToken) {
            debugRefreshToken.textContent = authState.refreshToken || '-';
        }
        if (debugExpiresAt) {
            debugExpiresAt.textContent = authState.expiresAt
                ? new Date(authState.expiresAt * 1000).toLocaleString()
                : '-';
        }
        if (debugNextRefresh) {
            debugNextRefresh.textContent = new Date(Date.now() + REFRESH_INTERVAL_MS).toLocaleString();
        }
        startAutoRefresh();
        authSection.style.display = 'none';
        dashboardContent.style.display = 'grid';
        loadLicenses();
        loadGroups();
        loadData();
        loadSummary();
        loadBalance();
    } else {
        document.body.classList.add('wallet-disconnected');
        authStatus.textContent = '';
        authStatus.className = 'status-badge missing';
        authStatus.style.display = 'none';
        if (walletMenu) {
            walletMenu.style.display = 'none';
        }
        if (debugAccessToken) {
            debugAccessToken.textContent = '-';
        }
        if (debugRefreshToken) {
            debugRefreshToken.textContent = '-';
        }
        if (debugExpiresAt) {
            debugExpiresAt.textContent = '-';
        }
        if (debugNextRefresh) {
            debugNextRefresh.textContent = '-';
        }
        stopAutoRefresh();
        authSection.style.display = 'flex';
        dashboardContent.style.display = 'none';
        resetSummary();
    }
}

function logout() {
    if (confirm('Are you sure you want to logout? This will clear your session token.')) {
        sessionStorage.clear();
        currentData = null;
        rawAllocations = null;
        licenseAliasMap = new Map();
        licenseUptimeMap = new Map();
        licenseGroupMap = new Map();
        availableGroups = [];
        selectedGroups.clear();
        selectedLicenses.clear();
        web3Signature = '';
        web3Account = '';
        stopAutoRefresh();
        buildGroupDropdown();
        buildLicensesDropdown();
        checkAuth();
        updateWeb3Ui();
        resetSummary();
    }
}

// ── Card Expansion ────────────────────────────────────────

function initializeCardExpansion() {
    const expandableCards = document.querySelectorAll('[data-expandable="true"]');
    expandableCards.forEach(card => {
        const expandBtn = card.querySelector('.card-expand-btn');
        if (!expandBtn) return;
        expandBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            openCardOverlay(card, expandBtn);
        });
    });

    if (cardOverlayClose) {
        cardOverlayClose.addEventListener('click', closeCardOverlay);
    }

    if (cardOverlay) {
        cardOverlay.addEventListener('click', (event) => {
            if (event.target === cardOverlay) {
                closeCardOverlay();
            }
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeCardOverlay();
        }
    });
}

function initializeTableSorting() {
    const sortButtons = document.querySelectorAll('.sort-button[data-sort-key]');
    sortButtons.forEach(button => {
        button.addEventListener('click', () => {
            const key = button.dataset.sortKey;
            if (!key) return;

            if (tableSortState.key === key) {
                tableSortState.direction = tableSortState.direction === 'asc' ? 'desc' : 'asc';
            } else {
                tableSortState.key = key;
                tableSortState.direction = tableDefaultDirections[key] || 'asc';
            }

            if (currentData) {
                renderTable(getGlobalFilteredSummaries());
            } else {
                updateSortIndicators();
            }
        });
    });

    updateSortIndicators();
}

function updateSortIndicators() {
    const sortButtons = document.querySelectorAll('.sort-button[data-sort-key]');
    sortButtons.forEach(button => {
        const key = button.dataset.sortKey;
        button.classList.remove('sort-asc', 'sort-desc', 'is-active');
        if (key === tableSortState.key) {
            button.classList.add(`sort-${tableSortState.direction}`, 'is-active');
        }
    });
}

function openCardOverlay(card, trigger) {
    if (!cardOverlay || !cardOverlayBody) return;

    if (expandedCardContext?.card === card) {
        closeCardOverlay();
        return;
    }

    closeCardOverlay();

    expandedCardContext = {
        card,
        parent: card.parentNode,
        nextSibling: card.nextElementSibling,
        trigger
    };

    card.classList.add('is-expanded');
    cardOverlayBody.appendChild(card);
    cardOverlay.classList.add('visible');
    cardOverlay.setAttribute('aria-hidden', 'false');

    setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
    }, 50);
}

function closeCardOverlay() {
    if (cardOverlay) {
        cardOverlay.classList.remove('visible');
        cardOverlay.setAttribute('aria-hidden', 'true');
    }

    if (!expandedCardContext) return;

    const { card, parent, nextSibling, trigger } = expandedCardContext;
    card.classList.remove('is-expanded');

    if (parent) {
        if (nextSibling && nextSibling.parentNode === parent) {
            parent.insertBefore(card, nextSibling);
        } else {
            parent.appendChild(card);
        }
    }

    expandedCardContext = null;

    if (trigger) {
        trigger.focus();
    }

    window.dispatchEvent(new Event('resize'));
}

// ── Data Loading ──────────────────────────────────────────

async function loadData() {
    if (refreshBtn) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = 'Loading...';
    }

    try {
        const authState = getAuthState();
        if (!authState.accessToken) {
            checkAuth();
            return;
        }

        const BATCH_SIZE = 1000;
        let allAllocations = [];
        let skip = 0;
        let hasMore = true;

        while (hasMore) {
            const { response: allocationsRes } = await fetchWithAuth(SUPABASE_URL, {
                method: 'POST',
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ skip: skip, take: BATCH_SIZE })
            });

            if (!allocationsRes || allocationsRes.status === 401) {
                sessionStorage.removeItem('unity_rewards_token');
                sessionStorage.removeItem('unity_rewards_refresh_token');
                sessionStorage.removeItem('unity_rewards_expires_at');
                sessionStorage.removeItem('unity_rewards_wallet');
                checkAuth();
                throw new Error('Session expired. Please log in again.');
            }

            if (!allocationsRes.ok) {
                const err = await allocationsRes.json();
                throw new Error(err.message || 'Failed to fetch data');
            }

            const batchData = await allocationsRes.json();

            if (Array.isArray(batchData)) {
                allAllocations = allAllocations.concat(batchData);
                if (batchData.length < BATCH_SIZE) {
                    hasMore = false;
                } else {
                    skip += BATCH_SIZE;
                }
            } else {
                hasMore = false;
            }
        }

        rawAllocations = allAllocations;
        const rawData = allAllocations;
        const dates = rawData.map(i => i.completedAt);
        const uniqueDays = [...new Set(dates.map(d => d ? d.split('T')[0] : 'null'))];
        console.log('API Response Analysis:', {
            totalRecords: rawData.length,
            uniqueDays: uniqueDays,
            firstTimestamp: dates[0],
            lastTimestamp: dates[dates.length - 1],
            sampleRecord: rawData[0]
        });

        const processed = processAllocations(rawData);
        currentData = processed;
        renderDashboard(getFilteredData());

        const lastUpdatedEl = document.getElementById('last-updated');
        const nextRefreshEl = document.getElementById('next-refresh');
        if (lastUpdatedEl) lastUpdatedEl.textContent = `UPD ${new Date().toLocaleTimeString()}`;
        if (nextRefreshEl) nextRefreshEl.textContent = `NEXT ${new Date(Date.now() + REFRESH_INTERVAL_MS).toLocaleTimeString()}`;
        loadSummary();
        loadBalance();
    } catch (err) {
        console.error(err);
        alert('Failed to load data: ' + err.message);
    } finally {
        if (refreshBtn) {
            refreshBtn.disabled = false;
            refreshBtn.textContent = 'Refresh Data';
        }
    }
}

// ── Data Processing ───────────────────────────────────────

function processAllocations(allocations) {
    const grouped = {};

    for (const item of allocations) {
        if (!item.completedAt) continue;

        const dateObj = new Date(item.completedAt);
        const dateKey = dateObj.toISOString().split('T')[0];
        const licenseId = item.licenseId;
        const key = `${dateKey}|${licenseId}`;

        if (!grouped[key]) {
            grouped[key] = {
                date: dateKey,
                licenseId: licenseId,
                count: 0,
                sumMicros: 0,
                uptimeSum: 0,
                uptimeCount: 0
            };
        }

        grouped[key].count++;
        grouped[key].sumMicros += (item.amountMicros || 0);
        if (item.uptime != null) {
            grouped[key].uptimeSum += item.uptime;
            grouped[key].uptimeCount++;
        }
    }

    const summaries = Object.values(grouped).map(g => {
        const totalAmount = g.sumMicros / 1_000_000;
        const licenseAlias = resolveLicenseAlias(g.licenseId);

        return {
            date: g.date,
            licenseId: g.licenseId,
            licenseAlias: licenseAlias,
            count: g.count,
            totalAmount: totalAmount,
            averageAmount: g.count > 0 ? totalAmount / g.count : 0,
            averageUptime: g.uptimeCount > 0 ? g.uptimeSum / g.uptimeCount : null
        };
    });

    const totalCount = summaries.reduce((sum, s) => sum + s.count, 0);
    const grandTotalAmount = summaries.reduce((sum, s) => sum + s.totalAmount, 0);

    const deviceGroups = {};
    summaries.forEach(s => {
        if (!deviceGroups[s.licenseAlias]) deviceGroups[s.licenseAlias] = { total: 0, count: 0 };
        deviceGroups[s.licenseAlias].total += s.totalAmount;
        deviceGroups[s.licenseAlias].count += 1;
    });

    const averagePerDevice = Object.entries(deviceGroups).map(([name, data]) => ({
        licenseAlias: name,
        averageAmount: data.count > 0 ? data.total / data.count : 0,
        totalAmount: data.total
    }));

    const dayGroups = {};
    summaries.forEach(s => {
        if (!dayGroups[s.date]) dayGroups[s.date] = { total: 0, count: 0, recordCount: 0 };
        dayGroups[s.date].total += s.totalAmount;
        dayGroups[s.date].count += 1;
        dayGroups[s.date].recordCount += s.count;
    });

    const averagePerDay = Object.entries(dayGroups).map(([date, data]) => ({
        date: date,
        count: data.recordCount,
        deviceCount: data.count,
        totalAmount: data.total,
        averageAmount: data.count > 0 ? data.total / data.count : 0,
        averagePerReward: data.recordCount > 0 ? data.total / data.recordCount : 0
    })).sort((a, b) => a.date.localeCompare(b.date));

    let totalDailyDeviceAverages = 0;
    let dailyDeviceCount = 0;
    summaries.forEach(s => {
        if (s.count > 0) {
            totalDailyDeviceAverages += s.averageAmount;
            dailyDeviceCount++;
        }
    });
    const dailyAverageByDevice = dailyDeviceCount > 0 ? totalDailyDeviceAverages / dailyDeviceCount : 0;

    console.log('Processed Data:', {
        summariesCount: summaries.length,
        perDeviceCount: averagePerDevice.length,
        perDayCount: averagePerDay.length,
        firstDay: averagePerDay[0],
        lastDay: averagePerDay[averagePerDay.length - 1]
    });

    return {
        summaries: summaries.sort((a, b) => b.date.localeCompare(a.date) || a.licenseAlias.localeCompare(b.licenseAlias)),
        totals: {
            count: totalCount,
            totalAmount: grandTotalAmount
        },
        averages: {
            perDevice: averagePerDevice.sort((a, b) => b.averageAmount - a.averageAmount),
            perDay: averagePerDay,
            dailyByDevice: dailyAverageByDevice
        },
        meta: {
            generatedAtUtc: new Date().toISOString()
        }
    };
}

// ── Render ────────────────────────────────────────────────

function renderDashboard(data) {
    if (summaryDailyAverage) {
        summaryDailyAverage.textContent = data.averages.dailyByDevice.toFixed(2);
    }

    buildGroupDropdown();
    buildLicensesDropdown();

    const summaries = getGlobalFilteredSummaries();
    renderTotalAmountChart(summaries);
    renderAverageChart(summaries);
    renderTable(summaries);
}

function rerenderCharts() {
    if (!currentData) return;
    const summaries = getGlobalFilteredSummaries();
    renderTotalAmountChart(summaries);
    renderAverageChart(summaries);
    renderTable(summaries);
}

function renderTotalAmountChart(summaries) {
    const canvas = document.getElementById('totalAmountChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (charts.totalAmount) charts.totalAmount.destroy();

    const totalSumEl = document.getElementById('total-amount-sum');
    if (totalSumEl) {
        if (!summaries || summaries.length === 0) {
            totalSumEl.textContent = '';
        } else {
            const grandTotal = summaries.reduce((sum, s) => sum + s.totalAmount, 0);
            totalSumEl.textContent = grandTotal.toFixed(3);
        }
    }

    if (!summaries || summaries.length === 0) return;

    const dates = [...new Set(summaries.map(s => s.date))].sort();
    const activeGroups = [...selectedGroups];
    let datasets;

    if (activeGroups.length > 0) {
        datasets = activeGroups.map((group, i) => {
            const color = getSeriesColor(i);
            const byDate = new Map();
            summaries
                .filter(s => licenseGroupMap.get(s.licenseId)?.has(group))
                .forEach(s => byDate.set(s.date, (byDate.get(s.date) || 0) + s.totalAmount));
            return {
                label: group,
                data: dates.map(d => byDate.get(d) || 0),
                backgroundColor: color + 'b3',
                borderColor: color,
                borderWidth: 1
            };
        });
    } else {
        const color = getSeriesColor(0);
        const byDate = new Map();
        summaries.forEach(s => byDate.set(s.date, (byDate.get(s.date) || 0) + s.totalAmount));
        datasets = [{
            label: 'Total',
            data: dates.map(d => byDate.get(d) || 0),
            backgroundColor: color + 'b3',
            borderColor: color,
            borderWidth: 1
        }];
    }

    charts.totalAmount = new Chart(ctx, {
        type: 'bar',
        data: { labels: dates, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: datasets.length > 1,
                    labels: legendLabels()
                }
            },
            scales: bbgScales()
        }
    });
}

function renderAverageChart(summaries) {
    const canvas = document.getElementById('averageChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (charts.average) charts.average.destroy();
    if (!summaries || summaries.length === 0) return;

    const dates = [...new Set(summaries.map(s => s.date))].sort();
    const activeLicenses = [...selectedLicenses];
    let rewardDatasets;

    if (activeLicenses.length > 0) {
        rewardDatasets = activeLicenses.map((lic, i) => {
            const color = getSeriesColor(i);
            const byDate = new Map();
            summaries
                .filter(s => resolveLicenseAlias(s.licenseId) === lic)
                .forEach(s => byDate.set(s.date, s.averageAmount));
            return {
                type: 'line',
                label: lic,
                data: dates.map(d => byDate.has(d) ? byDate.get(d) : null),
                borderColor: color,
                backgroundColor: color + '14',
                tension: 0.1,
                fill: false,
                pointRadius: 2,
                pointHoverRadius: 4,
                spanGaps: true,
                yAxisID: 'y'
            };
        });
    } else {
        const dayAgg = new Map();
        summaries.forEach(s => {
            if (!dayAgg.has(s.date)) dayAgg.set(s.date, { total: 0, count: 0, licenses: 0 });
            const d = dayAgg.get(s.date);
            d.total += s.totalAmount;
            d.count += s.count;
            d.licenses += 1;
        });
        const c0 = getSeriesColor(0);
        const rewardsMeta = dates.map(d => dayAgg.get(d) || null);
        rewardDatasets = [{
            type: 'line',
            label: 'Avg',
            _meta: rewardsMeta,
            data: dates.map(d => {
                const agg = dayAgg.get(d);
                return agg && agg.licenses > 0 ? agg.total / agg.licenses : null;
            }),
            borderColor: c0,
            backgroundColor: c0 + '14',
            tension: 0.1,
            fill: dates.length > 1,
            pointRadius: 2,
            pointHoverRadius: 4,
            spanGaps: true,
            yAxisID: 'y'
        }];
    }

    // Per-day average uptime: average uptime of all licenses active on each date
    // Per-day average uptime: average across all licenses active on each date
    const uptimeByDay = new Map();
    summaries.forEach(s => {
        const dayMap = licenseAnalyticsMap.get(s.licenseId);
        if (!dayMap) return;
        const uptime = dayMap.get(s.date);
        if (uptime == null) return;
        if (!uptimeByDay.has(s.date)) uptimeByDay.set(s.date, { sum: 0, count: 0 });
        const u = uptimeByDay.get(s.date);
        u.sum += uptime;
        u.count += 1;
    });
    const uptimeScale = 100; // API returns 0–1 decimals

    const hasUptimeData = uptimeByDay.size > 0;
    const uptimeDataset = {
        type: 'bar',
        label: 'Uptime %',
        data: dates.map(d => {
            const u = uptimeByDay.get(d);
            return u && u.count > 0 ? (u.sum / u.count) * uptimeScale : null;
        }),
        backgroundColor: themeColor('rgba(0,180,80,0.18)', 'rgba(0,140,60,0.18)'),
        borderColor: themeColor('#00b450', '#00883c'),
        borderWidth: 1,
        yAxisID: 'y1'
    };

    const datasets = hasUptimeData ? [...rewardDatasets, uptimeDataset] : rewardDatasets;

    const legendCount = datasets.filter(d => d.type === 'line').length;

    charts.average = new Chart(ctx, {
        type: 'bar',
        data: { labels: dates, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: legendCount > 1,
                    labels: legendLabels()
                },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            if (ctx.dataset.label === 'Uptime %') {
                                const val = ctx.parsed.y;
                                return val != null ? ` Uptime: ${val.toFixed(2)}%` : null;
                            }
                            if (ctx.dataset._meta) {
                                const m = ctx.dataset._meta[ctx.dataIndex];
                                if (!m || m.licenses === 0) return null;
                                const result = (m.total / m.licenses).toFixed(6);
                                return ` Avg: ${m.total.toFixed(3)}/${m.licenses}=${result}`;
                            }
                            const val = ctx.parsed.y;
                            return val != null ? ` ${ctx.dataset.label}: ${val.toFixed(6)}` : null;
                        }
                    }
                }
            },
            scales: {
                ...bbgScales(),
                y1: {
                    position: 'right',
                    min: 0,
                    max: 100,
                    grid: { color: 'transparent' },
                    ticks: {
                        color: themeColor('#555555', '#88806e'),
                        maxTicksLimit: 5,
                        callback: v => v + '%'
                    },
                    border: { color: themeColor('#1e1e1e', '#d4cec0') }
                }
            }
        }
    });
}

function renderTable(summaries) {
    const tbody = document.querySelector('#daily-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!Array.isArray(summaries) || summaries.length === 0) {
        updateSortIndicators();
        return;
    }

    const comparator = tableComparators[tableSortState.key];
    const sorted = comparator
        ? [...summaries].sort((a, b) => {
            const result = comparator(a, b);
            return tableSortState.direction === 'asc' ? result : -result;
        })
        : summaries;

    sorted.forEach(row => {
        const tr = document.createElement('tr');
        const uptime = licenseUptimeMap.get(row.licenseId);
        tr.innerHTML = `
            <td>${row.date}</td>
            <td>${row.licenseId ? row.licenseId.slice(-4) : ''}</td>
            <td>${resolveLicenseAlias(row.licenseId)}</td>
            <td>${uptime != null ? (uptime * 100).toFixed(1) + '%' : '—'}</td>
            <td>${row.count}</td>
            <td>${row.totalAmount.toFixed(6)}</td>
            <td>${row.averageAmount.toFixed(6)}</td>
        `;
        tbody.appendChild(tr);
    });

    const rowCountEl = document.getElementById('row-count');
    if (rowCountEl) rowCountEl.textContent = `${sorted.length} ROWS`;

    updateSortIndicators();
}
