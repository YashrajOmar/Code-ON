/**
 * Shared authentication utilities for API routes.
 *
 * In production, every API route MUST call getAuthUser() to get the
 * real Clerk user ID. This replaces the old DEMO_USER_EMAIL pattern
 * where all users shared one account.
 *
 * Usage in a route:
 *   import { getAuthUser } from '@/lib/auth';
 *
 *   export async function POST(req: Request) {
 *     const authUser = await getAuthUser();
 *     if (!authUser) return unauthorized();
 *     // authUser.userId = Clerk user ID
 *     // authUser.dbUser = Prisma user record
 *   }
 */

import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

export interface AuthUser {
  userId: string;
  dbUser: {
    id: string;
    email: string;
    displayName: string | null;
  };
}

/**
 * Get the authenticated user from Clerk session, and find/create
 * their record in the Prisma database.
 *
 * Returns null if not authenticated (no Clerk session).
 */
export async function getAuthUser(): Promise<AuthUser | null> {
  try {
    const { userId } = auth();
    if (!userId) return null;

    // Get the user's email from Clerk
    // In production, Clerk provides the email via the session
    // We use the Clerk user ID as the email identifier
    const clerkEmail = `clerk_${userId}@codeon.user`;

    // Find or create the user in our database
    let dbUser = await prisma.user.findUnique({
      where: { email: clerkEmail },
    });

    if (!dbUser) {
      dbUser = await prisma.user.create({
        data: {
          email: clerkEmail,
          displayName: `User ${userId.substring(0, 8)}`,
        },
      });
    }

    return {
      userId: dbUser.id,
      dbUser: {
        id: dbUser.id,
        email: dbUser.email,
        displayName: dbUser.displayName,
      },
    };
  } catch {
    // In development or if Clerk isn't configured, fall back to demo user
    // This allows local development without Clerk auth
    if (process.env.NODE_ENV === "development") {
      return getDevUser();
    }
    return null;
  }
}

/**
 * Development fallback — creates/returns the demo user.
 * Only used when NODE_ENV=development and Clerk auth fails.
 */
async function getDevUser(): Promise<AuthUser | null> {
  try {
    let dbUser = await prisma.user.findUnique({
      where: { email: "demo@codeon.dev" },
    });

    if (!dbUser) {
      dbUser = await prisma.user.create({
        data: { email: "demo@codeon.dev", displayName: "Developer" },
      });
    }

    return {
      userId: dbUser.id,
      dbUser: {
        id: dbUser.id,
        email: dbUser.email,
        displayName: dbUser.displayName,
      },
    };
  } catch {
    return null;
  }
}

/**
 * Standard unauthorized response.
 */
export function unauthorized() {
  return Response.json(
    { error: "Unauthorized", message: "Please sign in to access this resource." },
    { status: 401 }
  );
}
