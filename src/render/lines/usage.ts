import type { RenderContext } from "../../types.js";
import { isLimitReached } from "../../types.js";
import { getProviderLabel } from "../../stdin.js";
import { critical, label, dim, getQuotaColor, quotaBar, RESET } from "../colors.js";
import { getAdaptiveBarWidth } from "../../utils/terminal.js";
import { t } from "../../i18n/index.js";

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Calculate the "fair" percentage of a rate-limit window based on elapsed time.
 * If 1 hour has passed in a 5-hour window, your fair share is 20%.
 */
function calcFairPercent(resetAt: Date | null, windowMs: number): number | null {
  if (!resetAt) return null;
  const now = Date.now();
  const remainingMs = resetAt.getTime() - now;
  if (remainingMs <= 0) return 100;
  const elapsedMs = windowMs - remainingMs;
  if (elapsedMs <= 0) return 0;
  return Math.min(100, Math.round((elapsedMs / windowMs) * 100));
}

export function renderUsageLine(ctx: RenderContext): string | null {
  const display = ctx.config?.display;
  const colors = ctx.config?.colors;

  if (display?.showUsage === false) {
    return null;
  }

  if (!ctx.usageData) {
    return null;
  }

  if (getProviderLabel(ctx.stdin)) {
    return null;
  }

  const usageLabel = label(t("label.usage"), colors);

  if (isLimitReached(ctx.usageData)) {
    const resetTime =
      ctx.usageData.fiveHour === 100
        ? formatResetTime(ctx.usageData.fiveHourResetAt)
        : formatResetTime(ctx.usageData.sevenDayResetAt);
    return `${usageLabel} ${critical(`⚠ ${t("status.limitReached")}${resetTime ? ` (${t("format.resets")} ${resetTime})` : ""}`, colors)}`;
  }

  const threshold = display?.usageThreshold ?? 0;
  const fiveHour = ctx.usageData.fiveHour;
  const sevenDay = ctx.usageData.sevenDay;

  const effectiveUsage = Math.max(fiveHour ?? 0, sevenDay ?? 0);
  if (effectiveUsage < threshold) {
    return null;
  }

  const usageBarEnabled = display?.usageBarEnabled ?? true;
  const sevenDayThreshold = display?.sevenDayThreshold ?? 80;
  const barWidth = getAdaptiveBarWidth();

  if (fiveHour === null && sevenDay !== null) {
    const weeklyOnlyPart = formatUsageWindowPart({
      label: t("label.weekly"),
      percent: sevenDay,
      resetAt: ctx.usageData.sevenDayResetAt,
      colors,
      usageBarEnabled,
      barWidth,
      forceLabel: true,
    });
    return `${usageLabel} ${weeklyOnlyPart}`;
  }

  const showFairBudget = display?.showFairBudget ?? false;
  const fiveHourFair = showFairBudget
    ? calcFairPercent(ctx.usageData.fiveHourResetAt, FIVE_HOURS_MS)
    : null;

  const fiveHourPart = formatUsageWindowPart({
    label: "5h",
    percent: fiveHour,
    resetAt: ctx.usageData.fiveHourResetAt,
    colors,
    usageBarEnabled,
    barWidth,
    fairPercent: fiveHourFair,
  });

  if (sevenDay !== null && sevenDay >= sevenDayThreshold) {
    const sevenDayFair = showFairBudget
      ? calcFairPercent(ctx.usageData.sevenDayResetAt, SEVEN_DAYS_MS)
      : null;
    const sevenDayPart = formatUsageWindowPart({
      label: t("label.weekly"),
      percent: sevenDay,
      resetAt: ctx.usageData.sevenDayResetAt,
      colors,
      usageBarEnabled,
      barWidth,
      forceLabel: true,
      fairPercent: sevenDayFair,
    });
    return `${usageLabel} ${fiveHourPart} | ${sevenDayPart}`;
  }

  return `${usageLabel} ${fiveHourPart}`;
}

function formatUsagePercent(
  percent: number | null,
  colors?: RenderContext["config"]["colors"],
): string {
  if (percent === null) {
    return label("--", colors);
  }
  const color = getQuotaColor(percent, colors);
  return `${color}${percent}%${RESET}`;
}

function formatUsageWindowPart({
  label: windowLabel,
  percent,
  resetAt,
  colors,
  usageBarEnabled,
  barWidth,
  forceLabel = false,
  fairPercent = null,
}: {
  label: string;
  percent: number | null;
  resetAt: Date | null;
  colors?: RenderContext["config"]["colors"];
  usageBarEnabled: boolean;
  barWidth: number;
  forceLabel?: boolean;
  fairPercent?: number | null;
}): string {
  const usageDisplay = formatUsagePercent(percent, colors);
  const reset = formatResetTime(resetAt);
  const styledLabel = label(windowLabel, colors);

  const fairSuffix = fairPercent !== null
    ? ` ${dim(`(fair: ${fairPercent}%)`)}`
    : '';

  if (usageBarEnabled) {
    const body = reset
      ? `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay}${fairSuffix} (${t("format.resetsIn")} ${reset})`
      : `${quotaBar(percent ?? 0, barWidth, colors)} ${usageDisplay}${fairSuffix}`;
    return forceLabel ? `${styledLabel} ${body}` : body;
  }

  return reset
    ? `${styledLabel} ${usageDisplay}${fairSuffix} (${t("format.resetsIn")} ${reset})`
    : `${styledLabel} ${usageDisplay}${fairSuffix}`;
}

function formatResetTime(resetAt: Date | null): string {
  if (!resetAt) return "";
  const now = new Date();
  const diffMs = resetAt.getTime() - now.getTime();
  if (diffMs <= 0) return "";

  const diffMins = Math.ceil(diffMs / 60000);
  if (diffMins < 60) return `${diffMins}m`;

  const hours = Math.floor(diffMins / 60);
  const mins = diffMins % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    if (remHours > 0) return `${days}d ${remHours}h`;
    return `${days}d`;
  }

  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}
