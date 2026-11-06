// Builds the three repositories for one store. server.ts picks pgRepositories when Postgres is in use
// and memoryRepositories for FRAC_STUDIO_STORE=memory; tests use the memory set.
import type { Pool } from "pg";
import { MemoryFracRepository, PgFracRepository, type FracRepository } from "./frac.repository.ts";
import { MemoryJobRepository, PgJobRepository, type JobRepository } from "./job.repository.ts";
import { MemoryReviewRepository, PgReviewRepository, type ReviewRepository } from "./review.repository.ts";

/** One repository per entity, passed to the services as a bundle. */
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
