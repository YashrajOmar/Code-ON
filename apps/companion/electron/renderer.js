let syncing = false;
let scrapedTotal = 0;
let uploadedTotal = 0;
let skippedTotal = 0;
let persistentUploaded = 0;
let syncActive = false;

const codeonUrl = document.getElementById("codeonUrl");
const syncBtn = document.getElementById("syncBtn");
const syncBtnText = document.getElementById("syncBtnText");
const statusBox = document.getElementById("statusBox");
const connDot = document.getElementById("connDot");
const connText = document.getElementById("connText");
const scrapedCountEl = document.getElementById("scrapedCount");
const uploadedCountEl = document.getElementById("uploadedCount");
const failedCountEl = document.getElementById("failedCount");

// Load persistent uploaded count from localStorage
try {
  persistentUploaded = parseInt(localStorage.getItem("codeon_total_uploaded") || "0");
} catch {}
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
  });
}

async function checkConnection() {
  const url = codeonUrl.value.trim() || "https://codeon-coding-coach-eight.vercel.app";
  connText.textContent = "Checking...";
  try {
    const result = await window.codeon.checkConnection({ codeonUrl: url });
    if (result.connected) {
      connDot.className = "dot connected";
      connText.textContent = `Connected to ${url}`;
      syncBtn.disabled = false;
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
  if (settings.handles) {
    Object.entries(settings.handles).forEach(([platform, handle]) => {
      const input = document.querySelector(`input[data-platform="${platform}"]`);
      if (input) input.value = handle;
    });
  }
  await checkConnection();
})();

window.codeon.onStatus((msg) => addStatus(msg, "info"));

document.querySelectorAll("input[data-platform]").forEach(input => {
  input.addEventListener("change", saveSettings);
});
codeonUrl.addEventListener("change", () => { saveSettings(); checkConnection(); });

// Login buttons — opens new tab in existing Chrome, doesn't close it
document.querySelectorAll(".login-btn").forEach(btn => {
  btn.addEventListener("click", async () => {
    const platform = btn.dataset.login;
    const platformName = btn.parentElement.parentElement.querySelector("label").textContent;
    btn.textContent = "Opening...";
    btn.disabled = true;
    const result = await window.codeon.login({ platform });
    btn.textContent = "Login";
    btn.disabled = false;
    if (result.success) {
      btn.classList.add("logged-in");
      btn.textContent = "Logged In";
      addStatus(`[${platformName}] New tab opened. Log in, then close the tab.`, "info");
    } else {
      addStatus(`[${platformName}] Login failed: ${result.error}`, "error");
    }
  });
});

async function doSync() {
  if (syncing) return;
  const handles = getHandles();
  if (Object.keys(handles).length === 0) {
    addStatus("Please enter at least one handle.", "error");
    return;
  }

  syncing = true;
  syncActive = false;
  syncBtn.disabled = true;
  syncBtnText.innerHTML = '<span class="spinner"></span> Syncing...';
  addStatus("Starting sync...", "info");

  try {
    const result = await window.codeon.sync({
      handles,
      codeonUrl: codeonUrl.value.trim() || "https://codeon-coding-coach-eight.vercel.app",
    });

    syncActive = false;

    if (result.status === "done") {
      addStatus(`Sync complete! Uploaded ${result.total} solution(s) total.`, "success");
      Object.entries(result.perPlatform || {}).forEach(([platform, info]) => {
        const name = platform.charAt(0).toUpperCase() + platform.slice(1);
        if (info.count > 0) {
          addStatus(`  [${name}] ${info.count} solutions uploaded`, "success");
        } else if (info.status === "login_expired") {
          addStatus(`  [${name}] LOGIN EXPIRED — click Login to re-login`, "error");
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

syncBtn.addEventListener("click", () => doSync());

window.codeon.onAutoSync(() => {
  if (!syncing) {
    addStatus("Auto-sync started...", "info");
    doSync();
  }
});
