// Builds the repositories for one store. server.ts picks pgRepositories when Postgres is in use
// and memoryRepositories for FRAC_STUDIO_STORE=memory; tests use the memory set.
import type { Pool } from "pg";
import { MemoryDocumentRepository, PgDocumentRepository, type DocumentRepository } from "./document.repository.ts";
import { MemoryAiCallRepository, PgAiCallRepository, type AiCallRepository } from "./ai-call.repository.ts";
import { MemoryFracRepository, PgFracRepository, type FracRepository } from "./frac.repository.ts";
import { MemoryJobRepository, PgJobRepository, type JobRepository } from "./job.repository.ts";
import { MemoryReviewAnswerCacheRepository, PgReviewAnswerCacheRepository, type ReviewAnswerCacheRepository } from "./review-answer-cache.repository.ts";
import { MemoryReviewRepository, PgReviewRepository, type ReviewRepository } from "./review.repository.ts";
import { MemoryServerRunRepository, PgServerRunRepository, type ServerRunRepository } from "./server-run.repository.ts";

/** One repository per entity, passed to the services as a bundle. */
export interface Repositories {
  fracs: FracRepository;
  reviews: ReviewRepository;
  jobs: JobRepository;
  /** The per-call AI log, for the AI response report. */
  aiCalls: AiCallRepository;
  /** Server starts and stops, for the per-run report. */
  serverRuns: ServerRunRepository;
  /** Stored AI checklist answers, so a repeat check skips unchanged competencies. */
  reviewAnswers: ReviewAnswerCacheRepository;
  /** Documents attached to a FRAC: brief text for research, and standard sheet imports. */
  documents: DocumentRepository;
}

export function pgRepositories(pool: Pool): Repositories {
  return {
    fracs: new PgFracRepository(pool),
    reviews: new PgReviewRepository(pool),
    jobs: new PgJobRepository(pool),
    aiCalls: new PgAiCallRepository(pool),
    serverRuns: new PgServerRunRepository(pool),
    reviewAnswers: new PgReviewAnswerCacheRepository(pool),
    documents: new PgDocumentRepository(pool),
  };
}

export function memoryRepositories(): Repositories {
  return {
    fracs: new MemoryFracRepository(),
    reviews: new MemoryReviewRepository(),
    jobs: new MemoryJobRepository(),
    aiCalls: new MemoryAiCallRepository(),
    serverRuns: new MemoryServerRunRepository(),
    reviewAnswers: new MemoryReviewAnswerCacheRepository(),
    documents: new MemoryDocumentRepository(),
  };
}
