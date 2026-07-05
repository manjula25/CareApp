/** Formats age + sex the way reference-materials/caresync-ai.html's patient list does, e.g. "68F". */
export function ageSexLabel(birthDate: string, gender: string): string {
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > birth.getMonth() || (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate());
  if (!hasHadBirthdayThisYear) age -= 1;
  const sex = gender === 'female' ? 'F' : gender === 'male' ? 'M' : '';
  return `${age}${sex}`;
}

export type RiskDotColor = 'red' | 'amber' | 'violet' | 'emerald';

/** Severity-dot color bucket matching the reference mockup's `--dot` values. */
export function riskDotColor(riskScore: number): RiskDotColor {
  if (riskScore >= 80) return 'red';
  if (riskScore >= 60) return 'amber';
  if (riskScore >= 40) return 'violet';
  return 'emerald';
}

/** Tailwind classes for the severity dot, keyed by `riskDotColor`'s bucket — shared by every patient-list row. */
export const RISK_DOT_CLASS: Record<RiskDotColor, string> = {
  red: 'bg-red shadow-[0_0_8px_theme(colors.red)]',
  amber: 'bg-amber shadow-[0_0_8px_theme(colors.amber)]',
  violet: 'bg-violet shadow-[0_0_8px_theme(colors.violet)]',
  emerald: 'bg-emerald shadow-[0_0_8px_theme(colors.emerald)]',
};
