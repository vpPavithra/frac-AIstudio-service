import type { Pool } from "pg";
import { MemoryFracRepository, PgFracRepository, type FracRepository } from "./frac.repository.js";
import { MemoryJobRepository, PgJobRepository, type JobRepository } from "./job.repository.js";
import { MemoryReviewRepository, PgReviewRepository, type ReviewRepository } from "./review.repository.js";

export interface Repositories {
  fracs: FracRepository;
  reviews: ReviewRepository;
  jobs: JobRepository;
}

export function pgRepositories(pool: Pool): Repositories {
  return {
    fracs: new PgFracRepository(pool),
    reviews: new PgReviewRepository(pool),
    jobs: new PgJobRepository(pool),
  };
}

export function memoryRepositories(): Repositories {
  return {
    fracs: new MemoryFracRepository(),
    reviews: new MemoryReviewRepository(),
    jobs: new MemoryJobRepository(),
  };
}
