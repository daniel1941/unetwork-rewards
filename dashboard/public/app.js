import { filterDataByDateRange } from './dateFilterUtils.js';

// Configuration
const UNITY_CONFIG = window.UNITY_CONFIG || {};
const AUTH_BASE_URL = UNITY_CONFIG.BASE_URL || "https://api.unityedge.io";
const REFRESH_INTERVAL_MS = UNITY_CONFIG.REFRESH_INTERVAL_MS || 300000;
const SUPABASE_URL = UNITY_CONFIG.SUPABASE_URL || "https://vtllpagtmncbkywsqccd.supabase.co/rest/v1/rpc/rewards_get_allocations";
const SUMMARY_URL = UNITY_CONFIG.SUMMARY_URL || "https://vtllpagtmncbkywsqccd.supabase.co/rest/v1/rpc/rewards_get_allocations_summary?limit=1";
const BALANCE_URL = UNITY_CONFIG.BALANCE_URL || "https://vtllpagtmncbkywsqccd.supabase.co/rest/v1/rpc/rewards_get_balance";
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
let licenseGroupMap = new Map(); // Map of licenseId to group
let availableGroups = []; // Array of unique groups from license file
let dailyAvgGroupFilter = 'all'; // Track selected group filter
let web3Account = '';
let web3Signature = '';
let web3Busy = false;
let refreshIntervalId = null;
let currentDateFilter = 'current_month';

const tableComparators = {
    date: (a, b) => a.date.localeCompare(b.date),
    license: (a, b) => a.licenseAlias.localeCompare(b.licenseAlias),
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
const tokenForm = document.getElementById('token-form');
const tokenInput = document.getElementById('token-input');
const web3ConnectBtn = document.getElementById('web3-connect-btn');
const web3LoginBtn = document.getElementById('web3-login-btn');
const web3DisconnectBtn = document.getElementById('web3-disconnect-btn');
const web3Status = document.getElementById('web3-status');
const licenseFileInput = document.getElementById('license-file-input');
const licenseFileStatus = document.getElementById('license-file-status');
const refreshBtn = document.getElementById('refresh-btn');
const logoutBtn = document.getElementById('logout-btn');
const deviceSelect = document.getElementById('device-select');
const dailyAvgGroupFilterSelect = document.getElementById('dailyAvgGroupFilter');
const tableDeviceFilter = document.getElementById('table-device-filter');
const cardOverlay = document.getElementById('card-overlay');
const cardOverlayBody = document.getElementById('card-overlay-body');
const cardOverlayClose = document.getElementById('card-overlay-close');
const dateFilterSelect = document.getElementById('date-filter');

// Init
document.addEventListener('DOMContentLoaded', () => {
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
deviceSelect.addEventListener('change', () => {
    if (currentData) {
        renderSingleDeviceChart(deviceSelect.value, getFilteredData().summaries);
    }
});

dailyAvgGroupFilterSelect.addEventListener('change', () => {
    dailyAvgGroupFilter = dailyAvgGroupFilterSelect.value;
    if (currentData) {
        renderDailyAvgByDeviceChartFiltered(getFilteredData().summaries);
    }
});

tableDeviceFilter.addEventListener('change', () => {
    if (currentData) {
        renderTable(getFilteredData().summaries);
    }
});

if (dateFilterSelect) {
    dateFilterSelect.addEventListener('change', () => {
        currentDateFilter = dateFilterSelect.value;
        if (currentData) {
            renderDashboard(getFilteredData());
        }
    });
}

if (licenseFileInput) {
    licenseFileInput.addEventListener('change', () => {
        if (!licenseFileInput.files || licenseFileInput.files.length === 0) {
            updateLicenseFileStatus('No file selected; license IDs will be shown.');
            return;
        }
        const file = licenseFileInput.files[0];
        updateLicenseFileStatus(`Selected ${file.name}. File will be loaded when you set the token.`);
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

tokenForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    try {
        await loadLicenseAliasesFromInput();
    } catch (err) {
        alert('Invalid license alias file: ' + err.message);
        return;
    }

    if (!tokenInput) {
        updateLicenseFileStatus('Aliases updated. Use Web3 login to authenticate.');
        return;
    }

    const token = tokenInput.value.trim();
    if (!token) {
        updateLicenseFileStatus('Aliases updated. Use Web3 login to authenticate.');
        return;
    }

    // Save to Session Storage (cleared when tab closes)
    sessionStorage.setItem('unity_rewards_token', token);
    sessionStorage.removeItem('unity_rewards_refresh_token');
    sessionStorage.removeItem('unity_rewards_expires_at');
    sessionStorage.removeItem('unity_rewards_wallet');
    tokenInput.value = '';
    checkAuth();
});

if (refreshBtn) {
    refreshBtn.addEventListener('click', loadData);
}
logoutBtn.addEventListener('click', logout);

// Functions
function updateLicenseFileStatus(message) {
    if (licenseFileStatus) {
        licenseFileStatus.textContent = message;
    }
}

function getFilteredData() {
    if (!currentData) return null;
    return filterDataByDateRange(currentData, currentDateFilter);
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

async function loadLicenseAliasesFromInput() {
    if (!licenseFileInput || !licenseFileInput.files || licenseFileInput.files.length === 0) {
        licenseAliasMap = new Map();
        licenseGroupMap = new Map();
        availableGroups = [];
        updateLicenseFileStatus('No alias file selected; showing license IDs as ...XXXX.');
        populateGroupFilterDropdown();
        return;
    }

    const file = licenseFileInput.files[0];
    const text = await file.text();
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (err) {
        throw new Error('File is not valid JSON.');
    }

    if (!Array.isArray(parsed)) {
        throw new Error('JSON must be an array.');
    }

    const aliasMap = new Map();
    const groupMap = new Map();
    const groupsSet = new Set();
    
    parsed.forEach((entry, idx) => {
        if (!entry || typeof entry !== 'object') return;
        const licenseId = typeof entry.licenseId === 'string' ? entry.licenseId.trim() : null;
        const alias = typeof entry.alias === 'string' && entry.alias.trim()
            ? entry.alias.trim()
            : (typeof entry.deviceName === 'string' && entry.deviceName.trim() ? entry.deviceName.trim() : null);
        const group = typeof entry.group === 'string' && entry.group.trim() ? entry.group.trim() : null;

        if (licenseId && alias) {
            aliasMap.set(licenseId, alias);
        }
        if (licenseId && group) {
            groupMap.set(licenseId, group);
            groupsSet.add(group);
        }
    });

    licenseAliasMap = aliasMap;
    licenseGroupMap = groupMap;
    availableGroups = Array.from(groupsSet).sort();
    populateGroupFilterDropdown();

    if (aliasMap.size === 0) {
        updateLicenseFileStatus(`${file.name}: no valid entries found; showing license IDs as ...XXXX.`);
    } else {
        updateLicenseFileStatus(`Loaded ${aliasMap.size} aliases and ${groupMap.size} groups from ${file.name}.`);
    }
}

function resolveLicenseAlias(licenseId) {
    if (licenseAliasMap.has(licenseId)) {
        return licenseAliasMap.get(licenseId);
    }
    if (!licenseId) return 'Unknown';
    return licenseId.length > 4 ? `...${licenseId.slice(-4)}` : licenseId;
}

function populateGroupFilterDropdown() {
    if (!dailyAvgGroupFilterSelect) return;
    
    const currentSelection = dailyAvgGroupFilterSelect.value;
    dailyAvgGroupFilterSelect.innerHTML = '<option value="all">All Devices</option>';
    
    // Add options for each available group
    availableGroups.forEach(group => {
        const option = document.createElement('option');
        option.value = group;
        option.textContent = group;
        dailyAvgGroupFilterSelect.appendChild(option);
    });
    
    // Restore previous selection if it's still valid, otherwise default to 'all'
    if (availableGroups.includes(currentSelection)) {
        dailyAvgGroupFilterSelect.value = currentSelection;
    } else {
        dailyAvgGroupFilterSelect.value = 'all';
        dailyAvgGroupFilter = 'all';
    }
}

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
        if (summaryTotal) {
            summaryTotal.closest('.summary-strip').style.display = 'flex';
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
        dashboardContent.style.display = 'block';
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
        if (summaryTotal) {
            summaryTotal.closest('.summary-strip').style.display = 'none';
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
        authSection.style.display = 'block';
        dashboardContent.style.display = 'none';
        resetSummary();
    }
}

function logout() {
    if (confirm('Are you sure you want to logout? This will clear your session token.')) {
        sessionStorage.clear();
        currentData = null;
        licenseAliasMap = new Map();
        web3Signature = '';
        web3Account = '';
        stopAutoRefresh();
        if (licenseFileInput) {
            licenseFileInput.value = '';
        }
        updateLicenseFileStatus('No file selected; showing license IDs as ...XXXX.');
        checkAuth();
        updateWeb3Ui();
        resetSummary();
    }
}

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

            if (currentData?.summaries) {
                renderTable(currentData.summaries);
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

        // Fetch Data with Pagination
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
                // Unexpected response format
                hasMore = false;
            }
        }

        const rawData = allAllocations;
        console.log('Raw API Data:', rawData);
        // DEBUG: Analyze raw data dates
        const dates = rawData.map(i => i.completedAt);
        const uniqueDates = [...new Set(dates)];
        const uniqueDays = [...new Set(dates.map(d => d ? d.split('T')[0] : 'null'))];
        
        console.log('API Response Analysis:', {
            totalRecords: rawData.length,
            uniqueTimestampsCount: uniqueDates.length,
            uniqueDays: uniqueDays,
            firstTimestamp: dates[0],
            lastTimestamp: dates[dates.length - 1],
            sampleRecord: rawData[0]
        });

        const processed = processAllocations(rawData);
        
        currentData = processed;
        renderDashboard(getFilteredData());
        const lastUpdated = document.getElementById('last-updated');
        if (lastUpdated) {
            lastUpdated.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
        }
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

function processAllocations(allocations) {
    const grouped = {};
    
    // 1. Group by UTC Date and LicenseId
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
                sumMicros: 0
            };
        }

        grouped[key].count++;
        grouped[key].sumMicros += (item.amountMicros || 0);
    }

    // 2. Transform to Summary Objects
    const summaries = Object.values(grouped).map(g => {
        const totalAmount = g.sumMicros / 1_000_000;
        const licenseAlias = resolveLicenseAlias(g.licenseId);
        
        return {
            date: g.date,
            licenseId: g.licenseId,
            licenseAlias: licenseAlias,
            count: g.count,
            totalAmount: totalAmount,
            averageAmount: g.count > 0 ? totalAmount / g.count : 0
        };
    });

    // 3. Calculate High-Level Totals
    const totalCount = summaries.reduce((sum, s) => sum + s.count, 0);
    const grandTotalAmount = summaries.reduce((sum, s) => sum + s.totalAmount, 0);

    // 4. Average Per Device
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

    // 5. Average Per Day
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

    // 6. Daily Average by Device (total rewards / total allocations per day per device)
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

function renderDashboard(data) {
    // Metrics
    const totalAmountEl = document.getElementById('metric-total-amount');
    const totalCountEl = document.getElementById('metric-total-count');
    const dailyAvgEl = document.getElementById('metric-daily-avg-by-device');
    if (totalAmountEl) {
        totalAmountEl.textContent = data.totals.totalAmount.toFixed(2);
    }
    if (totalCountEl) {
        totalCountEl.textContent = data.totals.count;
    }
    if (dailyAvgEl) {
        dailyAvgEl.textContent = data.averages.dailyByDevice.toFixed(2);
    }
    if (summaryDailyAverage) {
        summaryDailyAverage.textContent = data.averages.dailyByDevice.toFixed(2);
    }

    // Charts
    renderDailyChart(data.averages.perDay);
    renderDeviceChart(data.averages.perDevice);
    renderDistributionChart(data.averages.perDevice);
    renderDailyAvgByDeviceChartFiltered(data.summaries);
    renderMoversChart(data.summaries);

    // Populate Dropdown
    const currentSelection = deviceSelect.value;
    deviceSelect.innerHTML = '<option value="">Select License ID</option>';
    
    // Populate Table Filter
    const currentTableFilter = tableDeviceFilter.value;
    tableDeviceFilter.innerHTML = '<option value="all">All License IDs</option>';

    // Sort devices alphabetically
    const devices = data.averages.perDevice.map(d => d.licenseAlias).sort((a, b) => a.localeCompare(b));
    
    devices.forEach(dev => {
        // Chart dropdown
        const option = document.createElement('option');
        option.value = dev;
        option.textContent = dev;
        deviceSelect.appendChild(option);

        // Table filter dropdown
        const filterOption = document.createElement('option');
        filterOption.value = dev;
        filterOption.textContent = dev;
        tableDeviceFilter.appendChild(filterOption);
    });

    // Restore selection or select first
    if (currentSelection && devices.includes(currentSelection)) {
        deviceSelect.value = currentSelection;
    } else if (devices.length > 0) {
        deviceSelect.value = devices[0];
    }

    // Restore table filter
    if (currentTableFilter && (devices.includes(currentTableFilter) || currentTableFilter === 'all')) {
        tableDeviceFilter.value = currentTableFilter;
    }
    
    // Render initial single device chart
    renderSingleDeviceChart(deviceSelect.value, data.summaries);

    // Table
    renderTable(data.summaries);
}

function renderSingleDeviceChart(licenseAlias, summaries) {
    const ctx = document.getElementById('singleDeviceChart').getContext('2d');
    
    if (charts.singleDevice) charts.singleDevice.destroy();

    if (!licenseAlias) return;

    // Filter data for the selected device and sort by date
    const deviceData = summaries
        .filter(s => s.licenseAlias === licenseAlias)
        .sort((a, b) => a.date.localeCompare(b.date));

    // Use bar chart if only one data point to ensure visibility
    const chartType = deviceData.length === 1 ? 'bar' : 'line';
    const bgColor = deviceData.length === 1 ? '#ff9f43' : 'rgba(255, 159, 67, 0.1)';

    charts.singleDevice = new Chart(ctx, {
        type: chartType,
        data: {
            labels: deviceData.map(d => d.date),
            datasets: [{
                label: `Total Amount (${licenseAlias})`,
                data: deviceData.map(d => d.totalAmount),
                borderColor: '#ff9f43',
                backgroundColor: bgColor,
                tension: 0.1,
                fill: deviceData.length > 1,
                pointRadius: 6,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

function renderDailyChart(perDayData) {
    const ctx = document.getElementById('dailyChart').getContext('2d');
    
    if (charts.daily) charts.daily.destroy();

    // Use bar chart if only one data point to ensure visibility
    const chartType = perDayData.length === 1 ? 'bar' : 'line';
    const bgColor = perDayData.length === 1 ? '#4a90e2' : 'rgba(74, 144, 226, 0.1)';

    charts.daily = new Chart(ctx, {
        type: chartType,
        data: {
            labels: perDayData.map(d => d.date),
            datasets: [{
                label: 'Total Amount',
                data: perDayData.map(d => d.totalAmount),
                borderColor: '#4a90e2',
                backgroundColor: bgColor,
                tension: 0.1,
                fill: perDayData.length > 1,
                pointRadius: 6,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

function renderDeviceChart(perDeviceData) {
    const ctx = document.getElementById('deviceChart').getContext('2d');
    
    if (charts.device) charts.device.destroy();

    charts.device = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: perDeviceData.map(d => d.licenseAlias),
            datasets: [{
                label: 'Average Amount',
                data: perDeviceData.map(d => d.averageAmount),
                backgroundColor: '#66bb6a'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true }
            }
        }
    });
}

function renderDistributionChart(perDeviceData) {
    const canvas = document.getElementById('distributionChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    if (charts.distribution) charts.distribution.destroy();
    if (!perDeviceData || perDeviceData.length === 0) return;

    const totals = perDeviceData
        .map(device => (typeof device.totalAmount === 'number' ? device.totalAmount : Number(device.totalAmount) || 0))
        .filter(value => !Number.isNaN(value));

    if (totals.length === 0) return;

    const mean = totals.reduce((sum, value) => sum + value, 0) / totals.length;
    const variance = totals.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / totals.length;
    const stdDev = variance > 0 ? Math.sqrt(variance) : 1;

    const min = Math.min(...totals);
    const max = Math.max(...totals);
    const spanStart = Math.min(mean - (3 * stdDev), min);
    const spanEnd = Math.max(mean + (3 * stdDev), max);
    const pointCount = 80;
    const range = spanEnd - spanStart;
    const step = range === 0 ? 1 : range / Math.max(pointCount - 1, 1);

    const sqrtTwoPi = Math.sqrt(2 * Math.PI);
    const totalSum = totals.reduce((sum, value) => sum + value, 0);

    const curvePoints = [];
    for (let idx = 0; idx < pointCount; idx++) {
        const x = spanStart + (step * idx);
        const z = (x - mean) / stdDev;
        const pdf = Math.exp(-0.5 * z * z) / (stdDev * sqrtTwoPi);
        curvePoints.push({ x: Number.isFinite(x) ? x : 0, y: pdf * totalSum });
    }

    const scatterPoints = totals.map(value => ({ x: value, y: 0 }));

    charts.distribution = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'Normal Distribution Curve',
                    data: curvePoints,
                    parsing: false,
                    borderColor: '#4a90e2',
                    backgroundColor: 'rgba(74, 144, 226, 0.1)',
                    tension: 0.25,
                    fill: true,
                    pointRadius: 0
                },
                {
                    type: 'scatter',
                    label: 'Device Totals',
                    data: scatterPoints,
                    parsing: false,
                    borderColor: '#ff9f43',
                    backgroundColor: '#ff9f43',
                    pointRadius: 4,
                    pointHoverRadius: 6
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'linear',
                    title: { display: true, text: 'Total Rewards per License' }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Density (scaled)' }
                }
            },
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    callbacks: {
                        label: (context) => {
                            const xVal = context.parsed.x;
                            const yVal = context.parsed.y;
                            if (context.dataset.type === 'scatter') {
                                return `Device Total: ${xVal.toFixed(2)}`;
                            }
                            return `Curve: ${yVal.toFixed(2)} at ${xVal.toFixed(2)}`;
                        }
                    }
                }
            }
        }
    });
}


function renderDailyAvgByDeviceChart(perDayData) {
    const canvas = document.getElementById('dailyAvgByDeviceChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    if (charts.dailyAvgByDevice) charts.dailyAvgByDevice.destroy();

    // Use bar chart if only one data point to ensure visibility
    const chartType = perDayData.length === 1 ? 'bar' : 'line';
    const bgColor = perDayData.length === 1 ? '#e76f51' : 'rgba(231, 111, 81, 0.1)';

    charts.dailyAvgByDevice = new Chart(ctx, {
        type: chartType,
        data: {
            labels: perDayData.map(d => d.date),
            datasets: [{
                label: 'Average per Allocation',
                data: perDayData.map(d => d.averagePerReward),
                borderColor: '#e76f51',
                backgroundColor: bgColor,
                tension: 0.1,
                fill: perDayData.length > 1,
                pointRadius: 6,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true }
            },
            plugins: {
                tooltip: {
                    callbacks: {
                        afterLabel: (context) => {
                            const dataIndex = context.dataIndex;
                            const dayData = perDayData[dataIndex];
                            if (!dayData) return '';
                            return [
                                `Devices: ${dayData.deviceCount}`,
                                `Total Rewards: ${dayData.totalAmount.toFixed(2)}`
                            ];
                        }
                    }
                }
            }
        }
    });
}

function renderDailyAvgByDeviceChartFiltered(summaries) {
    // Filter summaries based on selected group
    let filteredSummaries = summaries;
    
    if (dailyAvgGroupFilter !== 'all') {
        filteredSummaries = summaries.filter(s => 
            licenseGroupMap.get(s.licenseId) === dailyAvgGroupFilter
        );
    }

    // Recalculate per-day data based on filtered summaries
    const dayGroups = {};
    filteredSummaries.forEach(s => {
        if (!dayGroups[s.date]) dayGroups[s.date] = { total: 0, count: 0, recordCount: 0 };
        dayGroups[s.date].total += s.totalAmount;
        dayGroups[s.date].count += 1;
        dayGroups[s.date].recordCount += s.count;
    });

    const perDayData = Object.entries(dayGroups).map(([date, data]) => ({
        date: date,
        count: data.recordCount,
        deviceCount: data.count,
        totalAmount: data.total,
        averageAmount: data.count > 0 ? data.total / data.count : 0,
        averagePerReward: data.recordCount > 0 ? data.total / data.recordCount : 0
    })).sort((a, b) => a.date.localeCompare(b.date));

    // Call the original render function with filtered data
    renderDailyAvgByDeviceChart(perDayData);
}

function renderTable(summaries) {
    const tbody = document.querySelector('#daily-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!Array.isArray(summaries) || summaries.length === 0) {
        updateSortIndicators();
        return;
    }

    const filterValue = tableDeviceFilter.value;
    const filteredSummaries = filterValue === 'all' 
        ? summaries 
        : summaries.filter(s => s.licenseAlias === filterValue);

    const comparator = tableComparators[tableSortState.key];
    const sortedSummaries = comparator
        ? [...filteredSummaries].sort((a, b) => {
            const result = comparator(a, b);
            return tableSortState.direction === 'asc' ? result : -result;
        })
        : filteredSummaries;

    sortedSummaries.forEach(row => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${row.date}</td>
            <td>${row.licenseAlias}</td>
            <td>${row.count}</td>
            <td>${row.totalAmount.toFixed(6)}</td>
            <td>${row.averageAmount.toFixed(6)}</td>
        `;
        tbody.appendChild(tr);
    });

    updateSortIndicators();
}
function computeMovers(summaries) {
    const dates = [...new Set(summaries.map(s => s.date))].sort((a, b) => b.localeCompare(a));
    if (dates.length < 2) return { gainers: [], losers: [], latestDate: dates[0], prevDate: null };

    const latestDate = dates[0];
    const prevDate = dates[1];

    const latestMap = new Map();
    const prevMap = new Map();
    summaries.forEach(s => {
        if (s.date === latestDate) latestMap.set(s.licenseAlias, s.totalAmount);
        if (s.date === prevDate) prevMap.set(s.licenseAlias, s.totalAmount);
    });

    const allLicenses = new Set([...latestMap.keys(), ...prevMap.keys()]);
    const deltas = [];
    allLicenses.forEach(alias => {
        const latest = latestMap.get(alias) ?? 0;
        const prev = prevMap.get(alias) ?? 0;
        deltas.push({ licenseAlias: alias, delta: latest - prev });
    });

    const sorted = [...deltas].sort((a, b) => a.delta - b.delta);
    const losers = sorted.slice(0, 5);
    const gainers = sorted.slice(-5).reverse();

    return { gainers, losers, latestDate, prevDate };
}

function renderMoversChart(summaries) {
    if (charts.losers) { charts.losers.destroy(); charts.losers = null; }
    if (charts.gainers) { charts.gainers.destroy(); charts.gainers = null; }

    const { gainers, losers, latestDate, prevDate } = computeMovers(summaries);
    if (!gainers.length && !losers.length) return;

    const lEl = document.getElementById('losersChart');
    const gEl = document.getElementById('gainersChart');
    if (!lEl || !gEl) return;

    const changeLabel = prevDate ? `Change (${prevDate} \u2192 ${latestDate})` : `Latest (${latestDate})`;

    const losersDisplay = [...losers].reverse();
    charts.losers = new Chart(lEl.getContext('2d'), {
        type: 'bar',
        data: {
            labels: losersDisplay.map(d => d.licenseAlias),
            datasets: [{
                label: changeLabel,
                data: losersDisplay.map(d => d.delta),
                backgroundColor: 'rgba(239, 83, 80, 0.65)',
                borderColor: '#ef5350',
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.raw >= 0 ? '+' : ''}${ctx.raw.toFixed(6)}`
                    }
                }
            },
            scales: {
                x: { beginAtZero: false }
            }
        }
    });

    const gainersDisplay = [...gainers].reverse();
    charts.gainers = new Chart(gEl.getContext('2d'), {
        type: 'bar',
        data: {
            labels: gainersDisplay.map(d => d.licenseAlias),
            datasets: [{
                label: changeLabel,
                data: gainersDisplay.map(d => d.delta),
                backgroundColor: 'rgba(102, 187, 106, 0.65)',
                borderColor: '#66bb6a',
                borderWidth: 1
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.raw >= 0 ? '+' : ''}${ctx.raw.toFixed(6)}`
                    }
                }
            },
            scales: {
                x: { beginAtZero: false }
            }
        }
    });
}