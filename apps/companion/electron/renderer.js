let syncing = false;

const codeonUrl = document.getElementById("codeonUrl");
const syncBtn = document.getElementById("syncBtn");
const syncBtnText = document.getElementById("syncBtnText");
const statusBox = document.getElementById("statusBox");
const connDot = document.getElementById("connDot");
const connText = document.getElementById("connText");

// Load saved settings
(async () => {
  const settings = await window.codeon.getSettings();
  codeonUrl.value = settings.codeonUrl || "http://localhost:3000";

  // Fill in saved handles
  if (settings.handles) {
    Object.entries(settings.handles).forEach(([platform, handle]) => {
      const input = document.querySelector(`input[data-platform="${platform}"]`);
      if (input) input.value = handle;
    });
  }

  await checkConnection();
})();

// Status listener
window.codeon.onStatus((msg) => addStatus(msg, "info"));

function addStatus(msg, type = "") {
  const line = document.createElement("div");
  line.className = `status-line ${type}`;
  line.textContent = msg;
  statusBox.appendChild(line);
  statusBox.scrollTop = statusBox.scrollHeight;
}

// Collect all handles
function getHandles() {
  const handles = {};
  document.querySelectorAll("input[data-platform]").forEach(input => {
    const platform = input.dataset.platform;
    const handle = input.value.trim();
    if (handle) handles[platform] = handle;
  });
  return handles;
}

// Save settings
function saveSettings() {
  window.codeon.saveSettings({
    handles: getHandles(),
    codeonUrl: codeonUrl.value.trim() || "http://localhost:3000",
  });
}

// Save on any input change
document.querySelectorAll("input[data-platform]").forEach(input => {
  input.addEventListener("change", saveSettings);
});
codeonUrl.addEventListener("change", () => { saveSettings(); checkConnection(); });

// Connection check
async function checkConnection() {
  const url = codeonUrl.value.trim() || "http://localhost:3000";
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

// Login buttons
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
      addStatus(`Chrome opened. Log into ${platformName}, then close the tab.`, "info");
    } else {
      addStatus(`${platformName} login failed: ${result.error}`, "error");
    }
  });
});

// Sync button
syncBtn.addEventListener("click", async () => {
  if (syncing) return;
  const handles = getHandles();
  if (Object.keys(handles).length === 0) {
    addStatus("Please enter at least one handle.", "error");
    return;
  }

  syncing = true;
  syncBtn.disabled = true;
  syncBtnText.innerHTML = '<span class="spinner"></span> Syncing...';
  addStatus("Starting sync...", "info");

  try {
    const result = await window.codeon.sync({
      handles,
      codeonUrl: codeonUrl.value.trim() || "http://localhost:3000",
    });

    if (result.status === "done") {
      addStatus(`Sync complete! Uploaded ${result.total} solution(s) total.`, "success");

      // Per-platform results
      Object.entries(result.perPlatform || {}).forEach(([platform, info]) => {
        const name = platform.charAt(0).toUpperCase() + platform.slice(1);
        if (info.count > 0) {
          addStatus(`  ${name}: ${info.count} solutions uploaded`, "success");
        } else if (info.status === "not_supported") {
          addStatus(`  ${name}: auto-scrape not yet supported for this platform`, "info");
        } else {
          addStatus(`  ${name}: no new submissions`, "info");
        }
      });
    } else {
      addStatus("Sync completed with errors.", "error");
    }

    if (result.errors && result.errors.length > 0) {
      result.errors.forEach(err => addStatus(`  ${err}`, "error"));
    }
  } catch (e) {
    addStatus(`Sync failed: ${e.message}`, "error");
  } finally {
    syncing = false;
    syncBtn.disabled = false;
    syncBtnText.textContent = "Sync Now";
  }
});
