import { PrismaClient } from '@prisma/client';
import { ProblemCachePort } from './registry';
import { ScrapedProblem, ScrapedProblemSchema, ScraperError } from './types';

// Ideally this prisma client instance should be passed in from the apps/web container
// But for separation, we can accept it in the constructor
export class ProblemScraperService implements ProblemCachePort {
  constructor(private prisma: PrismaClient) {}

  async findByUrl(url: string, maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<ScrapedProblem | null> {
    const problem = await this.prisma.problem.findFirst({
      where: { url }
    });

    if (!problem) return null;

    const age = Date.now() - problem.updatedAt.getTime();
    if (age > maxAgeMs) {
      return null;
    }

    try {
      // Parse DB JSON and ensure it strictly matches the schema
      const parsed = JSON.parse(problem.data);
      const validated = ScrapedProblemSchema.parse(parsed);

      // Skip cache if the problem statement is empty (stale bad scrape from before Cloudflare fix)
      if (!validated.content?.problemStatementMarkdown || validated.content.problemStatementMarkdown.trim().length < 20) {
        return null;
      }

      // Skip cache if examples are missing (stale scrape from before example extraction fix)
      if (!validated.examples || validated.examples.length === 0) {
        return null;
      }

      // NOTE: Do NOT skip cache for missing editorial — many problems legitimately don't have one.
      // The editorial will be fetched fresh on the next scrape if available.

      return validated;
    } catch (e) {
      console.warn(`[ProblemScraperService] Cache validation failed for ${url}`, e);
      return null;
    }
  }

  async saveProblem(platform: string, url: string, problem: ScrapedProblem, fencingToken: number): Promise<void> {
    const data = JSON.stringify(problem);
    
    // We use Prisma's updateMany for atomic updates where fencing_token < incoming_token
    // If it's a new row, we use create. We can use an upsert but upsert doesn't allow conditional updates.
    // So we try updateMany with the condition, if count is 0, we check if it exists.
    // If it doesn't exist, we create it.
    
    const existing = await this.prisma.problem.findFirst({
      where: { platform, url }
    });

    if (!existing) {
      try {
        await this.prisma.problem.create({
          data: {
            platform,
            url,
            data,
            fencing_token: BigInt(fencingToken)
          }
        });
        return;
      } catch (e) {
        // Unique constraint violation means another worker just inserted it
        // We fall through to update logic
      }
    }

    // Attempt atomic update
    const result = await this.prisma.problem.updateMany({
      where: {
        platform,
        url,
        fencing_token: {
          lt: BigInt(fencingToken)
        }
      },
      data: {
        data,
        fencing_token: BigInt(fencingToken)
      }
    });

    if (result.count === 0) {
      // Meaning the token in the DB is >= our fencingToken.
      // This means we lost the race and another worker succeeded with a newer token.
      throw {
        type: 'FencingTokenLostError',
        message: 'Lost update race condition (fencing token check failed).',
        canonicalData: problem
      } as ScraperError;
    }
  }
}
