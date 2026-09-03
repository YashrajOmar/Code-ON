let syncing = false;
let scrapedTotal = 0;
let uploadedTotal = 0;
let skippedTotal = 0;
let persistentUploaded = 0;
let syncActive = false;

const codeonUrl = document.getElementById("codeonUrl");
const companionToken = document.getElementById("companionToken");
const syncBtn = document.getElementById("syncBtn");
const syncBtnText = document.getElementById("syncBtnText");
const statusBox = document.getElementById("statusBox");
const connDot = document.getElementById("connDot");
const connText = document.getElementById("connText");
const scrapedCountEl = document.getElementById("scrapedCount");
const uploadedCountEl = document.getElementById("uploadedCount");
const failedCountEl = document.getElementById("failedCount");

// Total trained count — default to 0, NOT hardcoded. Only updates from real sync.
try {
  persistentUploaded = parseInt(localStorage.getItem("codeon_total_uploaded") || "0") || 0;
} catch { persistentUploaded = 0; }
const totalUploadedEl = document.getElementById("totalUploaded");
if (totalUploadedEl) totalUploadedEl.textContent = persistentUploaded;

function updateCounters() {
  if (scrapedCountEl) scrapedCountEl.textContent = scrapedTotal;
  if (uploadedCountEl) uploadedCountEl.textContent = uploadedTotal;
  if (failedCountEl) failedCountEl.textContent = skippedTotal;
  if (totalUploadedEl) totalUploadedEl.textContent = persistentUploaded;
}

function addStatus(msg, type = "") {
  const line = document.createElement("div");
  line.className = `status-line ${type}`;
  line.textContent = msg;
  statusBox.appendChild(line);
  statusBox.scrollTop = statusBox.scrollHeight;

  // Check for sync start BEFORE the syncActive guard
  if (msg === "Starting sync..." || msg.includes("Starting sync")) {
    scrapedTotal = 0;
    uploadedTotal = 0;
    skippedTotal = 0;
    syncActive = true;
    updateCounters();
    return;
  }

  // Only count messages during active sync
  if (!syncActive) return;

  if (msg.includes("Scraped ") && msg.includes("✓")) {
    scrapedTotal++;
    updateCounters();
  } else if (msg.includes("Skipped ")) {
    skippedTotal++;
    updateCounters();
  } else if (msg.includes("solutions uploaded") && msg.includes("✓")) {
    const match = msg.match(/(\d+) solutions uploaded/);
    if (match) {
      uploadedTotal += parseInt(match[1]);
      persistentUploaded += parseInt(match[1]);
      try { localStorage.setItem("codeon_total_uploaded", String(persistentUploaded)); } catch {}
      updateCounters();
    }
  } else if (msg.includes("Uploaded ") && msg.includes("solution") && msg.includes("total")) {
    const match = msg.match(/Uploaded (\d+) solution/);
    if (match) {
      uploadedTotal += parseInt(match[1]);
      persistentUploaded += parseInt(match[1]);
      try { localStorage.setItem("codeon_total_uploaded", String(persistentUploaded)); } catch {}
      updateCounters();
    }
  } else if (msg === "Starting sync...") {
    scrapedTotal = 0;
    uploadedTotal = 0;
    skippedTotal = 0;
    syncActive = true;
    updateCounters();
  }
}

function getHandles() {
  const handles = {};
  document.querySelectorAll("input[data-platform]").forEach(input => {
    const platform = input.dataset.platform;
    const handle = input.value.trim();
    if (handle) handles[platform] = handle;
  });
  return handles;
}

function saveSettings() {
  window.codeon.saveSettings({
    handles: getHandles(),
    codeonUrl: codeonUrl.value.trim() || "https://codeon-coding-coach-eight.vercel.app",
    companionToken: companionToken.value.trim(),
  });
}

// Save on every keystroke (input event) + blur as a safety net
document.querySelectorAll("input[data-platform]").forEach(input => {
  input.addEventListener("input", saveSettings);
  input.addEventListener("blur", saveSettings);
});
codeonUrl.addEventListener("input", saveSettings);
codeonUrl.addEventListener("change", () => { saveSettings(); checkConnection(); });
codeonUrl.addEventListener("blur", () => { saveSettings(); checkConnection(); });
companionToken.addEventListener("input", saveSettings);
companionToken.addEventListener("blur", saveSettings);

async function checkConnection() {
  const url = codeonUrl.value.trim() || "https://codeon-coding-coach-eight.vercel.app";
  connText.textContent = "Checking...";
  try {
    const result = await window.codeon.checkConnection({ codeonUrl: url, companionToken: companionToken.value.trim() });
    if (result.connected) {
      if (result.tokenValid === false) {
        connDot.className = "dot disconnected";
        connText.textContent = "Token invalid — regenerate in web app Settings";
        syncBtn.disabled = true;
        companionToken.value = "";
        saveSettings();
        addStatus("Companion token is invalid. Generate a new one in the web app Settings page.", "error");
      } else {
        connDot.className = "dot connected";
        connText.textContent = `Connected to ${url}`;
        syncBtn.disabled = !companionToken.value.trim();
      }
    } else {
      connDot.className = "dot disconnected";
      connText.textContent = `Cannot reach CodeOn at ${url}`;
      syncBtn.disabled = true;
    }
  } catch {
    connDot.className = "dot disconnected";
    connText.textContent = `Cannot reach CodeOn at ${url}`;
    syncBtn.disabled = true;
  }
}

// Load saved settings
(async () => {
  const settings = await window.codeon.getSettings();
  const savedUrl = settings.codeonUrl || "https://codeon-coding-coach-eight.vercel.app";
  codeonUrl.value = savedUrl === "http://localhost:3000" ? "https://codeon-coding-coach-eight.vercel.app" : savedUrl;
  if (settings.companionToken) companionToken.value = settings.companionToken;
  if (settings.handles) {
    Object.entries(settings.handles).forEach(([platform, handle]) => {
      const input = document.querySelector(`input[data-platform="${platform}"]`);
      if (input) input.value = handle;
    });
  }
  await checkConnection();

  // Check actual login status via cookies (don't blindly show "Logged In")
  document.querySelectorAll(".login-btn").forEach(async (btn) => {
    const platform = btn.dataset.login;
    try {
      const status = await window.codeon.checkLoginStatus({ platform });
      if (status.loggedIn) {
        btn.classList.add("logged-in");
        btn.textContent = "Logged In";
      } else {
        btn.classList.remove("logged-in");
        btn.textContent = "Login Required";
      }
    } catch {
      btn.textContent = "Login";
    }
  });
})();

window.codeon.onStatus((msg) => addStatus(msg, "info"));

// Check login status button (second click after opening login page)
async function checkLoginStatus(platform, btn, platformName) {
  const status = await window.codeon.checkLoginStatus({ platform });
  if (status.loggedIn) {
    btn.classList.add("logged-in");
    btn.textContent = "Logged In";
    addStatus(`[${platformName}] Login verified ✓`, "success");
  } else {
    btn.classList.remove("logged-in");
    btn.textContent = "Login";
    addStatus(`[${platformName}] Not logged in yet. Open the login page and sign in first.`, "error");
  }
}

// Login button behavior: first click opens login, second click checks status
document.querySelectorAll(".login-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const platform = btn.dataset.login;
    const platformName = btn.parentElement.parentElement.querySelector("label").textContent;
    const handleInput = document.querySelector(`input[data-platform="${platform}"]`);
    const handle = handleInput ? handleInput.value.trim() : "";

    // If button says "Check Login", verify cookies instead of opening new tab
    if (btn.textContent === "Check Login") {
      try {
        btn.disabled = true;
        btn.textContent = "Checking...";
        await checkLoginStatus(platform, btn, platformName);
      } catch {
        addStatus(`[${platformName}] Failed to check login status.`, "error");
        btn.textContent = "Check Login";
      } finally {
        btn.disabled = false;
      }
      return;
    }

    if (!handle) {
      addStatus(`[${platformName}] Enter your handle first.`, "error");
      return;
    }

    // CRITICAL: Save settings immediately so the new handle overwrites old one
    saveSettings();

    try {
      btn.textContent = "Opening...";
      btn.disabled = true;
      if (handleInput) handleInput.disabled = true;

      const validationResult = await window.codeon.validateHandle({ platform, handle });
      if (!validationResult.valid) {
        addStatus(`[${platformName}] Invalid handle "${handle}". ${validationResult.error || "Check your username."}`, "error");
        btn.textContent = "Login";
        return;
      }

      const loginResult = await window.codeon.login({ platform });
      if (loginResult.success) {
        btn.textContent = "Check Login";
        addStatus(`[${platformName}] Chrome tab opened. Log in, close the tab, then click "Check Login".`, "info");
      } else {
        addStatus(`[${platformName}] Login failed: ${loginResult.error}`, "error");
        btn.textContent = "Login";
      }
    } catch (e) {
      addStatus(`[${platformName}] Error: ${e.message || "Unknown error"}`, "error");
      btn.textContent = "Login";
    } finally {
      // ALWAYS re-enable BOTH the button AND the input field
      btn.disabled = false;
      if (handleInput) handleInput.disabled = false;
    }
  });
});

// ── Clear All Local Data ──────────────────────────────────────────────────
const clearDataBtn = document.getElementById("clearDataBtn");
if (clearDataBtn) {
  clearDataBtn.addEventListener("click", async () => {
    if (!confirm("This will DELETE all local data (handles, tokens, sync state, browser profile). The app will restart. Continue?")) return;
    clearDataBtn.textContent = "Clearing...";
    clearDataBtn.disabled = true;
    const result = await window.codeon.clearLocalData();
    if (result.success) {
      // Clear localStorage (removes hardcoded "379" and any stale counts)
      try { localStorage.clear(); } catch {}
      addStatus("All local data cleared. Restarting...", "success");
      // Reset all UI state immediately + reload
      setTimeout(() => { window.location.reload(); }, 1000);
    } else {
      addStatus("Failed to clear data: " + (result.error || "Unknown"), "error");
      clearDataBtn.textContent = "Clear All Local Data";
      clearDataBtn.disabled = false;
    }
  });
}

async function doSync(isAutoSync = false) {
  if (syncing) return;
  const handles = getHandles();
  if (Object.keys(handles).length === 0) {
    if (!isAutoSync) addStatus("Please enter at least one handle.", "error");
    return;
  }

  syncing = true;
  syncActive = false;
  syncBtn.disabled = true;
  syncBtnText.innerHTML = '<span class="spinner"></span> Syncing...';
  addStatus(isAutoSync ? "Auto-sync started..." : "Starting sync...", "info");

  try {
    const result = await window.codeon.sync({
      handles,
      codeonUrl: codeonUrl.value.trim() || "https://codeon-coding-coach-eight.vercel.app",
      companionToken: companionToken.value.trim(),
      isAutoSync,
    });

    syncActive = false;

    if (result.status === "done") {
      addStatus(`Sync complete! Uploaded ${result.total} solution(s) total.`, "success");
      Object.entries(result.perPlatform || {}).forEach(([platform, info]) => {
        const name = platform.charAt(0).toUpperCase() + platform.slice(1);
        if (info.count > 0) {
          addStatus(`  [${name}] ${info.count} solutions uploaded`, "success");
        } else if (info.status === "login_required" || info.status === "login_expired") {
          addStatus(`  [${name}] LOGIN REQUIRED — click Login first`, "error");
          const loginBtn = document.querySelector(`button[data-login="${platform}"]`);
          if (loginBtn) { loginBtn.classList.remove("logged-in"); loginBtn.textContent = "Login"; }
        } else if (info.status === "not_supported") {
          addStatus(`  [${name}] auto-scrape not supported yet`, "info");
        } else {
          addStatus(`  [${name}] no new submissions`, "info");
        }
      });
    } else {
      addStatus("Sync completed with errors.", "error");
    }

    if (result.errors && result.errors.length > 0) {
      result.errors.slice(0, 5).forEach(err => addStatus(`  ${err}`, "error"));
    }
  } catch (e) {
    addStatus(`Sync failed: ${e.message}`, "error");
  } finally {
    syncing = false;
    syncActive = false;
    syncBtn.disabled = false;
    syncBtnText.textContent = "Sync Now";
  }
}

syncBtn.addEventListener("click", () => doSync(false));

window.codeon.onAutoSync(() => {
  if (!syncing) {
    doSync(true);
  }
});
