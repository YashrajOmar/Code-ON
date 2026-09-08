import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Fast-Path Code Execution Engine.
 *
 * Two modes:
 *   1. Docker (local dev) — pre-warmed containers, ~400ms
 *   2. Piston API (Vercel/deployed) — free public API, ~500ms-1s
 *
 * Automatically detects which mode to use: tries Docker first,
 * falls back to Piston if Docker isn't available.
 */

const WARM_CONTAINERS = ["codeon-warm-1", "codeon-warm-2"];
let containerIndex = 0;
let dockerAvailable: boolean | null = null;

function getContainer(): string {
  const container = WARM_CONTAINERS[containerIndex % WARM_CONTAINERS.length];
  containerIndex++;
  return container;
}

async function checkDocker(): Promise<boolean> {
  if (dockerAvailable !== null) return dockerAvailable;
  try {
    await execFileAsync("docker", ["ps"], { timeout: 3000 });
    dockerAvailable = true;
  } catch {
    dockerAvailable = false;
  }
  return dockerAvailable;
}

async function ensureContainer(container: string): Promise<boolean> {
  try {
    await execFileAsync("docker", ["inspect", "--format", "{{.State.Running}}", container]);
    return true;
  } catch {
    try {
      await execFileAsync("docker", [
        "run", "-d", "--rm", "--name", container,
        "--network", "none", "--memory", "256m", "--pids-limit", "64",
        "codeon-cpp-runner:latest",
      ]);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Execute code via Docker (local dev).
 */
async function executeViaDocker(
  code: string,
  input: string,
  timeoutMs: number
): Promise<{ output: string; error: string | null }> {
  const container = getContainer();
  const alive = await ensureContainer(container);
  if (!alive) throw new Error("Docker container unavailable");

  const script = [
    `cat << 'EOF_CODE' > /tmp/main.cpp`,
    code,
    `EOF_CODE`,
    `cat << 'EOF_INPUT' > /tmp/input.txt`,
    input,
    `EOF_INPUT`,
    `cd /tmp`,
    `g++ -O2 -std=c++17 main.cpp -o a.out 2>compile_err.txt`,
    `if [ $? -ne 0 ]; then cat compile_err.txt; exit 1; fi`,
    `timeout ${Math.ceil(timeoutMs / 1000)}s ./a.out < input.txt 2>runtime_err.txt`,
    `if [ $? -ne 0 ] && [ -s runtime_err.txt ]; then cat runtime_err.txt; fi`,
  ].join("\n");

  try {
    const { stdout, stderr } = await execFileAsync(
      "docker",
      ["exec", "-i", "--user", "runner", container, "sh", "-c", script],
      { timeout: timeoutMs + 2000, maxBuffer: 1024 * 1024 }
    );

    const output = stdout.trim();
    const errorOutput = stderr.trim();

    if (output.includes("error:") || output.includes("undefined reference")) {
      return { output, error: "compilation" };
    }
    return { output, error: errorOutput || null };
  } catch (err: any) {
    if (err.killed || err.signal === "SIGTERM") {
      return { output: "Execution timed out.", error: "timeout" };
    }
    const stdout = err.stdout?.toString()?.trim() || "";
    const stderr = err.stderr?.toString()?.trim() || "";
    if (stdout) return { output: stdout, error: stderr || null };
    throw err;
  }
}

/**
 * Execute code via Wandbox API (deployed / no Docker).
 * Free public API: https://wandbox.org/api
 * Supports C++, Python, Java — no API key needed.
 * Tested: 2026-09-01, working.
 */
async function executeViaWandbox(
  code: string,
  input: string,
  timeoutMs: number,
  language: string = "cpp17"
): Promise<{ output: string; error: string | null }> {
  const WANDBOX_URL = "https://wandbox.org/api/compile.json";

  // Map our language to Wandbox's compiler name
  const compilerMap: Record<string, string> = {
    cpp: "gcc-head",
    cpp17: "gcc-head",
    cpp20: "gcc-head",
    python3: "cpython-head",
    java: "openjdk-head",
  };

  const compiler = compilerMap[language] ?? compilerMap["cpp17"] ?? "gcc-head";

  const response = await fetch(WANDBOX_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code,
      compiler,
      stdin: input,
      runtime: false,
    }),
    signal: AbortSignal.timeout(Math.max(30000, timeoutMs + 5000)),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    return { output: "", error: `Wandbox API error (${response.status}): ${errText.substring(0, 200)}` };
  }

  const data = await response.json();

  // Check compilation errors
  if (data.compiler_error && data.compiler_error.trim().length > 0) {
    return { output: data.compiler_error.trim(), error: "compilation" };
  }

  // Check run output
  const output = (data.program_output || "").trim();
  const stderr = (data.program_error || "").trim();

  if (data.status !== 0 && stderr) {
    return { output, error: stderr };
  }

  return { output, error: stderr || null };
}

/**
 * Execute code via Judge0 CE (RapidAPI).
 * Free tier: 50 requests/day. Requires JUDGE0_RAPIDAPI_KEY env var.
 * https://judge0.com / https://rapidapi.com/judge0-ce-judge0-ce-default/api/judge0-ce
 */
async function executeViaJudge0(
  code: string,
  input: string,
  timeoutMs: number,
  language: string = "cpp17"
): Promise<{ output: string; error: string | null }> {
  const apiKey = process.env.JUDGE0_RAPIDAPI_KEY;
  if (!apiKey) throw new Error("JUDGE0_RAPIDAPI_KEY not set");

  // Map our language names to Judge0 language IDs
  const langIdMap: Record<string, number> = {
    cpp: 54,      // C++ (GCC 9.2.0)
    cpp17: 54,
    cpp20: 54,
    python3: 71,  // Python 3 (CPython 3.7.7)
    python: 71,
    java: 62,     // Java (OpenJDK 13.0.1)
  };
  const languageId = langIdMap[language] ?? langIdMap["cpp17"];

  const response = await fetch(
    "https://judge0-ce.p.rapidapi.com/submissions/?wait=true&fields=*",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-RapidAPI-Host": "judge0-ce.p.rapidapi.com",
        "X-RapidAPI-Key": apiKey,
      },
      body: JSON.stringify({
        language_id: languageId,
        source_code: code,
        stdin: input,
        cpu_time_limit: Math.ceil(timeoutMs / 1000),
        memory_limit: 262144, // 256 MB
      }),
      signal: AbortSignal.timeout(Math.max(30000, timeoutMs + 15000)),
    }
  );

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    throw new Error(`Judge0 API error (${response.status}): ${errText.substring(0, 200)}`);
  }

  const data = await response.json();

  // Status IDs: 3=Accepted, 5=TLE, 6=Compilation Error, others=Runtime Error
  const statusId = data.status?.id;
  const compileOutput = (data.compile_output || "").trim();
  const stdout = (data.stdout || "").trim();
  const stderr = (data.stderr || "").trim();

  // Compilation error
  if (statusId === 6 || compileOutput) {
    return { output: compileOutput || "Compilation error", error: "compilation" };
  }

  // Time limit exceeded
  if (statusId === 5) {
    return { output: "Time Limit Exceeded", error: "timeout" };
  }

  // Runtime error (status 7-13)
  if (statusId && statusId > 3 && statusId !== 6 && statusId !== 5) {
    return { output: stderr || data.status?.description || "Runtime Error", error: stderr || "runtime" };
  }

  // Success (status 3) — return stdout
  return { output: stdout, error: stderr || null };
}

/**
 * Execute code — tries Docker first (local dev), then Judge0 (cloud), then Wandbox (fallback).
 * Works on both local dev (Docker) and Vercel (Judge0/Wandbox).
 */
export async function executeCode(
  code: string,
  input: string,
  timeoutMs: number = 3000,
  language: string = "cpp17"
): Promise<{ output: string; error: string | null }> {
  // Try Docker first (local dev)
  const hasDocker = await checkDocker();
  if (hasDocker) {
    try {
      return await executeViaDocker(code, input, timeoutMs);
    } catch {
      // Docker failed — fall back
    }
  }

  // Try Judge0 CE (cloud — requires RapidAPI key)
  try {
    return await executeViaJudge0(code, input, timeoutMs, language);
  } catch {
    // Judge0 failed (no key, rate limit, or API error) — fall back to Wandbox
  }

  // Fall back to Wandbox API (free, but currently unstable)
  return await executeViaWandbox(code, input, timeoutMs, language);
}
