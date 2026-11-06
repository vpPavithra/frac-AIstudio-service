import { randomUUID } from "node:crypto";
import type { AgentReviewer } from "./ai-review.service.ts";
import { computeChecks } from "./review-engine/checks.ts";
import { modelToFrac } from "./review-engine/convert.ts";
import { ENGINE_VERSION, reviewFingerprint } from "./review-engine/fingerprint.ts";
import { parseWorkbook } from "./review-engine/parse-workbook.ts";
import { buildReport } from "./review-engine/report.ts";
import type { ReviewRules } from "./review-engine/rules.ts";
import type { Frac } from "../models/frac.model.ts";
import type { Report } from "../models/report.model.ts";
import type { ReviewContext, ReviewKind, ReviewModel, ReviewRecord } from "../models/review.model.ts";
import { readWorkbook } from "./excel/workbook-reader.ts";
import { buildReviewWorkbook, reviewWorkbookFilename } from "./excel/workbook-writer.ts";
import type { JobRunner, RecordUsage } from "./queue/job-runner.ts";
import { JOB_MESSAGES } from "./queue/job-messages.ts";
import { badRequest, conflict, notFound } from "../utils/response.ts";
import type { Repositories } from "../repositories/index.ts";
import { describeError, logger } from "../utils/logger.ts";

// The Reviewer service (spec 6, rules r3). Runs the whole review flow: upload → parse (parse-workbook.ts)
// → rule-based checks (checks.ts) → Vidya's AI checklist (ai-review.service.ts) → computed report
// (report.ts) → stored with its fingerprint (fingerprint.ts) in the reviews repository. Called by
// review.controller.ts and, for the Creator's step 6 expert check, by frac.service.ts. The rule tables
// (config/review-rules.json, config/outdated.json) come in through the `rules` loader built in server.ts.

export interface UploadedWorkbook {
  name: string;
  buffer: Buffer;
}

export interface StartedReview {
  reviewId: string;
  /** null when a stored review of the same file and context was returned (fromCache). */
  jobId: string | null;
  warnings: string[];
  /** Rules r3 §9: this file and context were reviewed before; the stored review is returned as is. */
  fromCache: boolean;
  /** When the stored review was made (fromCache only). */
  reviewedAt?: string;
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

/** "Meghalaya ANM.xlsx" → "Meghalaya ANM"; "FRAC" when the name is only the extension. */
const titleFromFilename = (name: string) => name.replace(/\.xlsx$/i, "").trim() || "FRAC";

/** Reviewer tab (spec 6) and the review engine shared with the Creator's expert check. */
export class ReviewService {
  constructor(
    private readonly repos: Repositories,
    private readonly runner: JobRunner,
    private readonly agent: AgentReviewer,
    /** Re-read per review so clinical reviewers' edits to the rule tables apply without a restart. */
    private readonly rules: () => ReviewRules,
  ) {}

  /** Rule-based checks, then the AI checklist, merged into one computed report (rules r3 §4–7). */
  async review(model: ReviewModel, ctx: ReviewContext, recordUsage?: RecordUsage): Promise<Report> {
    const rules = this.rules();
    const checks = computeChecks(model, rules, { cadre: ctx.cadre });
    const agent = await this.agent.review({ model, cadre: checks.cadre, state: ctx.state, checks, rules, recordUsage });
    return buildReport({
      title: model.title,
      cadre: checks.cadre,
      state: ctx.state,
      stats: checks.stats,
      computed: checks.findings,
      agent,
      coveredAreas: checks.coveredAreas,
      laddered: checks.laddered,
      incompleteLadders: checks.incompleteLadders,
      engine: ENGINE_VERSION,
      fingerprint: reviewFingerprint(model, ctx, rules),
    });
  }

  /** Runs the review of a stored upload as a job and replaces its report when done. */
  private async runReviewJob(ownerId: string, review: ReviewRecord, model: ReviewModel): Promise<string> {
    const job = await this.runner.start(
      { ownerId, kind: "review", targetId: review.id, msg: JOB_MESSAGES.review },
      async (_progress, recordUsage) => {
        review.report = await this.review(model, review.ctx, recordUsage);
        review.fingerprint = review.report.fingerprint ?? null;
        await this.repos.reviews.update(review);
      },
    );
    return job.id;
  }

  /**
   * Parses the upload before answering so a bad file fails fast with 400. If the same file and context
   * were reviewed before (same fingerprint, rules r3 §9) the stored review is returned unless `fresh`;
   * otherwise the review runs as a job. The parsed model is stored so it can reopen in the Creator.
   */
  async startUploadReview(ownerId: string, file: UploadedWorkbook, ctx: ReviewContext, fresh = false): Promise<StartedReview> {
    let sheets;
    try {
      sheets = await readWorkbook(file.buffer);
    } catch (err) {
      // The person sees a plain sentence; the log keeps the reason (e.g. a parser limitation)
      logger.warn("Uploaded workbook could not be read", { file: file.name, bytes: file.buffer.length, error: describeError(err) });
      throw badRequest("FILE_UNREADABLE", "Could not read the file. Upload an .xlsx workbook.");
    }
    const { model, warnings } = parseWorkbook(sheets, titleFromFilename(file.name));

    const fingerprint = reviewFingerprint(model, ctx, this.rules());
    const stored = fresh ? null : await this.repos.reviews.findByFingerprint(ownerId, fingerprint);
    if (stored?.report) {
      return { reviewId: stored.id, jobId: null, warnings, fromCache: true, reviewedAt: stored.report.at };
    }

    const review: ReviewRecord = {
      id: randomUUID(),
      ownerId,
      fracId: null,
      kind: "upload",
      sourceName: file.name,
      ctx,
      sourceModel: model,
      report: null,
      fingerprint: null,
      createdAt: new Date().toISOString(),
    };
    await this.repos.reviews.insert(review);
    return { reviewId: review.id, jobId: await this.runReviewJob(ownerId, review, model), warnings, fromCache: false };
  }

  /** "Run a fresh review" (rules r3 §9): asks the model again and replaces the stored report. */
  async rerun(ownerId: string, id: string): Promise<StartedReview> {
    const review = await this.get(ownerId, id);
    if (!review.sourceModel) throw badRequest("NO_SOURCE_WORKBOOK", "This review has no stored workbook to review again");
    if (review.kind !== "upload") throw badRequest("NOT_AN_UPLOAD", "Run the expert check again from the FRAC instead");
    return { reviewId: review.id, jobId: await this.runReviewJob(ownerId, review, review.sourceModel), warnings: [], fromCache: false };
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
      fingerprint: report.fingerprint ?? null,
      createdAt: report.at,
    });
  }

  /** One review, only for its owner; another owner's id reads as 404 so ids cannot be probed. */
  async get(ownerId: string, id: string): Promise<ReviewRecord> {
    const review = await this.repos.reviews.get(id);
    if (!review || review.ownerId !== ownerId) throw notFound("Review");
    return review;
  }

  /** The owner's reviews for My FRACs, uploads and expert checks alike (filter by `kind`). */
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

  /** The finished report as an .xlsx (spec 7); 409 while the review job is still running. */
  async exportWorkbook(ownerId: string, id: string): Promise<{ buffer: Buffer; filename: string }> {
    const review = await this.get(ownerId, id);
    if (!review.report) throw conflict("REVIEW_NOT_READY", "The review is still running");
    return {
      buffer: await buildReviewWorkbook(review.report),
      filename: reviewWorkbookFilename(review.report.title),
    };
  }

  /**
   * "Open in Create FRAC to fix" (spec 6.5): imports the reviewed file as a FRAC at step 6. Opening the same
   * review again returns the FRAC made the first time, while that FRAC still exists.
   */
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
