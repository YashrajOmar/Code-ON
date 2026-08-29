import { Worker, Job } from "bullmq";
import IORedis from "ioredis";
import { spawn, exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const redisConnection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });

class ExecutionWorkerNode {
  private warmPool: string[] = [];
  private poolSize = 5;

  constructor() {
    this.initializePool().then(() => {
      this.startWorker();
    });
  }

  private async initializePool() {
    console.log(`[Worker Node] Booting ${this.poolSize} warm containers...`);
    for (let i = 0; i < this.poolSize; i++) {
      const containerId = await this.spawnContainer();
      this.warmPool.push(containerId);
    }
    console.log(`[Worker Node] ${this.poolSize} warm containers ready.`);
  }

  private async spawnContainer(): Promise<string> {
    const { stdout } = await execAsync(
      `docker run -d --rm --network none --memory 256m --pids-limit 64 codeon-cpp-runner`
    );
    return stdout.trim();
  }

  private startWorker() {
    new Worker(
      "code-execution",
      async (job: Job) => {
        return await this.processJob(job.data.code, job.data.input);
      },
      {
        connection: redisConnection,
        concurrency: this.poolSize,
      }
    );
    console.log(`[Worker Node] Listening for jobs on code-execution...`);
  }

  private async processJob(code: string, input: string): Promise<string> {
    const containerId = this.warmPool.pop()!;

    return new Promise((resolve, reject) => {
      const ac = new AbortController();
      const timeoutId = setTimeout(() => {
        ac.abort();
        resolve("Execution Error: Hard Timeout Exceeded (Docker unresponsiveness).");
      }, 3000); // 3 second hard limit

      const dockerProcess = spawn(
        "docker",
        ["exec", "-i", "-u", "runner", containerId, "sh"],
        { signal: ac.signal }
      );

      let output = "";
      let errorOutput = "";

      dockerProcess.stdout.on("data", (data) => (output += data.toString()));
      dockerProcess.stderr.on("data", (data) => (errorOutput += data.toString()));

      dockerProcess.on("close", async () => {
        clearTimeout(timeoutId);

        execAsync(`docker kill ${containerId}`).catch(() => {});
        const newId = await this.spawnContainer();
        this.warmPool.push(newId);

        if (errorOutput.trim()) {
          resolve(`Execution Error:\n${errorOutput}`);
        } else {
          resolve(output);
        }
      });

      const payloadScript = `
        cat << 'EOF_CODE' > main.cpp
${code}
EOF_CODE

        cat << 'EOF_INPUT' > input.txt
${input}
EOF_INPUT

        g++ -O3 main.cpp && timeout 2s ./a.out < input.txt
      `;

      dockerProcess.stdin.write(payloadScript);
      dockerProcess.stdin.end();
    });
  }
}

new ExecutionWorkerNode();
