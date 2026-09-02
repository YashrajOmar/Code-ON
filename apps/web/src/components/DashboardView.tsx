"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";

interface ProfileData {
  handle: string;
  platform: string;
  rating?: number;
  rank?: string;
  totalSolved?: number;
  easySolved?: number;
  mediumSolved?: number;
  hardSolved?: number;
  topTags?: Array<{ tag: string; count: number }>;
  recentProblems?: Array<{ id: string; name: string; tags: string[]; rating?: number; solvedAt: string }>;
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardView({ onOpenProblem }: { onOpenProblem: (url: string) => void }) {
  const { user } = useUser();
  const [profiles, setProfiles] = useState<ProfileData[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [trainedSolutions, setTrainedSolutions] = useState<Array<{ topic: string; title: string }>>([]);

  const displayName = user?.firstName || user?.username || user?.emailAddresses?.[0]?.emailAddress?.split("@")[0] || "Coder";
  const initials = (user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0] ?? "C").toUpperCase();
  const imageUrl = user?.imageUrl;

  const [greeting, setGreeting] = useState("Welcome");
  useEffect(() => { setGreeting(getGreeting()); }, []);

  useEffect(() => {
    fetch("/api/settings")
      .then(r => r.json())
      .then(async (data) => {
        const savedProfiles: Array<{ platform: string; handle: string }> = data?.data?.codingProfiles ?? [];
        if (savedProfiles.length === 0) { setLoadingProfiles(false); return; }

        const scraped = await Promise.all(
          savedProfiles.map(async (p) => {
            try {
              const res = await fetch("/api/settings/profiles/scrape", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ platform: p.platform, handle: p.handle }),
              });
              if (!res.ok) return { handle: p.handle, platform: p.platform };
              const j = await res.json();
              return j.data ?? { handle: p.handle, platform: p.platform };
            } catch { return { handle: p.handle, platform: p.platform }; }
          })
        );
        setProfiles(scraped.filter(Boolean));
        setLoadingProfiles(false);
      })
      .catch(() => setLoadingProfiles(false));
  }, []);

  useEffect(() => {
    fetch("/api/settings/seed-code")
      .then(r => r.json())
      .then(data => {
        if (data.solutions) setTrainedSolutions(data.solutions);
      })
      .catch(() => {});
  }, []);

  function openProblemInIDE(url: string) {
    onOpenProblem(url);
  }

  const recentProblems = profiles
    .filter(p => p.platform === "codeforces" && p.recentProblems)
    .flatMap(p => (p.recentProblems ?? []).slice(0, 5).map(rp => ({
      title: rp.name,
      difficulty: rp.rating ? (rp.rating < 1300 ? "easy" : rp.rating < 2000 ? "medium" : "hard") : "medium",
      tags: rp.tags,
      time: new Date(rp.solvedAt).toLocaleDateString(),
      cfId: rp.id,
    })))
    .slice(0, 6);

  const tagMap: Record<string, number> = {};
  for (const p of profiles) {
    for (const t of p.topTags ?? []) {
      tagMap[t.tag] = (tagMap[t.tag] ?? 0) + t.count;
    }
  }
  const concepts = Object.entries(tagMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({
      name,
      mastery: Math.min(0.95, count / 20),
      count,
    }));

  const totalSolved = profiles.reduce((s, p) => s + (p.totalSolved ?? 0), 0);
  const cfRating = profiles.find(p => p.platform === "codeforces")?.rating;

  const weakTags = concepts.filter(c => c.mastery < 0.4).slice(0, 3);
  const recommendations = [
    ...(weakTags.length > 0 ? weakTags.map(t => ({
      type: "concept" as const,
      title: `Practice: ${t.name}`,
      reason: `Only ${t.count} problems solved in this topic`,
      difficulty: "medium",
      url: `https://codeforces.com/problemset?tags=${encodeURIComponent(t.name)}`,
    })) : []),
    {
      type: "problem" as const,
      title: "Random CF problem (~1400)",
      reason: "Build consistent solving habits",
      difficulty: "medium",
      url: "https://codeforces.com/problemset?tags=implementation&order=BY_RATING_ASC",
    },
  ].slice(0, 4);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "32px 40px" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 32 }}>
          {imageUrl ? (
            <img src={imageUrl} style={{ width: 48, height: 48, borderRadius: "50%", objectFit: "cover" }} alt="avatar" />
          ) : (
            <div style={{
              width: 48, height: 48, borderRadius: "50%",
              background: "linear-gradient(135deg, var(--brand-violet), var(--brand-cyan))",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, fontWeight: 700, color: "white",
            }}>{initials}</div>
          )}
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
              {greeting}, {displayName}
            </h1>
            <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "4px 0 0" }}>
              {cfRating ? `CF Rating: ${cfRating} · ` : ""}{totalSolved} problems solved{trainedSolutions.length > 0 ? ` · ${trainedSolutions.length} AI-trained` : ""}
            </p>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 10 }}>
            {profiles.map(p => (
              <div key={p.platform + p.handle} className="glass" style={{ padding: "8px 14px", borderRadius: 10, textAlign: "center" }}>
                <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{p.platform}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>{p.handle}</div>
                {p.rating && <div style={{ fontSize: 11, color: "var(--brand-amber)" }}>⭐ {p.rating}</div>}
                {p.totalSolved && <div style={{ fontSize: 11, color: "var(--brand-emerald)" }}>✓ {p.totalSolved} solved</div>}
              </div>
            ))}
            {!loadingProfiles && profiles.length === 0 && (
              <div className="glass" style={{ padding: "10px 16px", borderRadius: 10, fontSize: 12, color: "var(--text-muted)" }}>
                ⚙ Add your CF/LC handle in Settings to see stats
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 24 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div className="glass" style={{ borderRadius: 12, padding: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 20 }}>
                Topic Mastery
                {loadingProfiles && <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 400, marginLeft: 10 }}>Loading…</span>}
              </h2>
              {concepts.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {concepts.map((c) => (
                    <div key={c.name}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                        <span style={{ fontSize: 13, color: "var(--text-secondary)", textTransform: "capitalize" }}>{c.name.replace(/-/g, " ")}</span>
                        <div style={{ display: "flex", gap: 10 }}>
                          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{c.count} solved</span>
                          <span style={{ fontSize: 13, fontWeight: 600, color: c.mastery > 0.6 ? "var(--brand-emerald)" : c.mastery > 0.3 ? "var(--brand-amber)" : "var(--brand-rose)" }}>
                            {Math.round(c.mastery * 100)}%
                          </span>
                        </div>
                      </div>
                      <div className="progress-bar"><div className="progress-fill" style={{ width: `${c.mastery * 100}%` }} /></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-muted)", padding: "12px 0" }}>
                  No topic data yet — add your CF/LC handle in Settings.
                </div>
              )}
            </div>

            <div className="glass" style={{ borderRadius: 12, padding: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Recent Accepted</h2>
              {recentProblems.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {recentProblems.map((p, i) => (
                    <div key={i}
                      onClick={() => openProblemInIDE(`https://codeforces.com/problemset/problem/${p.cfId.replace(/([0-9]+)([A-Z])/, '$1/$2')}`)}
                      style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 8, cursor: "pointer", transition: "background 0.15s" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "var(--surface-3)")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      <span className="verdict-AC" style={{ fontSize: 13, fontWeight: 700, width: 28 }}>AC</span>
                      <span style={{ flex: 1, fontSize: 13, color: "var(--text-primary)" }}>{p.title}</span>
                      <span className={`tag tag-${p.difficulty === "easy" ? "emerald" : p.difficulty === "medium" ? "amber" : "rose"}`}>{p.difficulty}</span>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "JetBrains Mono" }}>{p.time}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                  {loadingProfiles ? "Fetching…" : "No submissions found. Add your CF handle in Settings."}
                </div>
              )}
            </div>

            {trainedSolutions.length > 0 && (
              <div className="glass" style={{ borderRadius: 12, padding: 24 }}>
                <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>
                  Trained Solutions
                  <span className="tag tag-emerald" style={{ marginLeft: 10, fontSize: 11 }}>
                    {trainedSolutions.length} trained
                  </span>
                </h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {trainedSolutions.map((s, i) => (
                    <span key={i} className="tag tag-cyan" style={{ fontSize: 11 }}>
                      {s.title}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 12 }}>
                  Synced from the CodeOn Companion app. These power your personalized AI hints.
                </div>
              </div>
            )}
          </div>

          <div>
            <div className="glass" style={{ borderRadius: 12, padding: 24 }}>
              <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 16 }}>Practice Next</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {recommendations.map((r, i) => (
                  <div key={i}
                    onClick={() => r.url && openProblemInIDE(r.url)}
                    style={{
                      padding: "12px 14px", background: "var(--surface-3)", borderRadius: 10,
                      border: "1px solid var(--border-subtle)", cursor: r.url ? "pointer" : "default",
                      transition: "border-color 0.15s, transform 0.15s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--border-violet)"; e.currentTarget.style.transform = "translateY(-1px)"; }}
                    onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-subtle)"; e.currentTarget.style.transform = "none"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span style={{ fontSize: 14 }}>{r.type === "problem" ? "🎯" : "🧠"}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{r.title}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{r.reason}</div>
                    {r.url && <div style={{ fontSize: 11, color: "var(--brand-cyan)", marginTop: 6 }}>↗ Click to open in IDE</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
