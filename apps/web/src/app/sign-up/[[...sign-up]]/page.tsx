import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "var(--surface-0)",
      flexDirection: "column",
      gap: 32,
    }}>
      <div style={{ textAlign: "center" }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14, margin: "0 auto 16px",
          background: "linear-gradient(135deg, #7c3aed, #4f46e5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 22, fontWeight: 800, color: "white",
          boxShadow: "0 8px 24px rgba(124,58,237,0.4)",
        }}>C</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "white", margin: 0 }}>Join codeOn</h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>
          Start your personalized coding journey
        </p>
      </div>
      <SignUp routing="hash" />
    </div>
  );
}
