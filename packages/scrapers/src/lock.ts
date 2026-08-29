import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
});

// Acquire lock and increment fencing token atomically if acquired
const ACQUIRE_LUA = `
  local lockKey = KEYS[1]
  local fencingKey = KEYS[2]
  local workerId = ARGV[1]
  local ttl = ARGV[2]

  local acquired = redis.call('SET', lockKey, workerId, 'NX', 'PX', ttl)
  if acquired then
    local token = redis.call('INCR', fencingKey)
    return token
  else
    return nil
  end
`;

// Heartbeat renewal: check ownership, PEXPIRE only
const HEARTBEAT_LUA = `
  local lockKey = KEYS[1]
  local workerId = ARGV[1]
  local ttl = ARGV[2]

  if redis.call('GET', lockKey) == workerId then
    return redis.call('PEXPIRE', lockKey, ttl)
  else
    return 0
  end
`;

// Release lock
const RELEASE_LUA = `
  local lockKey = KEYS[1]
  local workerId = ARGV[1]

  if redis.call('GET', lockKey) == workerId then
    return redis.call('DEL', lockKey)
  else
    return 0
  end
`;

export interface LockResult {
  fencingToken: number;
  release: () => Promise<void>;
  startHeartbeat: () => void;
  stopHeartbeat: () => void;
}

export class DistributedLock {
  private workerId = Math.random().toString(36).substring(2, 15);
  private heartbeatInterval: NodeJS.Timeout | null = null;
  
  constructor(private url: string, private ttlMs: number = 5000) {}

  private get lockKey() {
    return `lock:${this.url}`;
  }

  private get fencingKey() {
    return `fencing:${this.url}`;
  }

  /**
   * Tries to acquire the lock. Returns LockResult if successful, null otherwise.
   */
  async acquire(): Promise<LockResult | null> {
    try {
      const token = await redis.eval(
        ACQUIRE_LUA,
        2,
        this.lockKey,
        this.fencingKey,
        this.workerId,
        this.ttlMs
      );

      if (token) {
        return {
          fencingToken: Number(token),
          release: () => this.release(),
          startHeartbeat: () => this.startHeartbeat(),
          stopHeartbeat: () => this.stopHeartbeat()
        };
      }
      return null;
    } catch (e) {
      console.error('[DistributedLock] Failed to acquire lock (Redis might be down). Failing open.', e);
      // Fail-open: Return a dummy token and no-op release/heartbeat
      return {
        fencingToken: Date.now(), // Fallback monotonic-ish token for fail-open
        release: async () => {},
        startHeartbeat: () => {},
        stopHeartbeat: () => {}
      };
    }
  }

  private async release(): Promise<void> {
    this.stopHeartbeat();
    try {
      await redis.eval(RELEASE_LUA, 1, this.lockKey, this.workerId);
    } catch (e) {
      console.error('[DistributedLock] Error releasing lock:', e);
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;
    
    // Heartbeat at TTL / 3
    const intervalMs = Math.floor(this.ttlMs / 3);
    
    this.heartbeatInterval = setInterval(async () => {
      try {
        const renewed = await redis.eval(HEARTBEAT_LUA, 1, this.lockKey, this.workerId, this.ttlMs);
        if (renewed === 0) {
          console.warn(`[DistributedLock] Lost lock ownership during heartbeat for ${this.url}`);
          this.stopHeartbeat();
        }
      } catch (e) {
        console.error('[DistributedLock] Error during heartbeat:', e);
      }
    }, intervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Subscribes to the Pub/Sub channel for lock release, waits for max timeout, then resolves.
   */
  static async waitForLockRelease(url: string, timeoutMs: number = 6000): Promise<void> {
    const channel = `__keyspace@0__:lock:${url}`;
    
    return new Promise((resolve) => {
      let timeoutId: NodeJS.Timeout;
      let handled = false;
      
      const subRedis = redis.duplicate();
      
      const cleanup = () => {
        if (handled) return;
        handled = true;
        clearTimeout(timeoutId);
        subRedis.unsubscribe(channel).finally(() => subRedis.quit());
        resolve();
      };
      
      // Setup timeout
      timeoutId = setTimeout(() => {
        cleanup();
      }, timeoutMs);

      // Subscribe first
      subRedis.subscribe(channel, async (err) => {
        if (err) {
          console.error('[DistributedLock] Failed to subscribe to keyspace notifications:', err);
          cleanup();
          return;
        }
        
        // Then check if the key already expired/was deleted
        try {
          const exists = await redis.exists(`lock:${url}`);
          if (!exists) {
            cleanup();
          }
        } catch (e) {
          cleanup();
        }
      });
      
      subRedis.on('message', (ch, message) => {
        if (ch === channel && (message === 'del' || message === 'expired')) {
          cleanup();
        }
      });
    });
  }
}
