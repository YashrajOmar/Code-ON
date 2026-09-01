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
 * Execute code via Piston API (deployed / no Docker).
 * Free public API: https://emkc.org/api/v2/piston
 * Supports C++, Python, Java — no API key needed.
 */
async function executeViaPiston(
  code: string,
  input: string,
  timeoutMs: number
): Promise<{ output: string; error: string | null }> {
  const PISTON_URL = "https://emkc.org/api/v2/piston/execute";

  // Map our language to Piston's language + version
  const langMap: Record<string, { language: string; version: string }> = {
    cpp: { language: "c++", version: "10.2.0" },
    cpp17: { language: "c++", version: "10.2.0" },
    cpp20: { language: "c++", version: "10.2.0" },
    python3: { language: "python", version: "3.10.0" },
    java: { language: "java", version: "15.0.2" },
  };

  const lang = langMap["cpp"] ?? langMap["cpp17"];

  const response = await fetch(PISTON_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      language: lang.language,
      version: lang.version,
      files: [{ name: "main.cpp", content: code }],
      stdin: input,
      compile_timeout: 10000,
      run_timeout: timeoutMs,
      compile_memory_limit: -1,
      run_memory_limit: -1,
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => "Unknown error");
    return { output: "", error: `Piston API error (${response.status}): ${errText.substring(0, 200)}` };
  }

  const data = await response.json();

  // Check compilation errors
  if (data.compile && data.compile.code !== 0) {
    const compileErr = (data.compile.stderr || data.compile.output || "").trim();
    return { output: compileErr, error: "compilation" };
  }

  // Check run errors
  if (data.run) {
    const output = (data.run.stdout || "").trim();
    const stderr = (data.run.stderr || "").trim();

    if (data.run.code !== 0 && stderr) {
      return { output, error: stderr };
    }

    return { output, error: stderr || null };
  }

  return { output: "", error: "No output from Piston API" };
}

/**
 * Execute code — tries Docker first, falls back to Piston API.
 * Works on both local dev (Docker) and Vercel (Piston).
 */
export async function executeCode(
  code: string,
  input: string,
  timeoutMs: number = 3000
): Promise<{ output: string; error: string | null }> {
  // Try Docker first (local dev)
  const hasDocker = await checkDocker();
  if (hasDocker) {
    try {
      return await executeViaDocker(code, input, timeoutMs);
    } catch {
      // Docker failed — fall back to Piston
    }
  }

  // Fall back to Piston API (deployed / no Docker)
  return await executeViaPiston(code, input, timeoutMs);
}
