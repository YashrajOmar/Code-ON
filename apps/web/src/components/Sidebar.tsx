"use client";

import { UserButton, SignInButton, useUser } from "@clerk/nextjs";

type View = "ide" | "dashboard" | "settings";

interface SidebarProps {
  activeView: View;
  onViewChange: (v: View) => void;
}

const NAV = [
  { id: "ide", icon: "⌥", label: "IDE" },
  { id: "dashboard", icon: "◎", label: "Dashboard" },
];

export default function Sidebar({ activeView, onViewChange }: SidebarProps) {
  const { isSignedIn, user } = useUser();
  const initials = user?.firstName?.[0] ?? user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ?? "?";

  return (
    <aside style={{
      width: 56,
      height: "100vh",
      background: "var(--surface-1)",
      borderRight: "1px solid var(--border-subtle)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      paddingTop: 12,
      paddingBottom: 12,
      flexShrink: 0,
      zIndex: 50,
    }}>
      {/* Logo */}
      <div style={{
        width: 34, height: 34, borderRadius: 10, marginBottom: 20,
        background: "linear-gradient(135deg, var(--brand-violet), var(--brand-indigo))",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, fontWeight: 800, color: "white",
        boxShadow: "0 4px 12px rgba(124,58,237,0.4)",
        cursor: "pointer",
      }}
      onClick={() => onViewChange("ide")}>
        C
      </div>

      {/* Navigation */}
      <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4, alignItems: "center" }}>
        {NAV.map((item) => {
          const isActive = activeView === item.id;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id as View)}
              title={item.label}
              style={{
                width: 38, height: 38, borderRadius: 10,
                border: "none",
                background: isActive ? "rgba(124,58,237,0.2)" : "transparent",
                color: isActive ? "var(--brand-violet-light)" : "var(--text-muted)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 16, cursor: "pointer",
                transition: "all 0.15s",
                boxShadow: isActive ? "inset 0 0 0 1px rgba(124,58,237,0.4)" : "none",
              }}
              onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = "var(--surface-3)"; e.currentTarget.style.color = "var(--text-secondary)"; } }}
              onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; } }}
            >
              {item.icon}
            </button>
          );
        })}
      </nav>

      {/* Bottom: Settings + User */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
        <button
          onClick={() => onViewChange("settings")}
          title="Settings"
          style={{
            width: 38, height: 38, borderRadius: 10, border: "none",
            background: activeView === "settings" ? "rgba(124,58,237,0.2)" : "transparent",
            color: activeView === "settings" ? "var(--brand-violet-light)" : "var(--text-muted)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 16, cursor: "pointer", transition: "all 0.15s",
            boxShadow: activeView === "settings" ? "inset 0 0 0 1px rgba(124,58,237,0.4)" : "none",
          }}
          onMouseEnter={e => { if (activeView !== "settings") { e.currentTarget.style.background = "var(--surface-3)"; e.currentTarget.style.color = "var(--text-secondary)"; } }}
          onMouseLeave={e => { if (activeView !== "settings") { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = "var(--text-muted)"; } }}
        >
          ⚙
        </button>

        {isSignedIn ? (
          <UserButton
            appearance={{
              elements: {
                userButtonAvatarBox: { width: 32, height: 32 },
              }
            }}
          />
        ) : (
          <SignInButton mode="modal">
            <button
              title="Sign in to sync your progress"
              style={{
                width: 32, height: 32, borderRadius: "50%", border: "2px solid var(--border-default)",
                background: "var(--surface-3)",
                color: "var(--text-muted)", fontSize: 13, fontWeight: 700,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: "pointer", transition: "all 0.15s",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "var(--brand-violet)"; e.currentTarget.style.color = "var(--brand-violet-light)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "var(--border-default)"; e.currentTarget.style.color = "var(--text-muted)"; }}
            >
              {initials}
            </button>
          </SignInButton>
        )}
      </div>
    </aside>
  );
}
