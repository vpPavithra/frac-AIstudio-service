// MOCK SEED (MOCK_SEED=true, memory store only): one finished sample FRAC and one review per owner,
// built by running the real steps on the mock provider, so My FRACs is not empty. See README.md here.
import type { FracService, GenerationStep } from "../services/frac.service.ts";
import type { JobRunner } from "../services/queue/job-runner.ts";
import type { ReviewService } from "../services/review.service.ts";

const STEPS: GenerationStep[] = ["research", "roles", "competencies", "ladders"];

export interface MockSeedDeps {
  fracs: FracService;
  reviews: ReviewService;
  runner: JobRunner;
}

/** Creates an ANM / Bihar FRAC through every step plus the expert check, then reviews its own export. */
export async function seedMockData({ fracs, reviews, runner }: MockSeedDeps, owners: string[]): Promise<number> {
  for (const owner of owners) {
    const frac = await fracs.create(owner, {
      cadre: "ANM",
      state: "Bihar",
      size: "compact",
      prompt: "Sub-Centre outreach and delivery point PHC; RMNCH+A, immunisation on U-WIN, NCD screening (sample brief)",
    });
    for (const step of STEPS) {
      await fracs.startStep(owner, frac.id, step, {});
      await runner.idle();
    }
    await fracs.startCheck(owner, frac.id);
    await runner.idle();

    const file = await fracs.exportWorkbook(owner, frac.id);
    await reviews.startUploadReview(owner, { name: file.filename, buffer: file.buffer }, {
      cadre: "ANM",
      state: "Bihar",
      notes: "Sample review (mock AI data).",
    });
    await runner.idle();
  }
  return owners.length;
}
