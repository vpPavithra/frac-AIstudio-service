import { randomUUID } from "node:crypto";
import type { AgentReviewer } from "../agents/agent-reviewer.js";
import { computeChecks, type OutdatedPattern } from "../engine/checks.js";
import { modelToFrac } from "../engine/convert.js";
import { parseWorkbook } from "../engine/parse-workbook.js";
import { buildReport } from "../engine/report.js";
import type { Frac, Report, ReviewModel } from "../engine/types.js";
import { readWorkbook } from "../io/workbook-reader.js";
import { buildReviewWorkbook, reviewWorkbookFilename } from "../io/workbook-writer.js";
import type { JobRunner } from "../jobs/job-runner.js";
import { JOB_MESSAGES } from "../jobs/messages.js";
import { badRequest, conflict, notFound } from "../utils/api-error.js";
import type { Repositories, ReviewContext, ReviewKind, ReviewRecord } from "../repositories/types.js";

export interface UploadedWorkbook {
  name: string;
  buffer: Buffer;
}

export interface ReviewSummary {
  id: string;
  kind: ReviewKind;
  title: string;
  cadre: string;
  state: string;
  triage: Report["triage"] | null;
  worst: "B" | "M" | "m" | null;
  fracId: string | null;
  createdAt: string;
}

/** Worst open severity in a report, for list views ("worst severity" in spec 8). */
export function worstSeverity(report: Report | null): "B" | "M" | "m" | null {
  const open = report?.findings.filter((f) => !f.fixed) ?? [];
  return (["B", "M", "m"] as const).find((sev) => open.some((f) => f.sev === sev)) ?? null;
}

const titleFromFilename = (name: string) => name.replace(/\.xlsx$/i, "").trim() || "FRAC";

/** Reviewer tab (spec 6) and the review engine shared with the Creator's expert check. */
export class ReviewService {
  constructor(
    private readonly repos: Repositories,
    private readonly runner: JobRunner,
    private readonly agent: AgentReviewer,
    private readonly outdated: () => OutdatedPattern[],
  ) {}

  /** Computed checks, then the agent, merged into one report (spec 6.3 + 6.4). */
  async review(model: ReviewModel, ctx: ReviewContext): Promise<Report> {
    const { findings, stats } = computeChecks(model, this.outdated());
    const agent = await this.agent.review({ model, computed: findings, stats, ...ctx });
    return buildReport({ title: model.title, cadre: ctx.cadre, state: ctx.state }, stats, findings, agent);
  }

  /**
   * Parses the upload before answering so a bad file fails fast with 400, then runs the review
   * as a job. The parsed model is stored with the review so it can reopen in the Creator.
   */
  async startUploadReview(ownerId: string, file: UploadedWorkbook, ctx: ReviewContext) {
    let sheets;
    try {
      sheets = await readWorkbook(file.buffer);
    } catch {
      throw badRequest("FILE_UNREADABLE", "Could not read the file. Upload an .xlsx workbook.");
    }
    const { model, warnings } = parseWorkbook(sheets, titleFromFilename(file.name));

    const review: ReviewRecord = {
      id: randomUUID(),
      ownerId,
      fracId: null,
      kind: "upload",
      sourceName: file.name,
      ctx,
      sourceModel: model,
      report: null,
      createdAt: new Date().toISOString(),
    };
    await this.repos.reviews.insert(review);

    const job = await this.runner.start(
      { ownerId, kind: "review", targetId: review.id, msg: JOB_MESSAGES.review },
      async () => {
        review.report = await this.review(model, ctx);
        await this.repos.reviews.update(review);
      },
    );
    return { reviewId: review.id, jobId: job.id, warnings };
  }

  /** Records a Creator expert check as a review too (spec gap 10); My FRACs can filter by kind. */
  async recordExpertCheck(ownerId: string, frac: Frac, model: ReviewModel, report: Report): Promise<void> {
    await this.repos.reviews.insert({
      id: randomUUID(),
      ownerId,
      fracId: frac.id,
      kind: "expert-check",
      sourceName: model.title,
      ctx: { cadre: frac.cadre, state: frac.state },
      sourceModel: model,
      report,
      createdAt: report.at,
    });
  }

  async get(ownerId: string, id: string): Promise<ReviewRecord> {
    const review = await this.repos.reviews.get(id);
    if (!review || review.ownerId !== ownerId) throw notFound("Review");
    return review;
  }

  async list(ownerId: string): Promise<ReviewSummary[]> {
    const reviews = await this.repos.reviews.listByOwner(ownerId);
    return reviews.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.report?.title ?? r.sourceModel?.title ?? r.sourceName,
      cadre: r.report?.cadre || r.ctx.cadre || "",
      state: r.report?.state || r.ctx.state || "",
      triage: r.report?.triage ?? null,
      worst: worstSeverity(r.report),
      fracId: r.fracId,
      createdAt: r.createdAt,
    }));
  }

  async exportWorkbook(ownerId: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const review = await this.get(ownerId, id);
    if (!review.report) throw conflict("REVIEW_NOT_READY", "The review is still running");
    return {
      buffer: await buildReviewWorkbook(review.report),
      filename: reviewWorkbookFilename(review.report.title),
    };
  }

  /** "Open in Create FRAC to fix" (spec 6.5): imports the reviewed file as a FRAC at step 6. */
  async openInCreator(ownerId: string, id: string): Promise<string> {
    const review = await this.get(ownerId, id);
    if (!review.sourceModel) throw badRequest("NO_SOURCE_WORKBOOK", "This review has no stored workbook to open");
    if (review.fracId && (await this.repos.fracs.get(review.fracId))) return review.fracId;

    const frac = modelToFrac({
      model: review.sourceModel,
      report: review.report,
      sourceName: review.sourceName,
      ownerId,
      id: randomUUID(),
      cadre: review.ctx.cadre,
      state: review.ctx.state,
    });
    await this.repos.fracs.insert(frac);
    await this.repos.fracs.snapshot(frac, "Imported from review");
    review.fracId = frac.id;
    await this.repos.reviews.update(review);
    return frac.id;
  }
}
