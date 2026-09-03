"use client";

import { useState, useEffect } from "react";
import { useTheme } from "@/components/ThemeProvider";

const SUPPORTED_PLATFORMS = [
  { value: "leetcode", label: "LeetCode", color: "var(--brand-amber)", placeholder: "your-handle" },
  { value: "codeforces", label: "Codeforces", color: "var(--brand-cyan)", placeholder: "tourist" },
  { value: "codechef", label: "CodeChef", color: "var(--brand-emerald)", placeholder: "your_handle" },
  { value: "atcoder", label: "AtCoder", color: "var(--brand-violet-light)", placeholder: "tourist" },
  { value: "hackerrank", label: "HackerRank", color: "var(--brand-indigo)", placeholder: "your_handle" },
  { value: "github", label: "GitHub", color: "var(--text-secondary)", placeholder: "your-username" },
];

const AI_PROVIDERS = [
  { value: "gemini", label: "Google Gemini", keyPrefix: "AIzaSy", link: "https://aistudio.google.com", linkText: "aistudio.google.com" },
  { value: "openai", label: "OpenAI", keyPrefix: "sk-", link: "https://platform.openai.com/api-keys", linkText: "platform.openai.com" },
  { value: "anthropic", label: "Anthropic Claude", keyPrefix: "sk-ant-", link: "https://console.anthropic.com", linkText: "console.anthropic.com" },
];

export default function SettingsView() {
  const { theme, setTheme } = useTheme();
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({ gemini: "", openai: "", anthropic: "" });
  const [savedKeyStatus, setSavedKeyStatus] = useState<Record<string, boolean>>({});
  const [clearKeys, setClearKeys] = useState<string[]>([]);
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash");
  const [customProviders, setCustomProviders] = useState<Array<{
    id: string;
    key: string;
    label: string;
    baseUrl: string;
    model: string;
    format: "openai" | "gemini" | "anthropic";
    hasKey: boolean;
  }>>([]);
  const [removedCustomIds, setRemovedCustomIds] = useState<string[]>([]);
  const [seedCode, setSeedCode] = useState("");
  const [seedTitle, setSeedTitle] = useState("");
  const [seedTags, setSeedTags] = useState("");
  const [seedPlatform, setSeedPlatform] = useState("codeforces");
  const [seedUrl, setSeedUrl] = useState("");
  const [seedSaving, setSeedSaving] = useState(false);
  const [seedMsg, setSeedMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [trainedSolutions, setTrainedSolutions] = useState<Array<{ topic: string; title: string; platform: string; tags: string[]; patterns: string[]; language: string; url: string | null; updatedAt: string | null }>>([]);
  const [companionToken, setCompanionToken] = useState<string>("");
  const [tokenLoading, setTokenLoading] = useState(false);
  const [profiles, setProfiles] = useState<Array<{ id: string; platform: string; handle: string }>>([]);
  const [newPlatform, setNewPlatform] = useState("leetcode");
  const [newHandle, setNewHandle] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isAddingProfile, setIsAddingProfile] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchSettings();
    fetchTrainedSolutions();
    fetchCompanionToken();
  }, []);

  async function fetchSettings() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/settings");
      const json = await res.json();
      if (json.success) {
        const keys: Record<string, string> = { gemini: "", openai: "", anthropic: "" };
        const status: Record<string, boolean> = {};
        for (const prov of AI_PROVIDERS) {
          status[prov.value] = json.data.apiKeyStatus?.[prov.value] || false;
        }
        setApiKeys(keys);
        setSavedKeyStatus(status);
        setClearKeys([]);
        if (json.data.geminiModel) {
          setGeminiModel(json.data.geminiModel);
        }
        // Load custom providers (dynamic + button)
        setCustomProviders(
          (json.data.customProviders || []).map((cp: any) => ({
            id: cp.id,
            key: "", // Never sent from server — always blank, show placeholder
            label: cp.label,
            baseUrl: cp.baseUrl || "https://api.openai.com/v1",
            model: cp.model || "gpt-4o",
            format: cp.format || "openai",
            hasKey: cp.hasKey || false,
          }))
        );
        setRemovedCustomIds([]);
        setProfiles(json.data.codingProfiles || []);
      }
    } catch {
      setMessage({ type: "error", text: "Failed to load settings from server" });
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchTrainedSolutions() {
    try {
      const res = await fetch("/api/settings/seed-code");
      const json = await res.json();
      if (json.solutions) {
        setTrainedSolutions(json.solutions);
      }
    } catch { /* ignore */ }
  }

  async function fetchCompanionToken() {
    try {
      const res = await fetch("/api/settings/companion-token");
      const json = await res.json();
      if (json.hasToken && json.token) {
        setCompanionToken(json.token);
      }
    } catch { /* ignore */ }
  }

  async function handleGenerateToken() {
    setTokenLoading(true);
    try {
      const res = await fetch("/api/settings/companion-token", { method: "POST" });
      const json = await res.json();
      if (json.success && json.token) {
        setCompanionToken(json.token);
      }
    } catch { /* ignore */ }
    setTokenLoading(false);
  }

  async function handleSaveKeys() {
    setIsSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKeys, geminiModel, clearKeys, customProviders, removedCustomIds }),
      });
      const json = await res.json();
      if (json.success) {
        setMessage({ type: "success", text: "API keys & AI model saved successfully!" });
        fetchSettings();
      } else {
        setMessage({ type: "error", text: json.error || "Failed to save settings" });
      }
    } catch (err: any) {
      setMessage({ type: "error", text: err?.message || "Failed to connect to backend" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAddProfile() {
    if (!newHandle.trim()) return;
    setIsAddingProfile(true);
    setMessage(null);
    try {
      const res = await fetch("/api/settings/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform: newPlatform, handle: newHandle.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        setMessage({ type: "success", text: `${newPlatform} profile added!` });
        setNewHandle("");
        fetchSettings();
      } else {
        setMessage({ type: "error", text: json.error || "Failed to add profile" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error while adding profile" });
    } finally {
      setIsAddingProfile(false);
    }
  }

  async function handleDeleteProfile(profileId: string) {
    setDeletingProfile(profileId);
    try {
      const res = await fetch(`/api/settings/profiles/${profileId}`, { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        fetchSettings();
      } else {
        setMessage({ type: "error", text: "Failed to remove profile" });
      }
    } catch {
      setMessage({ type: "error", text: "Network error while removing profile" });
    } finally {
      setDeletingProfile(null);
    }
  }

  const platformMeta = (platform: string) =>
    SUPPORTED_PLATFORMS.find((p) => p.value === platform) || SUPPORTED_PLATFORMS[0];

  if (isLoading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <div style={{ fontSize: 14, color: "var(--text-muted)" }}>Loading settings…</div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px" }} className="animate-fade-in">
      <div style={{ maxWidth: 800, margin: "0 auto" }}>
        {/* Title */}
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)", marginBottom: 8 }}>
            Settings & API Credentials
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            All API keys are AES-256 encrypted in your local database — they never leave your machine unencrypted.
          </p>
        </div>

        {message && (
          <div style={{
            padding: "12px 16px", borderRadius: 8, marginBottom: 24,
            background: message.type === "success" ? "rgba(16,185,129,0.15)" : "rgba(244,63,94,0.15)",
            border: `1px solid ${message.type === "success" ? "rgba(16,185,129,0.3)" : "rgba(244,63,94,0.3)"}`,
            color: message.type === "success" ? "var(--brand-emerald)" : "var(--brand-rose)",
            fontSize: 13, display: "flex", alignItems: "center", gap: 8,
          }}>
            {message.type === "success" ? "✓" : "⚠️"} {message.text}
          </div>
        )}
        {/* Theme Settings */}
        <div className="glass" style={{ borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
            UI Theme
          </h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
            Choose your preferred aesthetic.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
            {[
              { id: "midnight", label: "Midnight Violet" },
              { id: "cyberpunk", label: "Cyberpunk Neon" },
              { id: "nordic", label: "Nordic Glacier" },
              { id: "monokai", label: "Monokai Pro" },
              { id: "solarized", label: "Solarized Light" },
              { id: "doomsday", label: "Doomsday" },
            ].map((th) => {
              const isActive = theme === th.id;
              return (
                <div
                  key={th.id}
                  onClick={() => setTheme(th.id as any)}
                  style={{
                    padding: 12, borderRadius: 8, border: `1px solid ${isActive ? "var(--brand-violet)" : "var(--border-default)"}`,
                    background: isActive ? "rgba(124,58,237,0.15)" : "var(--surface-2)",
                    color: isActive ? "var(--brand-violet-light)" : "var(--text-primary)",
                    fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "center",
                    transition: "all 0.2s",
                    boxShadow: isActive ? "var(--glow-violet)" : "none",
                  }}
                >
                  {th.label}
                </div>
              );
            })}
          </div>
        </div>

        {/* BYOK Section — Multi-provider */}
        <div className="glass" style={{ borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
            AI Provider API Keys (BYOK)
          </h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
            Add your own API keys. The active provider is whichever has a saved key. Priority: Gemini → OpenAI → Claude → Custom/GLM.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {AI_PROVIDERS.map((prov) => (
              <div key={prov.value} style={{
                padding: 16, borderRadius: 10,
                background: "var(--surface-2)",
                border: "1px solid var(--border-subtle)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    {prov.label}
                  </div>
                  <span className={`tag ${savedKeyStatus[prov.value] ? "tag-emerald" : "tag-rose"}`}>
                    {savedKeyStatus[prov.value] ? "ACTIVE" : "NOT SET"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="password"
                    value={apiKeys[prov.value]}
                    onChange={(e) => setApiKeys((prev) => ({ ...prev, [prov.value]: e.target.value }))}
                    placeholder={savedKeyStatus[prov.value] ? "•••••••• (saved — type to replace)" : `${prov.keyPrefix}...`}
                    style={{
                      flex: 1, padding: "8px 12px", borderRadius: 7,
                      background: "var(--surface-3)", border: "1px solid var(--border-default)",
                      color: "var(--text-primary)", fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                      outline: "none", boxSizing: "border-box",
                    }}
                  />
                  {savedKeyStatus[prov.value] && !apiKeys[prov.value] && (
                    <button
                      type="button"
                      onClick={() => {
                        setClearKeys((prev) => [...prev, prov.value]);
                        setSavedKeyStatus((prev) => ({ ...prev, [prov.value]: false }));
                      }}
                      title="Remove saved key"
                      style={{
                        padding: "8px 12px", borderRadius: 7, flexShrink: 0,
                        background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)",
                        color: "var(--brand-rose)", fontSize: 11, fontWeight: 600, cursor: "pointer",
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
                  🔑 Get key:{" "}
                  <a href={prov.link} target="_blank" rel="noreferrer"
                    style={{ color: "var(--brand-cyan)", textDecoration: "underline" }}>
                    {prov.linkText}
                  </a>
                </div>

                {prov.value === "custom" && (
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, fontStyle: "italic" }}>
                    Used as a fallback when other providers fail. Supports GLM, OpenAI-compatible, or any Gemini-compatible endpoint.
                  </div>
                )}

                {prov.value === "gemini" && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border-subtle)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>
                        Gemini Model Name
                      </label>
                      <span style={{ fontSize: 11, color: "var(--brand-violet-light)", fontWeight: 500 }}>
                        Default: gemini-2.5-flash
                      </span>
                    </div>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
                      Type any custom Google Gemini model string or choose a preset below:
                    </p>
                    <input
                      type="text"
                      value={geminiModel}
                      onChange={(e) => setGeminiModel(e.target.value)}
                      placeholder="e.g. gemini-2.5-flash, gemini-2.5-pro, gemini-1.5-flash"
                      style={{
                        width: "100%", padding: "8px 12px", borderRadius: 7,
                        background: "var(--surface-3)", border: "1px solid var(--border-default)",
                        color: "var(--brand-cyan)", fontSize: 13, fontFamily: "'JetBrains Mono', monospace",
                        outline: "none", boxSizing: "border-box", marginBottom: 8,
                      }}
                    />
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {[
                        { label: "⚡ gemini-2.5-flash (Fast & Recommended)", value: "gemini-2.5-flash" },
                        { label: "🧠 gemini-2.5-pro (Reasoning)", value: "gemini-2.5-pro" },
                        { label: "🚀 gemini-1.5-flash", value: "gemini-1.5-flash" },
                        { label: "💎 gemini-1.5-pro", value: "gemini-1.5-pro" },
                      ].map((preset) => (
                        <button
                          key={preset.value}
                          type="button"
                          onClick={() => setGeminiModel(preset.value)}
                          style={{
                            padding: "4px 8px", borderRadius: 5, fontSize: 11,
                            background: geminiModel === preset.value ? "rgba(124,58,237,0.2)" : "var(--surface-3)",
                            border: `1px solid ${geminiModel === preset.value ? "var(--brand-violet)" : "var(--border-subtle)"}`,
                            color: geminiModel === preset.value ? "var(--brand-violet-light)" : "var(--text-secondary)",
                            cursor: "pointer",
                          }}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Custom Providers — Dynamic + Button */}
          <div style={{ marginTop: 16 }}>
            {customProviders.map((cp, idx) => (
              <div key={cp.id} style={{
                padding: 16, borderRadius: 10, marginBottom: 12,
                background: "var(--surface-2)", border: "1px solid var(--border-violet)",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                  <input
                    type="text"
                    value={cp.label}
                    onChange={(e) => setCustomProviders((prev) => prev.map((p, i) => i === idx ? { ...p, label: e.target.value } : p))}
                    placeholder="Provider name (e.g. GLM, DeepSeek, Mistral)"
                    style={{
                      flex: 1, padding: "5px 10px", borderRadius: 6,
                      background: "var(--surface-3)", border: "1px solid var(--border-default)",
                      color: "var(--text-primary)", fontSize: 13, fontWeight: 600, outline: "none",
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setRemovedCustomIds((prev) => [...prev, cp.id]);
                      setCustomProviders((prev) => prev.filter((_, i) => i !== idx));
                    }}
                    title="Remove provider"
                    style={{
                      marginLeft: 8, padding: "5px 10px", borderRadius: 6, flexShrink: 0,
                      background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)",
                      color: "var(--brand-rose)", fontSize: 13, cursor: "pointer",
                    }}
                  >×</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                  <div>
                    <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 3, textTransform: "uppercase" }}>API Key</label>
                    <input
                      type="password"
                      value={cp.key}
                      onChange={(e) => setCustomProviders((prev) => prev.map((p, i) => i === idx ? { ...p, key: e.target.value } : p))}
                      placeholder={cp.hasKey ? "•••••••• (saved — type to replace)" : "Paste API key…"}
                      style={customInputStyle}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Model</label>
                    <input
                      type="text"
                      value={cp.model}
                      onChange={(e) => setCustomProviders((prev) => prev.map((p, i) => i === idx ? { ...p, model: e.target.value } : p))}
                      placeholder="e.g. glm-4-flash, deepseek-chat"
                      style={customInputStyle}
                    />
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 10, color: "var(--text-muted)", display: "block", marginBottom: 3, textTransform: "uppercase" }}>Base URL (OpenAI-compatible endpoint)</label>
                  <input
                    type="text"
                    value={cp.baseUrl}
                    onChange={(e) => setCustomProviders((prev) => prev.map((p, i) => i === idx ? { ...p, baseUrl: e.target.value } : p))}
                    placeholder="https://open.bigmodel.cn/api/paas/v4"
                    style={customInputStyle}
                  />
                </div>
                {cp.hasKey && !cp.key && (
                  <span className="tag tag-emerald" style={{ marginTop: 8, display: "inline-block" }}>SAVED</span>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setCustomProviders((prev) => [...prev, {
                id: `custom_${Date.now()}`,
                key: "",
                label: "",
                baseUrl: "https://open.bigmodel.cn/api/paas/v4",
                model: "glm-4-flash",
                format: "openai" as const,
                hasKey: false,
              }])}
              style={{
                width: "100%", padding: "10px", borderRadius: 10,
                background: "rgba(124,58,237,0.08)", border: "1px dashed var(--border-violet)",
                color: "var(--brand-violet-light)", fontSize: 13, fontWeight: 500,
                cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              }}
            >
              + Add Custom Provider
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 20 }}>
            <button
              onClick={handleSaveKeys}
              disabled={isSaving}
              style={{
                padding: "10px 24px", borderRadius: 8, border: "none",
                background: "linear-gradient(135deg, var(--brand-violet), var(--brand-indigo))",
                color: "white", fontSize: 13, fontWeight: 600, cursor: isSaving ? "not-allowed" : "pointer",
                boxShadow: "0 4px 12px rgba(124,58,237,0.3)",
                opacity: isSaving ? 0.7 : 1,
              }}
            >
              {isSaving ? "Saving Keys…" : "Save API Keys"}
            </button>
          </div>
        </div>

        {/* Coding Profiles Section */}
        <div className="glass" style={{ borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
            Coding Profiles
          </h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
            Connect any number of competitive programming profiles. The AI uses your submission history to adapt hints to your coding style.
          </p>

          {/* Add Profile Form */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20, alignItems: "flex-end" }}>
            <div style={{ flex: "0 0 180px" }}>
              <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, display: "block", marginBottom: 5, textTransform: "uppercase" }}>
                Platform
              </label>
              <select
                value={newPlatform}
                onChange={(e) => setNewPlatform(e.target.value)}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 8,
                  background: "var(--surface-3)", border: "1px solid var(--border-default)",
                  color: "var(--text-primary)", fontSize: 13, outline: "none", cursor: "pointer",
                }}
              >
                {SUPPORTED_PLATFORMS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, display: "block", marginBottom: 5, textTransform: "uppercase" }}>
                Handle / Username
              </label>
              <input
                type="text"
                value={newHandle}
                onChange={(e) => setNewHandle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddProfile(); }}
                placeholder={platformMeta(newPlatform).placeholder}
                style={{
                  width: "100%", padding: "9px 12px", borderRadius: 8,
                  background: "var(--surface-3)", border: "1px solid var(--border-default)",
                  color: "var(--text-primary)", fontSize: 13, outline: "none", boxSizing: "border-box",
                }}
              />
            </div>
            <button
              onClick={handleAddProfile}
              disabled={isAddingProfile || !newHandle.trim()}
              style={{
                padding: "9px 18px", borderRadius: 8, border: "none",
                background: "linear-gradient(135deg, var(--brand-emerald), #059669)",
                color: "white", fontSize: 13, fontWeight: 600,
                cursor: (isAddingProfile || !newHandle.trim()) ? "not-allowed" : "pointer",
                opacity: (isAddingProfile || !newHandle.trim()) ? 0.6 : 1,
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {isAddingProfile ? "Adding…" : "+ Add Profile"}
            </button>
          </div>

          {/* Connected Profiles List */}
          {profiles.length === 0 ? (
            <div style={{
              padding: "20px 16px", textAlign: "center",
              background: "var(--surface-2)", borderRadius: 8,
              border: "1px dashed var(--border-default)",
              color: "var(--text-muted)", fontSize: 13,
            }}>
              No profiles connected yet. Add your first profile above.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {profiles.map((p) => {
                const meta = platformMeta(p.platform);
                return (
                  <div key={p.id} style={{
                    padding: "12px 16px",
                    background: "var(--surface-2)",
                    borderRadius: 8,
                    border: "1px solid var(--border-subtle)",
                    display: "flex", alignItems: "center", gap: 12,
                  }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: meta.color,
                      textTransform: "uppercase", letterSpacing: "0.05em",
                      background: `${meta.color}22`,
                      padding: "3px 8px", borderRadius: 4,
                      minWidth: 80, textAlign: "center",
                    }}>
                      {meta.label}
                    </span>
                    <span style={{ flex: 1, fontSize: 13, color: "var(--text-primary)", fontFamily: "JetBrains Mono" }}>
                      {p.handle}
                    </span>
                    <button
                      onClick={() => handleDeleteProfile(p.id)}
                      disabled={deletingProfile === p.id}
                      style={{
                        width: 26, height: 26, borderRadius: 6, border: "none",
                        background: "rgba(244,63,94,0.1)",
                        color: "var(--brand-rose)", fontSize: 13, cursor: "pointer",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        opacity: deletingProfile === p.id ? 0.5 : 1,
                      }}
                      title="Remove profile"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Seed Code Section — Paste Your Solutions */}
        {/* Companion Token Section */}
        <div className="glass" style={{ borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
            Companion App Token
          </h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
            Generate a token to link the CodeOn Companion desktop app to your account. Paste it into the companion app to sync your submissions.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="text"
              value={companionToken}
              readOnly
              placeholder="No token generated yet"
              onClick={(e) => (e.target as HTMLInputElement).select()}
              style={{
                flex: 1, padding: "10px 14px", borderRadius: 8,
                background: "var(--surface-3)", border: "1px solid var(--border-default)",
                color: companionToken ? "var(--brand-cyan)" : "var(--text-muted)",
                fontSize: 13, fontFamily: "'JetBrains Mono', monospace", outline: "none", boxSizing: "border-box",
                cursor: companionToken ? "text" : "default",
              }}
            />
            <button
              onClick={handleGenerateToken}
              disabled={tokenLoading}
              style={{
                padding: "10px 18px", borderRadius: 8, border: "none",
                background: "linear-gradient(135deg, var(--brand-emerald), #059669)",
                color: "white", fontSize: 13, fontWeight: 600,
                cursor: tokenLoading ? "not-allowed" : "pointer",
                opacity: tokenLoading ? 0.6 : 1, whiteSpace: "nowrap",
              }}
            >
              {tokenLoading ? "Generating…" : companionToken ? "Regenerate" : "Generate Token"}
            </button>
          </div>
          {companionToken && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, lineHeight: 1.6 }}>
              Copy this token and paste it into the CodeOn Companion desktop app. Your solutions will be linked to your account.
            </div>
          )}
        </div>

        <div className="glass" style={{ borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
            Train Your AI Mentor
            {trainedSolutions.length > 0 && (
              <span className="tag tag-emerald" style={{ marginLeft: 10, fontSize: 11 }}>
                {trainedSolutions.length} trained
              </span>
            )}
          </h2>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
            Paste 2-3 of your accepted solutions below, or use the CodeOn Companion desktop app to auto-sync from Codeforces/LeetCode.
          </p>

          {trainedSolutions.length > 0 && (
            <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={async () => {
                  if (resetLoading) return;
                  if (!confirm("This will DELETE all your trained solutions. You'll need to re-sync via the companion app. Continue?")) return;
                  setResetLoading(true);
                  try {
                    const res = await fetch("/api/settings/reset-rag", { method: "POST" });
                    const json = await res.json();
                    if (json.success) {
                      setMessage({ type: "success", text: json.message });
                      setTrainedSolutions([]);
                    } else {
                      setMessage({ type: "error", text: json.error || "Failed to reset" });
                    }
                  } catch {
                    setMessage({ type: "error", text: "Network error" });
                  } finally {
                    setResetLoading(false);
                  }
                }}
                disabled={resetLoading}
                style={{
                  padding: "6px 14px", borderRadius: 6,
                  background: "rgba(244,63,94,0.1)", border: "1px solid rgba(244,63,94,0.3)",
                  color: "var(--brand-rose)", fontSize: 11, fontWeight: 600,
                  cursor: resetLoading ? "not-allowed" : "pointer",
                  opacity: resetLoading ? 0.6 : 1,
                }}
              >
                {resetLoading ? "Resetting..." : "Reset RAG Data"}
              </button>
            </div>
          )}

          {trainedSolutions.length > 0 && (
            <div style={{ marginBottom: 16, background: "var(--surface-2)", borderRadius: 8, border: "1px solid var(--border-subtle)", overflow: "hidden" }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", padding: "10px 14px", background: "var(--surface-3)", textTransform: "uppercase", letterSpacing: "0.05em", borderBottom: "1px solid var(--border-subtle)" }}>
                Trained Solutions ({trainedSolutions.length})
              </div>
              <div style={{ maxHeight: 400, overflowY: "auto" }}>
                {trainedSolutions.map((s, i) => (
                  <div key={i} style={{ padding: "10px 14px", borderBottom: i < trainedSolutions.length - 1 ? "1px solid var(--border-subtle)" : "none", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 4,
                      textTransform: "uppercase", letterSpacing: "0.05em",
                      background: s.platform === 'codeforces' ? 'rgba(34,211,238,0.15)' : s.platform === 'leetcode' ? 'rgba(251,191,36,0.15)' : 'rgba(124,58,237,0.15)',
                      color: s.platform === 'codeforces' ? 'var(--brand-cyan)' : s.platform === 'leetcode' ? 'var(--brand-amber)' : 'var(--brand-violet-light)',
                    }}>
                      {s.platform}
                    </span>
                    <span style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 500, flex: 1, minWidth: 120 }}>
                      {s.url ? (
                        <a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--text-primary)", textDecoration: "none" }}>
                          {s.title}
                        </a>
                      ) : s.title}
                    </span>
                    {s.tags.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {s.tags.slice(0, 3).map((tag, j) => (
                          <span key={j} className="tag tag-cyan" style={{ fontSize: 10 }}>{tag}</span>
                        ))}
                        {s.tags.length > 3 && <span style={{ fontSize: 10, color: "var(--text-muted)" }}>+{s.tags.length - 3}</span>}
                      </div>
                    )}
                    {s.patterns.length > 0 && (
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {s.patterns.slice(0, 2).map((p, j) => (
                          <span key={j} className="tag tag-emerald" style={{ fontSize: 10 }}>{p}</span>
                        ))}
                      </div>
                    )}
                    {s.updatedAt && (
                      <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "JetBrains Mono" }}>
                        {new Date(s.updatedAt).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {seedMsg && (
            <div style={{
              padding: "10px 14px", borderRadius: 8, marginBottom: 16,
              background: seedMsg.type === "success" ? "rgba(16,185,129,0.15)" : "rgba(244,63,94,0.15)",
              border: `1px solid ${seedMsg.type === "success" ? "rgba(16,185,129,0.3)" : "rgba(244,63,94,0.3)"}`,
              color: seedMsg.type === "success" ? "var(--brand-emerald)" : "var(--brand-rose)",
              fontSize: 13, display: "flex", alignItems: "center", gap: 8,
            }}>
              {seedMsg.type === "success" ? "✓" : "⚠️"} {seedMsg.text}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select
                value={seedPlatform}
                onChange={(e) => setSeedPlatform(e.target.value)}
                style={{
                  padding: "8px 12px", borderRadius: 8, flex: "0 0 140px",
                  background: "var(--surface-3)", border: "1px solid var(--border-default)",
                  color: "var(--text-primary)", fontSize: 13, outline: "none", cursor: "pointer", boxSizing: "border-box",
                }}
              >
                <option value="codeforces">Codeforces</option>
                <option value="leetcode">LeetCode</option>
                <option value="atcoder">AtCoder</option>
                <option value="codechef">CodeChef</option>
                <option value="manual">Manual</option>
              </select>
              <input
                type="text"
                value={seedTitle}
                onChange={(e) => setSeedTitle(e.target.value)}
                placeholder="Problem title (e.g. Two Sum)"
                style={{
                  flex: 1, minWidth: 150, padding: "8px 12px", borderRadius: 8,
                  background: "var(--surface-3)", border: "1px solid var(--border-default)",
                  color: "var(--text-primary)", fontSize: 13, outline: "none", boxSizing: "border-box",
                }}
              />
              <input
                type="text"
                value={seedTags}
                onChange={(e) => setSeedTags(e.target.value)}
                placeholder="Tags (e.g. array, hashmap)"
                style={{
                  flex: 1, minWidth: 150, padding: "8px 12px", borderRadius: 8,
                  background: "var(--surface-3)", border: "1px solid var(--border-default)",
                  color: "var(--text-primary)", fontSize: 13, outline: "none", boxSizing: "border-box",
                }}
              />
            </div>
            <input
              type="text"
              value={seedUrl}
              onChange={(e) => setSeedUrl(e.target.value)}
              placeholder="Problem URL (e.g. https://codeforces.com/problemset/problem/1/A)"
              style={{
                width: "100%", padding: "8px 12px", borderRadius: 8,
                background: "var(--surface-3)", border: "1px solid var(--border-default)",
                color: "var(--text-primary)", fontSize: 13, outline: "none", boxSizing: "border-box",
              }}
            />
            <textarea
              value={seedCode}
              onChange={(e) => setSeedCode(e.target.value)}
              placeholder={"Paste your accepted C++ solution here...\n\n#include <bits/stdc++.h>\nusing namespace std;\nint main() {\n    // your code\n}"}
              rows={10}
              style={{
                width: "100%", padding: 12, borderRadius: 8,
                background: "var(--surface-3)", border: "1px solid var(--border-default)",
                color: "var(--text-primary)", fontSize: 13,
                fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.5,
                outline: "none", boxSizing: "border-box", resize: "vertical",
              }}
            />
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={async () => {
                  if (!seedCode.trim() || seedSaving) return;
                  setSeedSaving(true);
                  setSeedMsg(null);
                  try {
                    const res = await fetch("/api/settings/seed-code", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        solutions: [{
                          code: seedCode.trim(),
                          problemTitle: seedTitle.trim() || "Manual Submission",
                          platform: seedPlatform,
                          url: seedUrl.trim() || undefined,
                          tags: seedTags.split(",").map((t) => t.trim()).filter(Boolean),
                        }],
                      }),
                    });
                    const json = await res.json();
                    if (json.success) {
                      setSeedMsg({ type: "success", text: json.message || "Solution stored." });
                      setSeedCode("");
                      setSeedTitle("");
                      setSeedTags("");
                      setSeedUrl("");
                      fetchTrainedSolutions();
                    } else {
                      setSeedMsg({ type: "error", text: json.error || "Failed to store solution" });
                    }
                  } catch {
                    setSeedMsg({ type: "error", text: "Network error" });
                  } finally {
                    setSeedSaving(false);
                  }
                }}
                disabled={!seedCode.trim() || seedSaving}
                style={{
                  padding: "9px 20px", borderRadius: 8, border: "none",
                  background: "linear-gradient(135deg, var(--brand-emerald), #059669)",
                  color: "white", fontSize: 13, fontWeight: 600,
                  cursor: (!seedCode.trim() || seedSaving) ? "not-allowed" : "pointer",
                  opacity: (!seedCode.trim() || seedSaving) ? 0.6 : 1,
                  display: "flex", alignItems: "center", gap: 6,
                }}
              >
                {seedSaving ? "Analyzing & storing…" : "+ Train AI with this solution"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const customInputStyle: React.CSSProperties = {
  width: "100%", padding: "7px 10px", borderRadius: 6,
  background: "var(--surface-3)", border: "1px solid var(--border-default)",
  color: "var(--text-primary)", fontSize: 12, fontFamily: "'JetBrains Mono', monospace",
  outline: "none", boxSizing: "border-box",
};
