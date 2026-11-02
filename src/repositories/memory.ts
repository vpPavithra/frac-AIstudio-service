import type { Frac } from "../engine/types.js";
import type {
  FracRepository,
  FracVersion,
  Job,
  JobPatch,
  JobRepository,
  Repositories,
  ReviewRecord,
  ReviewRepository,
} from "./types.js";

// In-process stores for unit tests and for running the service locally without Postgres
// (FRAC_STUDIO_STORE=memory). Data is lost on restart.

const clone = <T>(value: T): T => structuredClone(value);
const byNewest = (a: { at: string }, b: { at: string }) => b.at.localeCompare(a.at);

export class MemoryFracRepository implements FracRepository {
  private readonly rows = new Map<string, Frac>();
  private readonly snapshots: (FracVersion & { doc: Frac })[] = [];
  private seq = 0;

  async insert(frac: Frac): Promise<void> {
    this.rows.set(frac.id, clone(frac));
  }

  async update(frac: Frac): Promise<void> {
    this.rows.set(frac.id, clone(frac));
  }

  async get(id: string): Promise<Frac | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async listByOwner(ownerId: string): Promise<Frac[]> {
    return [...this.rows.values()]
      .filter((f) => f.ownerId === ownerId)
      .map((f) => ({ f, at: f.updatedAt }))
      .sort(byNewest)
      .map(({ f }) => clone(f));
  }

  async snapshot(frac: Frac, reason: string): Promise<void> {
    this.seq++;
    this.snapshots.push({
      id: this.seq,
      fracId: frac.id,
      step: frac.step,
      reason,
      createdAt: new Date().toISOString(),
      doc: clone(frac),
    });
  }

  async versions(fracId: string): Promise<FracVersion[]> {
    return this.snapshots
      .filter((v) => v.fracId === fracId)
      .sort((a, b) => b.id - a.id)
      .map(({ doc: _doc, ...meta }) => meta);
  }

  async version(fracId: string, versionId: number): Promise<Frac | null> {
    const hit = this.snapshots.find((v) => v.fracId === fracId && v.id === versionId);
    return hit ? clone(hit.doc) : null;
  }
}

export class MemoryReviewRepository implements ReviewRepository {
  private readonly rows = new Map<string, ReviewRecord>();

  async insert(review: ReviewRecord): Promise<void> {
    this.rows.set(review.id, clone(review));
  }

  async update(review: ReviewRecord): Promise<void> {
    this.rows.set(review.id, clone(review));
  }

  async get(id: string): Promise<ReviewRecord | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async listByOwner(ownerId: string): Promise<ReviewRecord[]> {
    return [...this.rows.values()]
      .filter((r) => r.ownerId === ownerId)
      .map((r) => ({ r, at: r.createdAt }))
      .sort(byNewest)
      .map(({ r }) => clone(r));
  }
}

export class MemoryJobRepository implements JobRepository {
  private readonly rows = new Map<string, Job>();

  async insert(job: Job): Promise<void> {
    this.rows.set(job.id, clone(job));
  }

  async update(id: string, patch: JobPatch): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, ...clone(patch), updatedAt: new Date().toISOString() });
  }

  async get(id: string): Promise<Job | null> {
    const row = this.rows.get(id);
    return row ? clone(row) : null;
  }

  async failStale(before: Date, error: string, errorCode: string): Promise<number> {
    let failed = 0;
    for (const [id, row] of this.rows) {
      const inFlight = row.status === "queued" || row.status === "running";
      if (inFlight && new Date(row.updatedAt) < before) {
        this.rows.set(id, { ...row, status: "error", error, errorCode, updatedAt: new Date().toISOString() });
        failed++;
      }
    }
    return failed;
  }
}

export function memoryRepositories(): Repositories {
  return {
    fracs: new MemoryFracRepository(),
    reviews: new MemoryReviewRepository(),
    jobs: new MemoryJobRepository(),
  };
}
