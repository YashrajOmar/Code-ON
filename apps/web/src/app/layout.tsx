import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import ErrorBoundaryClient from "@/components/ErrorBoundaryClient";

export const metadata: Metadata = {
  title: "codeOn — AI Coding Coach",
  description: "Your personalized AI mentor that remembers every mistake, adapts to your style, and guides you from brute force to optimal — one Socratic question at a time.",
  keywords: ["AI coding coach", "competitive programming", "LeetCode", "interview prep", "personalized learning"],
  openGraph: {
    title: "codeOn — AI Coding Coach",
    description: "The world's greatest programming teacher with perfect memory.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <body>
          <ErrorBoundaryClient />
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
