import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";

const isPublicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  // Public API routes that don't require auth:
  // - /api/webhooks/* uses its own Bearer token auth (INGEST_WEBHOOK_SECRET)
  // - /api/companion is public SSE for Competitive Companion extension
  "/api/webhooks/(.*)",
  "/api/companion",
]);

const handler = clerkMiddleware(async (auth, req) => {
  if (!isPublicRoute(req)) {
    await auth.protect();
  }
});

export default function proxy(req: NextRequest) {
  return handler(req, {} as any);
}

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
