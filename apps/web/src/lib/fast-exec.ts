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
 * Execute code — tries Docker first, falls back to Piston API.
 * Works on both local dev (Docker) and Vercel (Piston).
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
      // Docker failed — fall back to Wandbox
    }
  }

  // Fall back to Wandbox API (deployed / no Docker)
  return await executeViaWandbox(code, input, timeoutMs, language);
}
