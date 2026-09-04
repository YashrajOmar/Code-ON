# codeOn — Personalized AI Coding Coach

A production-grade AI mentor platform that transforms students from their current coding style into engineers who naturally write clean, interview-quality, optimized software.

## Live Demo

**Web App**: https://codeon-coding-coach-eight.vercel.app

## Architecture

Clean Architecture (Hexagonal/Ports and Adapters) TypeScript monorepo.

```
apps/
  web/              Next.js 16 frontend with Monaco editor + AI mentor
  companion/        Electron desktop app (auto-syncs CF/LC submissions)

packages/
  core/             Pure domain — zero I/O, zero frameworks
    entities/              Branded domain types
    learning-engine/       Elo, SM-2, Knowledge Graph, Style Evolution, Recommendations
    trail-engine/          Native Optimization Trail (Brute Force → Optimal)
    prompt-builder/        Split context assembly for Teaching Engine
    session-classifier/    Deterministic Problem/Scratchpad/Interview/Contest detection
    ports/                 All interface definitions
  code-analysis/    Tree-sitter AST-based code analysis (6 layers)
  adapters/         Port implementations (AI, Storage, Retrieval, Sandbox, Events)
  db/               Drizzle ORM schema + migrations (Postgres + pgvector)
  scrapers/         Problem + submission scrapers (Codeforces, LeetCode, AtCoder)
  shared/           Zod schemas, shared types
  config/           Type-safe environment configuration
  execution-engine/ Code execution sandbox (Wandbox API)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16.2.10 (Turbopack), React 19, Monaco Editor, Zustand |
| Backend | Next.js API Routes (serverless on Vercel) |
| Database | Neon PostgreSQL + pgvector (768-dim embeddings) |
| Auth | Clerk (production instance, middleware enforcement) |
| AI | Provider-agnostic — Gemini / OpenAI / GLM / Anthropic (user's own API key) |
| Code Execution | Wandbox API (gcc-head for C++) |
| Scraping | Jina AI reader proxy (Cloudflare bypass for CF), GraphQL (LeetCode) |
| Code Analysis | Tree-sitter (web-tree-sitter) via @codeon/code-analysis |
| Companion App | Electron 33 + Playwright (persistent Chrome profile) |
| Hosting | Vercel (web app), Neon (database), GitHub (repo, auto-deploy) |

## Quick Start

### Web App (Development)

```bash
pnpm install
cd apps/web
pnpm dev          # http://localhost:3000
```

### Companion App (Development)

```bash
cd apps/companion
npm install
npx electron electron/main.js
```

### Tests

```bash
pnpm test:unit    # Run all unit tests
pnpm type-check   # Type check all packages
pnpm lint         # Lint all packages
```

## How It Works

```
1. User signs in (Clerk auth) → redirected to IDE
2. Paste a Codeforces/LeetCode problem URL → app scrapes problem statement + examples + editorial
3. Write your solution in the Monaco editor
4. Click "Give me a hint" → AI gives Socratic hints (short, no code unless explicitly asked)
5. Click "Optimization Trail" tab → step-by-step path from brute force to optimal
6. Run code → Wandbox compiler returns AC/WA/TLE/CE verdict
7. Train AI with your submissions:
   a. Companion app auto-scrapes your CF/LC AC submissions
   b. Or manually paste solutions in Settings
8. AI learns your coding style → future hints match your patterns
```

## RAG Pipeline

```
Companion app scrapes code → POST /api/settings/seed-code (with cot_ token)
  → Tree-sitter AST analyzes code (detects hash map, sorting, DP, etc.)
  → Style summary built (patterns, complexity, code length)
  → Gemini text-embedding-004 generates 768-dim vector
  → Stored in UserTopicProfile (pgvector)

When user asks for hint → /api/hint
  → pgvector cosine similarity search (WHERE userId = currentUserId, MAX_DISTANCE = 0.5)
  → Top 5 matches retrieved → user's actual code snippets injected into AI prompt
  → AI sees user's coding style → generates hints matching their patterns
```

## Companion App Features

- **Hybrid Login Verification**: Cookie check first (fast), then active session verification via platform page/API
- **Handle Auto-Detection**: Handle extracted from platform website after login, input locked (readonly)
- **Handle Sanitization**: `^[a-zA-Z0-9_\-\.]+$` regex validation
- **Batch Sync**: 20 submissions per batch, 2-minute pause between batches, 3-7s jitter
- **Failed Queue**: Failed submissions retried on next sync, 3-strike permanent removal
- **Crash Recovery**: Resume index saved after every batch — resumes where it left off
- **Auto-Sync Cooldown**: 5-minute pause when all platforms fail auth
- **Clear All Local Data**: Wipes settings, sync state, browser profile

## Design Principles

- **Socratic by default** — short hints, no code unless user explicitly asks
- **Always read code + problem** — AI must analyze current code before responding
- **Trail before AI** — optimization path from verified editorial, not LLM inference
- **Analysis before AI** — Tree-sitter static analysis runs before every LLM call
- **Cold-start safe** — clean competitive C++ fallback when no RAG profile exists
- **Provider-agnostic** — Gemini / OpenAI / GLM / Claude via user's own API key
- **Per-account isolation** — all DB queries scoped by userId, no shared data

## Environment Variables

```bash
# Database
DATABASE_URL=postgresql://...neon.tech/neondb?sslmode=require

# Encryption (AES-256-CBC for API keys + companion tokens)
ENCRYPTION_SECRET=your-32-byte-secret

# Clerk Auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...

# AI (user provides their own key in Settings — these are optional fallbacks)
GEMINI_API_KEY=                          # Optional server-side fallback
GEMINI_MODEL=gemini-2.5-flash            # Default model
```

## Milestones

| # | Status | Milestone |
|---|--------|-----------|
| 1 | ✅ | Monorepo + Domain Scaffold |
| 2 | ✅ | Learning Engine (45 unit tests) |
| 3 | ✅ | Trail Engine + Code Analysis (Tree-sitter, 46 tests) |
| 4 | ✅ | Storage + Retrieval (Neon + pgvector) |
| 5 | ✅ | Teaching Engine + Prompt Builder (Socratic hints) |
| 6 | ✅ | API Layer (Next.js API Routes) |
| 7 | ✅ | Frontend IDE (Monaco + Dashboard + Settings) |
| 8 | ✅ | Companion App (Electron + Playwright auto-sync) |
| 9 | 🔜 | Observability + CI/CD |

## Database Schema

| Table | Purpose |
|-------|---------|
| User | Clerk user accounts |
| ApiKey | Encrypted AI provider keys + companion tokens |
| CodingProfile | User's CF/LC/AtCoder handles |
| Problem | Scraped problem cache (statement, examples, editorial, reference solutions) |
| UserTopicProfile | RAG embeddings — 768-dim vector + code snippet + style analysis |

## License

Private. All rights reserved.
