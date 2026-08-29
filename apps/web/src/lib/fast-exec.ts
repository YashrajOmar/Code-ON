import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

/**
 * Fast-Path Code Execution Engine.
 *
 * Instead of routing through BullMQ → Redis → Docker worker (3-5s overhead),
 * this executes code directly on pre-warmed Docker containers via `docker exec`.
 * The containers are already running, so there's zero cold-start delay.
 *
 * Flow:
 *   1. Pick a warm container from the pool (round-robin)
 *   2. Write code + input to the container via stdin
 *   3. Compile and run inside the container
 *   4. Return stdout/stderr synchronously
 *
 * Typical latency: ~400ms per test case (down from 3-5s).
 */

const WARM_CONTAINERS = ["codeon-warm-1", "codeon-warm-2"];
let containerIndex = 0;

function getContainer(): string {
  const container = WARM_CONTAINERS[containerIndex % WARM_CONTAINERS.length];
  containerIndex++;
  return container;
}

/**
 * Check if a warm container is alive. If not, try to start it.
 */
async function ensureContainer(container: string): Promise<boolean> {
  try {
    await execFileAsync("docker", ["inspect", "--format", "{{.State.Running}}", container]);
    return true;
  } catch {
    // Container not running — try to start it
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
 * Execute C++ code on a warm container and return the output.
 * Uses `docker exec` with stdin to pass the code and input.
 */
export async function executeCode(
  code: string,
  input: string,
  timeoutMs: number = 3000
): Promise<{ output: string; error: string | null }> {
  const container = getContainer();
  const alive = await ensureContainer(container);
  if (!alive) {
    return { output: "", error: "Execution container not available. Is Docker running?" };
  }

  // Build the shell script that writes code + input, compiles, and runs
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

    // Check for compilation errors in output
    if (output.includes("error:") || output.includes("undefined reference")) {
      return { output, error: "compilation" };
    }

    return { output, error: errorOutput || null };
  } catch (err: any) {
    // Timeout or container error
    if (err.killed || err.signal === "SIGTERM") {
      return { output: "Execution timed out.", error: "timeout" };
    }
    const stdout = err.stdout?.toString()?.trim() || "";
    const stderr = err.stderr?.toString()?.trim() || "";
    if (stdout) return { output: stdout, error: stderr || null };
    return { output: "", error: err.message || "Execution failed" };
  }
}
