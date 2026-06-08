import type { AnalysisResult, GameStateSnapshot } from "../shared/types.js";
import { validateCandidateLine } from "./analysis-validator.js";
import type { CardCatalog } from "./card-catalog.js";

export function salvageValidCandidates(
  result: AnalysisResult,
  snapshot: GameStateSnapshot,
  catalog: CardCatalog,
  maxCandidates: number,
  skipValidation = false,
): AnalysisResult | undefined {
  if (
    result.snapshotRevision !== snapshot.revision ||
    result.candidates.length === 0
  ) {
    return undefined;
  }

  if (skipValidation) {
    const keptCandidates = result.candidates
      .slice(0, maxCandidates)
      .map((candidate, index) => ({
        ...candidate,
        rank: index + 1,
      }));
    if (result.candidates.length > keptCandidates.length) {
      return {
        ...result,
        candidates: keptCandidates,
        warnings: [
          ...result.warnings,
          `Agent 返回路线超过上限，已只保留前 ${maxCandidates} 条可用路线。`,
        ],
      };
    }
    return {
      ...result,
      candidates: keptCandidates,
    };
  }

  const reports = result.candidates.map((candidate) => ({
    candidate,
    report: validateCandidateLine(candidate, snapshot, catalog),
  }));
  const validCandidates = reports
    .filter((entry) => entry.report.ok)
    .map((entry) => entry.candidate);
  if (validCandidates.length === 0) {
    return undefined;
  }

  const invalidReports = reports.filter((entry) => !entry.report.ok);
  const keptCandidates = validCandidates
    .slice(0, maxCandidates)
    .map((candidate, index) => ({
      ...candidate,
      rank: index + 1,
    }));
  const warningParts = [
    ...reports.flatMap((entry) => entry.report.warnings),
  ];
  if (invalidReports.length > 0) {
    warningParts.push(
      `已丢弃 ${invalidReports.length} 条未通过本地校验的路线：${invalidReports
        .map(
          (entry) =>
            `路线 ${entry.candidate.rank} ${entry.report.errors.join("；")}`,
        )
        .join("；")}`,
    );
  }
  if (validCandidates.length > keptCandidates.length) {
    warningParts.push(
      `Agent 返回路线超过上限，已只保留前 ${maxCandidates} 条可用路线。`,
    );
  }

  return {
    ...result,
    candidates: keptCandidates,
    warnings: [...result.warnings, ...warningParts],
  };
}

export function isDisplayableValidationFailure(errors: string[]): boolean {
  return (
    errors.length > 0 &&
    errors.every((error) =>
      [
        "基础费用超过当前法力",
        "基础费用高于当前法力",
        "临时法力牌后没有使用获得的法力",
        "会超过随从区容量",
      ].some((pattern) => error.includes(pattern)),
    )
  );
}
