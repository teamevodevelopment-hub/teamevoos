// Paystub Verifier: what Claude reads off a pay stub, and the income maths we do on top of it.
// Claude only reads the stub. Every number we work out (hourly, yearly, time at the job, checks)
// is computed here, so the maths is exact and the same every time.

export type Frequency = "weekly" | "biweekly" | "semi_monthly" | "monthly" | "unknown";
export type PayType = "hourly" | "salary" | "commission" | "mixed" | "unknown";

export interface Line {
  label: string;
  hours: number | null;
  rate: number | null;
  amount: number | null;
  ytd: number | null;
}

/** Exactly what Claude reads off the stub. null means "not shown on the stub". */
export interface StubRead {
  /** Which uploaded files (1 = first) make up this stub. */
  files: number[];
  is_pay_stub: boolean;
  problem: string | null;
  employee_name: string | null;
  employee_address: string | null;
  employer_name: string | null;
  employer_address: string | null;
  employer_phone: string | null;
  job_title: string | null;
  employee_id: string | null;
  pay_date: string | null;
  period_start: string | null;
  period_end: string | null;
  pay_frequency: Frequency;
  pay_type: PayType;
  hire_date: string | null;
  hourly_rate: number | null;
  annual_salary: number | null;
  hours_this_period: number | null;
  gross_pay: number | null;
  total_deductions: number | null;
  net_pay: number | null;
  ytd_gross: number | null;
  ytd_net: number | null;
  ytd_hours: number | null;
  currency: string | null;
  province: string | null;
  earnings: Line[];
  deductions: Line[];
  notes: string[];
  concerns: string[];
  confidence: "high" | "medium" | "low";
}

// Claude's answer format allows at most 16 "value or blank" (union) fields, so nothing here is nullable:
// every value Claude can't find comes back as an empty string "", and toUpload() below turns those into null.
// Numbers come back as text too ("2847.00"), which also lets us tidy up "$2,847.00" or "2 847,00".
const text = { type: "string" };
const line = {
  type: "object",
  additionalProperties: false,
  required: ["label", "hours", "rate", "amount", "ytd"],
  properties: { label: text, hours: text, rate: text, amount: text, ytd: text },
};

const TEXT_FIELDS = ["problem", "employee_name", "employee_address", "employer_name", "employer_address", "employer_phone", "job_title", "employee_id", "currency", "province"] as const;
const DATE_FIELDS = ["pay_date", "period_start", "period_end", "hire_date"] as const;
const NUMBER_FIELDS = ["hourly_rate", "annual_salary", "hours_this_period", "gross_pay", "total_deductions", "net_pay", "ytd_gross", "ytd_net", "ytd_hours"] as const;

/** JSON schema for one stub in Claude's answer. */
export const STUB_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["files", "is_pay_stub", ...TEXT_FIELDS, ...DATE_FIELDS, ...NUMBER_FIELDS, "pay_frequency", "pay_type", "earnings", "deductions", "notes", "concerns", "confidence"],
  properties: {
    files: { type: "array", items: { type: "integer" } },
    is_pay_stub: { type: "boolean" },
    ...Object.fromEntries(TEXT_FIELDS.map((k) => [k, text])),
    ...Object.fromEntries(DATE_FIELDS.map((k) => [k, text])),
    ...Object.fromEntries(NUMBER_FIELDS.map((k) => [k, text])),
    pay_frequency: { type: "string", enum: ["weekly", "biweekly", "semi_monthly", "monthly", "unknown"] },
    pay_type: { type: "string", enum: ["hourly", "salary", "commission", "mixed", "unknown"] },
    earnings: { type: "array", items: line },
    deductions: { type: "array", items: line },
    notes: { type: "array", items: text },
    concerns: { type: "array", items: text },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
};

/** Everything Claude reads from one upload: one or more stubs, and how they compare. */
export interface UploadRead {
  stubs: StubRead[];
  /** Differences Claude sees between the stubs (layout, fonts, logos, names, numbers). */
  cross_concerns: string[];
  problem: string | null;
}

export const UPLOAD_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stubs", "cross_concerns", "problem"],
  properties: {
    stubs: { type: "array", items: STUB_SCHEMA },
    cross_concerns: { type: "array", items: text },
    problem: text,
  },
};

/** "$2,847.00", "2 847,00 $", "35.5875" → number. Blank or unreadable → null. */
export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let t = v.replace(/[$\s\u00a0\u202f]/g, "").replace(/^\((.*)\)$/, "-$1");
  if (!t) return null;
  // French style "2847,00" or "1.234,56": the last comma is the decimal point.
  if (/,\d{1,4}$/.test(t) && !/\.\d+$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const toText = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const toDate = (v: unknown) => {
  const t = toText(v);
  return t && /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
};
const list = (v: unknown) => (Array.isArray(v) ? v : []);
const texts = (v: unknown) => list(v).map(toText).filter((t): t is string => !!t);
const toLine = (v: unknown): Line => {
  const o = (v ?? {}) as Record<string, unknown>;
  return { label: toText(o.label) ?? "Item", hours: toNumber(o.hours), rate: toNumber(o.rate), amount: toNumber(o.amount), ytd: toNumber(o.ytd) };
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(v as T) ? (v as T) : fallback);

/** Claude's raw answer (all text) → typed stubs with real numbers, dates and nulls. */
export function toUpload(raw: unknown): UploadRead {
  const o = (raw ?? {}) as Record<string, unknown>;
  const stubs = list(o.stubs).map((x): StubRead => {
    const r = (x ?? {}) as Record<string, unknown>;
    const out: Record<string, unknown> = {
      files: list(r.files).filter((n): n is number => typeof n === "number"),
      is_pay_stub: r.is_pay_stub !== false,
      pay_frequency: oneOf(r.pay_frequency, ["weekly", "biweekly", "semi_monthly", "monthly", "unknown"] as const, "unknown"),
      pay_type: oneOf(r.pay_type, ["hourly", "salary", "commission", "mixed", "unknown"] as const, "unknown"),
      earnings: list(r.earnings).map(toLine),
      deductions: list(r.deductions).map(toLine),
      notes: texts(r.notes),
      concerns: texts(r.concerns),
      confidence: oneOf(r.confidence, ["high", "medium", "low"] as const, "medium"),
    };
    for (const k of TEXT_FIELDS) out[k] = toText(r[k]);
    for (const k of DATE_FIELDS) out[k] = toDate(r[k]);
    for (const k of NUMBER_FIELDS) out[k] = toNumber(r[k]);
    return out as unknown as StubRead;
  });
  return { stubs, cross_concerns: texts(o.cross_concerns), problem: toText(o.problem) };
}

export const STUB_PROMPT = `You read pay stubs (English or French) for a Canadian car-finance dealership. A sales agent uploaded the numbered files attached. Lenders will rely on what you read, so copy values exactly as printed.

The files can be one pay stub (maybe over several pages or photos), or several different pay stubs for the same person (lenders often want the last 2 or 3). Work out which files belong together:
- Give one entry in stubs per pay stub (per pay date), and list its file numbers in files. Pages of the same stub go in one entry. A PDF can hold several stubs; then several entries share that file number.
- If the same stub was uploaded twice, give it once and mention it in cross_concerns.
- Order stubs from oldest to newest pay date.

When there are two or more stubs, compare them and put anything inconsistent in cross_concerns, e.g. different employer name, address or logo; different employee name, address or ID; layout, fonts, colours or alignment that change between stubs from the same payroll; deduction lines that appear or disappear; rate or hours that jump without explanation; a stub that looks pasted-together or edited compared with the others. Describe what you see; don't accuse anyone. Empty if they look consistent, or if there's only one stub. Keep each stub's own concerns in that stub's concerns.

If no file is a pay stub, return an empty stubs list and explain in problem; otherwise problem is "". Use "" for any text field you have nothing for.

Rules for each stub:
- Fill every field from the stub only. If something isn't printed, use an empty string "". Never guess a value and never do maths to fill a field (we calculate income ourselves).
- Dates as YYYY-MM-DD. Money, rates and hours as plain numbers written as text ("2847.00", "35.5875", "80"), with no $ sign, spaces or thousands separators. Use "" when a line has no value in that column.
- hourly_rate: the regular hourly rate if printed. annual_salary: only if a yearly salary is printed.
- hours_this_period: regular plus overtime hours worked this period, if printed.
- hire_date: only if the stub prints a hire, start, seniority or service date.
- pay_frequency: from a printed label, or from the pay period dates (7 days = weekly, 14 = biweekly, about 15 = semi_monthly, a month = monthly). Otherwise unknown.
- Taxable benefits (e.g. LIFE-TB, group life) are not cash: don't list them as earnings or deductions, and don't count them in gross; mention them in notes.
- earnings: every earnings line (regular, overtime, vacation, stat holiday, bonus, commission, etc). deductions: every deduction line (income tax, CPP, EI, QPP, union dues, benefits, pension, etc).
- notes: short plain-English facts an agent should know, e.g. "Overtime is 18% of this cheque", "Includes $400 one-time bonus", "Vacation pay is paid on each cheque".
- concerns: anything that looks off or worth double-checking, e.g. missing employer address, numbers that don't add up, YTD lower than this period, edited-looking text, mismatched fonts, blurry or cut-off parts, no CPP/EI taken, stub looks like a template. Empty if nothing stands out. Don't accuse anyone of fraud; describe what you see.
- Stubs can be in English or French (Quebec and other French employers). Read both equally well, and write notes, concerns and problem in English. Keep earnings and deduction labels as printed, and for French labels add the English in brackets, e.g. "Temps supplémentaire (Overtime)", "RRQ (QPP)", "AE (EI)", "RQAP (QPIP)", "Impôt provincial (Provincial tax)".
- French terms: salaire brut = gross pay, salaire net / net à payer = net pay, retenues / déductions = deductions, cumulatif / cumul annuel / depuis le début de l'année = YTD, taux horaire = hourly rate, heures régulières / normales = regular hours, période de paie = pay period, date de paie / de paiement / de dépôt = pay date, date d'embauche / d'entrée en service / d'ancienneté = hire date, aux deux semaines = biweekly, bimensuel = semi_monthly (twice a month), hebdomadaire = weekly, mensuel = monthly, poste / titre d'emploi = job title, employeur = employer.
- French amounts use a comma for decimals and spaces between thousands ("1 234,56 $" is 1234.56). Convert them.
- Dates may be written as words ("15 octobre 2026"), YYYY-MM-DD, or DD/MM/YYYY vs MM/DD/YYYY. Use the pay period length and the order of the dates to tell which; if you still can't be sure, give your best reading and say so in concerns.
- If a file is not a pay stub (or unreadable), include it as an entry with is_pay_stub false and explain briefly in problem. problem is "" for a normal pay stub.
- confidence: how sure you are that the key numbers (gross, net, rate, hours, dates) were read correctly.`;

/* ---------------- Maths ---------------- */

export const FULL_TIME_HOURS = 40;
const WEEKS = 52;
export const PERIODS: Record<Exclude<Frequency, "unknown">, number> = { weekly: 52, biweekly: 26, semi_monthly: 24, monthly: 12 };
export const FREQ_LABEL: Record<Frequency, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  semi_monthly: "Twice a month",
  monthly: "Monthly",
  unknown: "Not sure",
};

const DAY = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

export function parseDate(s: string | null | undefined): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Frequency from the label, or failing that from the length of the pay period. */
export function frequencyOf(r: Pick<StubRead, "pay_frequency" | "period_start" | "period_end">): Frequency {
  if (r.pay_frequency !== "unknown") return r.pay_frequency;
  const a = parseDate(r.period_start);
  const b = parseDate(r.period_end);
  if (!a || !b) return "unknown";
  const days = Math.round((b.getTime() - a.getTime()) / DAY) + 1;
  if (days >= 6 && days <= 8) return "weekly";
  if (days >= 13 && days <= 14) return "biweekly";
  if (days >= 15 && days <= 16) return "semi_monthly";
  if (days >= 28 && days <= 31) return "monthly";
  return "unknown";
}

/** "2 years 4 months" between two dates. */
export function span(from: Date, to: Date): { months: number; text: string } {
  let months = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months--;
  months = Math.max(0, months);
  const y = Math.floor(months / 12);
  const m = months % 12;
  const parts = [y ? `${y} year${y === 1 ? "" : "s"}` : "", m ? `${m} month${m === 1 ? "" : "s"}` : ""].filter(Boolean);
  return { months, text: parts.length ? parts.join(" ") : "Less than a month" };
}

export type CheckState = "ok" | "warn" | "info";
export interface Check {
  state: CheckState;
  text: string;
}

export interface Analysis {
  read: StubRead;
  frequency: Frequency;
  periodsPerYear: number | null;
  /** Best hourly figure, and how we got it. */
  hourly: number | null;
  hourlyHow: string | null;
  /** Hourly × 40 × 52. */
  annual40: number | null;
  monthly40: number | null;
  weekly40: number | null;
  /** This cheque's gross × pay periods per year. */
  annualFromStub: number | null;
  /** Year-to-date gross stretched to a full year. */
  annualFromYtd: number | null;
  /** Average weekly hours on this stub. */
  hoursPerWeek: number | null;
  tenure: { text: string; months: number; since: string; how: "hire_date" | "estimate" } | null;
  tenureNote: string;
  stubAgeDays: number | null;
  checks: Check[];
}

export function analyse(read: StubRead, today = new Date()): Analysis {
  const frequency = frequencyOf(read);
  const periodsPerYear = frequency === "unknown" ? null : PERIODS[frequency];
  const weeksPerPeriod = periodsPerYear ? WEEKS / periodsPerYear : null;
  const payDay = parseDate(read.pay_date) ?? parseDate(read.period_end);

  // Regular-pay line, if Claude found one.
  const regular = read.earnings.find((e) => /\b(regular|reg|base|straight|r[ée]guli[eè]re?s?|normales?|salaire de base)\b/i.test(e.label) && e.hours && e.amount);

  // Hourly: printed rate first, then regular pay ÷ regular hours, then salary, then gross ÷ hours.
  let hourly: number | null = null;
  let hourlyHow: string | null = null;
  if (read.hourly_rate && read.hourly_rate > 0) {
    hourly = read.hourly_rate;
    hourlyHow = "Printed on the stub";
  } else if (regular?.rate && regular.rate > 0) {
    hourly = regular.rate;
    hourlyHow = `Rate on the "${regular.label}" line`;
  } else if (regular?.hours && regular.amount) {
    hourly = regular.amount / regular.hours;
    hourlyHow = `${regular.label} pay ÷ hours`;
  } else if (read.annual_salary && read.annual_salary > 0) {
    hourly = read.annual_salary / (FULL_TIME_HOURS * WEEKS);
    hourlyHow = "Yearly salary ÷ 2,080 hours";
  } else if (read.gross_pay && read.hours_this_period && read.hours_this_period > 0) {
    hourly = read.gross_pay / read.hours_this_period;
    hourlyHow = "Gross pay ÷ hours (includes any overtime or extras)";
  } else if (read.gross_pay && weeksPerPeriod) {
    hourly = read.gross_pay / (weeksPerPeriod * FULL_TIME_HOURS);
    hourlyHow = `Gross pay ÷ ${weeksPerPeriod * FULL_TIME_HOURS} hours (assumes 40 h a week; no hours on the stub)`;
  }
  // Keep the rate as exact as printed (e.g. 35.5875) so the yearly figure is exact; it shows rounded to cents.
  hourly = hourly ? Math.round(hourly * 10000) / 10000 : null;

  const annual40 = hourly ? round2(hourly * FULL_TIME_HOURS * WEEKS) : null;
  const annualFromStub = read.gross_pay && periodsPerYear ? round2(read.gross_pay * periodsPerYear) : null;

  const hoursPerWeek = read.hours_this_period && weeksPerPeriod ? round2(read.hours_this_period / weeksPerPeriod) : null;

  // Time at the job.
  let tenure: Analysis["tenure"] = null;
  let tenureNote = "";
  const hired = parseDate(read.hire_date);
  const asOf = today;
  if (hired) {
    const s = span(hired, asOf);
    tenure = { ...s, since: read.hire_date!, how: "hire_date" };
    tenureNote = "From the hire date printed on the stub.";
  } else if (read.ytd_gross && read.gross_pay && periodsPerYear && payDay) {
    // How many cheques the YTD covers, compared with how many there have been since January.
    const chequesInYtd = read.ytd_gross / read.gross_pay;
    const jan1 = Date.UTC(payDay.getUTCFullYear(), 0, 1);
    const elapsed = ((payDay.getTime() - jan1) / DAY / 365) * periodsPerYear + 1;
    if (chequesInYtd < elapsed - 1.5) {
      const start = new Date(payDay.getTime() - (chequesInYtd - 1) * (365 / periodsPerYear) * DAY);
      const s = span(start, asOf);
      tenure = { ...s, since: start.toISOString().slice(0, 10), how: "estimate" };
      tenureNote = `No hire date on the stub. Year-to-date pay covers only about ${Math.round(chequesInYtd)} of ${Math.round(elapsed)} cheques this year, so they probably started around ${start.toLocaleDateString("en-CA", { month: "long", year: "numeric", timeZone: "UTC" })}. Confirm with the customer or a job letter.`;
    } else {
      tenureNote = `No hire date on the stub. Year-to-date pay covers the whole year, so they've worked there since at least January ${payDay.getUTCFullYear()}. Ask how long in total, or get a job letter.`;
    }
  } else {
    tenureNote = "No hire date on the stub. Ask the customer or get a job letter.";
  }

  // Year-to-date pay stretched to a full year. Counts from January, or from when they started if that was this year.
  let annualFromYtd: number | null = null;
  if (read.ytd_gross && payDay) {
    let from = Date.UTC(payDay.getUTCFullYear(), 0, 1);
    if (tenure) {
      const since = parseDate(tenure.since)!.getTime();
      // An estimated start is their first pay date; the work for it began one pay period earlier.
      const began = tenure.how === "estimate" && periodsPerYear ? since - (365 / periodsPerYear) * DAY : since;
      from = Math.max(from, began);
    }
    const days = (payDay.getTime() - from) / DAY + 1;
    // Under about 6 weeks, one cheque skews it badly.
    if (days >= 45) annualFromYtd = round2((read.ytd_gross / days) * 365);
  }

  const checks: Check[] = [];
  const money = (n: number) => `$${n.toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  if (read.gross_pay != null && read.net_pay != null) {
    const ded = read.total_deductions ?? read.deductions.reduce((t, d) => t + (d.amount ?? 0), 0);
    const diff = Math.abs(read.gross_pay - ded - read.net_pay);
    checks.push(
      diff <= 1
        ? { state: "ok", text: "Gross minus deductions equals net pay." }
        : { state: "warn", text: `Gross minus deductions is ${money(read.gross_pay - ded)}, but net pay shows ${money(read.net_pay)} (off by ${money(diff)}).` },
    );
  }
  const earned = read.earnings.filter((e) => e.amount != null);
  if (read.gross_pay != null && earned.length) {
    const sum = earned.reduce((t, e) => t + (e.amount ?? 0), 0);
    const diff = Math.abs(sum - read.gross_pay);
    checks.push(
      diff <= 1
        ? { state: "ok", text: "Earnings lines add up to gross pay." }
        : { state: "warn", text: `Earnings lines add up to ${money(sum)}, but gross pay shows ${money(read.gross_pay)}.` },
    );
  }
  const badLine = read.earnings.find((e) => e.hours && e.rate && e.amount && Math.abs(e.hours * e.rate - e.amount) > 1);
  if (badLine) checks.push({ state: "warn", text: `"${badLine.label}": ${badLine.hours} h × ${money(badLine.rate!)} isn't ${money(badLine.amount!)}.` });
  else if (read.earnings.some((e) => e.hours && e.rate && e.amount)) checks.push({ state: "ok", text: "Hours × rate matches each earnings line." });

  if (read.ytd_gross != null && read.gross_pay != null && read.ytd_gross + 1 < read.gross_pay)
    checks.push({ state: "warn", text: "Year-to-date gross is lower than this cheque's gross." });

  const hasCpp = read.deductions.some((d) => /\b(cpp|qpp|rrq|pension plan|r[ée]gime de rentes)\b/i.test(d.label));
  const hasEi = read.deductions.some((d) => /\b(ei|ae|employment ins|assurance[- ]emploi|qpip|rqap)\b/i.test(d.label));
  const hasTax = read.deductions.some((d) => /tax|imp[oô]t/i.test(d.label));
  if (read.deductions.length) {
    const missing = [!hasTax && "income tax", !hasCpp && "CPP/QPP", !hasEi && "EI"].filter(Boolean);
    checks.push(
      missing.length
        ? { state: "warn", text: `No ${missing.join(", ")} taken off. Normal Canadian payroll deducts all three (CPP can stop late in the year once maxed).` }
        : { state: "ok", text: "Income tax, CPP/QPP and EI are all deducted, like normal payroll." },
    );
  }

  const ps = parseDate(read.period_start);
  const pe = parseDate(read.period_end);
  if (ps && pe && pe < ps) checks.push({ state: "warn", text: "Pay period ends before it starts." });
  if (pe && payDay && payDay.getTime() < pe.getTime() - DAY) checks.push({ state: "warn", text: "Pay date is before the end of the pay period." });

  let stubAgeDays: number | null = null;
  if (payDay) {
    stubAgeDays = Math.floor((today.getTime() - payDay.getTime()) / DAY);
    if (stubAgeDays < -7) checks.push({ state: "warn", text: `Pay date is in the future (${read.pay_date ?? read.period_end}).` });
    else if (stubAgeDays > 45) checks.push({ state: "warn", text: `Stub is ${stubAgeDays} days old. Most lenders want one from the last 30 days.` });
    else checks.push({ state: "ok", text: stubAgeDays <= 0 ? "Stub is current." : `Stub is recent (${stubAgeDays} day${stubAgeDays === 1 ? "" : "s"} old).` });
  }

  if (!read.employer_address || !read.employer_name) checks.push({ state: "info", text: "Employer name or address isn't on the stub. Lenders may ask for it." });
  if (hoursPerWeek != null && hoursPerWeek < 30) checks.push({ state: "info", text: `About ${hoursPerWeek} hours a week on this stub, so likely part-time. The 40-hour figure may overstate income.` });
  if (annual40 && annualFromYtd && Math.abs(annualFromYtd - annual40) / annual40 > 0.2)
    checks.push({
      state: "info",
      text: `Year-to-date pace (${money(annualFromYtd)}/yr) is ${annualFromYtd > annual40 ? "higher" : "lower"} than the 40-hour figure. ${annualFromYtd > annual40 ? "Overtime or bonuses" : "Fewer hours, unpaid time off, or a later start"} may explain it.`,
    });

  return { read, frequency, periodsPerYear, hourly, hourlyHow, annual40, monthly40: annual40 ? round2(annual40 / 12) : null, weekly40: hourly ? round2(hourly * FULL_TIME_HOURS) : null, annualFromStub, annualFromYtd, hoursPerWeek, tenure, tenureNote, stubAgeDays, checks };
}

export const cad = (n: number | null | undefined, cents = true) =>
  n == null ? "—" : `$${n.toLocaleString("en-CA", { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 })}`;

/** Plain-text summary to paste into a deal chat or a lender note. */
export function summaryText(a: Analysis): string {
  const r = a.read;
  const rows = [
    `Paystub check${r.employee_name ? `: ${r.employee_name}` : ""}`,
    r.employer_name && `Employer: ${r.employer_name}${r.job_title ? ` (${r.job_title})` : ""}`,
    `Time at job: ${a.tenure ? `${a.tenure.text}${a.tenure.how === "estimate" ? " (estimated)" : ""}` : "not on stub"}`,
    `Pay: ${FREQ_LABEL[a.frequency]}${r.pay_type !== "unknown" ? `, ${r.pay_type}` : ""}`,
    a.hourly != null && `Hourly: ${cad(a.hourly)}`,
    a.annual40 != null && `Yearly at 40 h/week: ${cad(a.annual40, false)} (${cad(a.monthly40, false)}/month)`,
    a.annualFromStub != null && `Yearly from this cheque: ${cad(a.annualFromStub, false)}`,
    a.annualFromYtd != null && `Yearly at YTD pace: ${cad(a.annualFromYtd, false)}`,
    r.gross_pay != null && `This cheque: gross ${cad(r.gross_pay)}, net ${cad(r.net_pay)}`,
    r.pay_date && `Pay date: ${r.pay_date}`,
    ...a.checks.filter((c) => c.state === "warn").map((c) => `⚠ ${c.text}`),
    ...r.concerns.map((c) => `⚠ ${c}`),
  ];
  return rows.filter(Boolean).join("\n");
}

/* ---------------- Several stubs ---------------- */

/** One upload's result: each stub on its own (newest first), plus how they compare. */
export interface Report {
  stubs: Analysis[];
  cross: Cross | null;
}

export interface Cross {
  count: number;
  /** Oldest and newest pay dates covered. */
  from: string | null;
  to: string | null;
  avgGross: number | null;
  avgNet: number | null;
  avgHoursPerWeek: number | null;
  /** Average cheque × pays a year. */
  annualFromAverage: number | null;
  hourlyMin: number | null;
  hourlyMax: number | null;
  checks: Check[];
}

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(inc|ltd|ltee|limited|corp|corporation|co|llc|lp|the|enr|senc)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Same name, allowing for missing middle names, initials, "Inc." and accents. */
export function sameName(a: string, b: string): boolean {
  const x = plain(a).split(" ").filter(Boolean);
  const y = plain(b).split(" ").filter(Boolean);
  if (!x.length || !y.length) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.every((w) => long.some((v) => v === w || (w.length === 1 && v.startsWith(w)) || (v.length === 1 && w.startsWith(v))));
}

const avg = (ns: number[]) => (ns.length ? round2(ns.reduce((t, n) => t + n, 0) / ns.length) : null);

export function compare(list: Analysis[]): Cross | null {
  if (list.length < 2) return null;
  const money = (n: number) => cad(n);
  const dated = (a: Analysis) => parseDate(a.read.pay_date) ?? parseDate(a.read.period_end);
  // Oldest first for the comparisons.
  const stubs = [...list].sort((a, b) => (dated(a)?.getTime() ?? 0) - (dated(b)?.getTime() ?? 0));
  const label = (a: Analysis) => {
    const d = dated(a);
    return d ? d.toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }) : "undated stub";
  };
  const checks: Check[] = [];

  // Same person, same employer.
  for (const [field, what] of [
    ["employee_name", "Employee name"],
    ["employer_name", "Employer name"],
  ] as const) {
    const names = stubs.map((s) => s.read[field]).filter((n): n is string => !!n);
    const odd = names.find((n) => !sameName(n, names[0]));
    if (odd) checks.push({ state: "warn", text: `${what} doesn't match: "${names[0]}" vs "${odd}".` });
    else if (names.length >= 2) checks.push({ state: "ok", text: `${what} is the same on every stub.` });
  }
  const ids = [...new Set(stubs.map((s) => s.read.employee_id?.trim()).filter(Boolean))];
  if (ids.length > 1) checks.push({ state: "warn", text: `Employee ID changes between stubs (${ids.join(", ")}).` });
  const hires = [...new Set(stubs.map((s) => s.read.hire_date).filter(Boolean))];
  if (hires.length > 1) checks.push({ state: "warn", text: `Hire date isn't the same on every stub (${hires.join(", ")}).` });

  // Pay schedule.
  const freqs = [...new Set(stubs.map((s) => s.frequency).filter((f) => f !== "unknown"))];
  if (freqs.length > 1) checks.push({ state: "warn", text: `Pay schedule differs between stubs (${freqs.map((f) => FREQ_LABEL[f].toLowerCase()).join(" vs ")}).` });
  const freq = freqs.length === 1 ? freqs[0] : null;
  const gapDays = freq ? 365 / PERIODS[freq] : null;

  let datesOk = true;
  let ytdOk = 0;
  for (let i = 1; i < stubs.length; i++) {
    const a = stubs[i - 1];
    const b = stubs[i];
    const da = dated(a);
    const db = dated(b);
    if (!da || !db) continue;
    const days = Math.round((db.getTime() - da.getTime()) / DAY);
    if (days === 0) {
      datesOk = false;
      checks.push({ state: "warn", text: `Two stubs have the same pay date (${label(b)}). Make sure it's not the same stub twice.` });
      continue;
    }
    // How many pay periods apart they are.
    let steps = 1;
    if (gapDays) {
      steps = Math.max(1, Math.round(days / gapDays));
      if (Math.abs(days - steps * gapDays) > 4) {
        datesOk = false;
        checks.push({ state: "warn", text: `${label(a)} to ${label(b)} is ${days} days, which doesn't fit a ${FREQ_LABEL[freq!].toLowerCase()} schedule.` });
      } else if (steps > 1) {
        datesOk = false;
        checks.push({ state: "info", text: `${steps - 1} stub${steps - 1 === 1 ? " is" : "s are"} missing between ${label(a)} and ${label(b)}. Lenders usually want consecutive stubs.` });
      }
    }
    // Back-to-back periods should meet with no gap or overlap.
    const endA = parseDate(a.read.period_end);
    const startB = parseDate(b.read.period_start);
    if (steps === 1 && endA && startB) {
      const gap = Math.round((startB.getTime() - endA.getTime()) / DAY);
      if (gap !== 1) {
        datesOk = false;
        checks.push({
          state: "warn",
          text:
            gap < 1
              ? `Pay periods overlap: ${label(a)}'s period ends ${a.read.period_end}, but the next starts ${b.read.period_start}.`
              : `There's a ${gap - 1}-day gap between pay periods (${a.read.period_end} to ${b.read.period_start}).`,
        });
      }
    }

    // YTD should go up by exactly the later cheque's gross (same calendar year).
    const ya = a.read.ytd_gross;
    const yb = b.read.ytd_gross;
    const gb = b.read.gross_pay;
    if (ya != null && yb != null && gb != null) {
      if (da.getUTCFullYear() !== db.getUTCFullYear()) {
        if (yb > ya + 1 && yb > gb * 2 + 1) checks.push({ state: "warn", text: `YTD didn't reset in January: ${label(b)} shows ${money(yb)} YTD.` });
      } else {
        const rise = round2(yb - ya);
        if (steps === 1) {
          if (Math.abs(rise - gb) <= 1) ytdOk++;
          else checks.push({ state: "warn", text: `YTD gross went up ${money(rise)} from ${label(a)} to ${label(b)}, but the ${label(b)} cheque's gross is ${money(gb)}. These should match.` });
        } else if (rise + 1 < gb) {
          checks.push({ state: "warn", text: `YTD gross went up only ${money(rise)} from ${label(a)} to ${label(b)}, less than the ${label(b)} cheque alone (${money(gb)}).` });
        } else {
          // Several cheques in between: the rise should be roughly that many typical cheques.
          const typical = Math.max(gb, a.read.gross_pay ?? 0);
          if (rise > steps * typical * 1.5 + 1)
            checks.push({
              state: "warn",
              text: `YTD gross jumped ${money(rise)} from ${label(a)} to ${label(b)}, far more than ${steps} cheques of about ${money(typical)}. Ask what the extra pay was.`,
            });
          else ytdOk++;
        }
      }
    }
  }
  if (datesOk && gapDays) checks.push({ state: "ok", text: `Pay dates and pay periods follow on one after another (${FREQ_LABEL[freq!].toLowerCase()}).` });
  if (ytdOk && ytdOk === stubs.length - 1) checks.push({ state: "ok", text: "Year-to-date totals go up by exactly each cheque's gross pay." });

  // Rate and hours.
  const rates = stubs.map((s) => s.hourly).filter((n): n is number => n != null);
  for (let i = 1; i < stubs.length; i++) {
    const ra = stubs[i - 1].hourly;
    const rb = stubs[i].hourly;
    if (ra != null && rb != null && Math.abs(ra - rb) >= 0.01) {
      const pct = ((rb - ra) / ra) * 100;
      checks.push({
        state: rb < ra || pct > 15 ? "warn" : "info",
        text: `Hourly rate changes from ${money(ra)} to ${money(rb)} on ${label(stubs[i])} (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%).${rb < ra ? " A pay cut is unusual; ask about it." : pct > 15 ? " A big jump; ask about it." : " Likely a raise."}`,
      });
    }
  }
  const hours = stubs.map((s) => s.hoursPerWeek).filter((n): n is number => n != null);
  if (hours.length >= 2) {
    const lo = Math.min(...hours);
    const hi = Math.max(...hours);
    if (hi > 0 && (hi - lo) / hi > 0.25) checks.push({ state: "info", text: `Hours vary from about ${lo} to ${hi} a week. Use the average, not the best week.` });
  }
  const grosses = stubs.map((s) => s.read.gross_pay).filter((n): n is number => n != null);
  const hourlyJob = stubs.some((s) => s.read.pay_type === "hourly" || s.read.pay_type === "mixed");
  if (hourlyJob && grosses.length >= 2 && grosses.every((g) => g === grosses[0]) && stubs.some((s) => s.read.earnings.some((e) => /overtime|supp/i.test(e.label))))
    checks.push({ state: "info", text: "Every stub shows exactly the same gross, even with overtime. Unusual for an hourly job; worth a closer look." });

  // Deduction lines that come and go.
  const lines = (s: Analysis) => new Set(s.read.deductions.map((d) => plain(d.label)));
  const all = stubs.map(lines);
  const union = new Set(all.flatMap((x) => [...x]));
  const patchy = [...union].filter((l) => all.some((x) => !x.has(l)));
  if (patchy.length && stubs.every((s) => s.read.deductions.length))
    checks.push({ state: "info", text: `Some deduction lines aren't on every stub (${patchy.slice(0, 3).join(", ")}). Often normal (e.g. CPP maxed out), but check.` });

  const ds = stubs.map(dated).filter((d): d is Date => !!d);
  const nets = stubs.map((s) => s.read.net_pay).filter((n): n is number => n != null);
  const avgGross = avg(grosses);
  return {
    count: stubs.length,
    from: ds.length ? ds[0].toISOString().slice(0, 10) : null,
    to: ds.length ? ds[ds.length - 1].toISOString().slice(0, 10) : null,
    avgGross,
    avgNet: avg(nets),
    avgHoursPerWeek: avg(hours),
    annualFromAverage: avgGross != null && freq ? round2(avgGross * PERIODS[freq]) : null,
    hourlyMin: rates.length ? Math.min(...rates) : null,
    hourlyMax: rates.length ? Math.max(...rates) : null,
    checks,
  };
}

/** Turns what Claude read into the full report: each stub worked out, newest first, then compared. */
export function buildReport(read: UploadRead, today = new Date()): Report {
  const stubs = read.stubs
    .filter((s) => s.is_pay_stub)
    .map((s) => analyse(s, today))
    .sort((a, b) => ((parseDate(b.read.pay_date) ?? parseDate(b.read.period_end))?.getTime() ?? 0) - ((parseDate(a.read.pay_date) ?? parseDate(a.read.period_end))?.getTime() ?? 0));
  const cross = compare(stubs);
  if (cross) for (const c of read.cross_concerns) cross.checks.push({ state: "warn", text: c });
  return { stubs, cross };
}

/** Plain-text summary of a whole upload, for the deal chat. */
export function reportText(r: Report): string {
  if (!r.cross) return summaryText(r.stubs[0]);
  const latest = r.stubs[0];
  const c = r.cross;
  const lines = [
    summaryText(latest).replace(/^Paystub check/, `Paystub check (${c.count} stubs, latest shown)`),
    "",
    `Across ${c.count} stubs (${c.from ?? "?"} to ${c.to ?? "?"}):`,
    c.avgGross != null && `Average cheque: gross ${cad(c.avgGross)}, net ${cad(c.avgNet)}`,
    c.annualFromAverage != null && `Yearly from average cheque: ${cad(c.annualFromAverage, false)}`,
    c.avgHoursPerWeek != null && `Average hours: ${c.avgHoursPerWeek} a week`,
    ...r.stubs.slice(1).flatMap((s) => [...s.checks.filter((x) => x.state === "warn"), ...s.read.concerns.map((t) => ({ text: t }))].map((x) => `⚠ (${s.read.pay_date ?? "older stub"}) ${x.text}`)),
    ...c.checks.filter((x) => x.state === "warn").map((x) => `⚠ ${x.text}`),
  ];
  return lines.filter((l) => l !== false && l !== null && l !== undefined).join("\n");
}

/** How many things to check across the whole upload (each stub, plus the comparison). */
export function reportWarnings(r: Report): number {
  const one = (a: Analysis) => a.checks.filter((c) => c.state === "warn").length + a.read.concerns.length;
  return r.stubs.reduce((t, s) => t + one(s), 0) + (r.cross?.checks.filter((c) => c.state === "warn").length ?? 0);
}

/** A saved check, as listed in the history (the full report is loaded only when opened). */
export interface SavedCheck {
  id: number;
  created_by: string;
  created_at: string;
  deal_id: number | null;
  employee_name: string | null;
  employer_name: string | null;
  stub_count: number;
  latest_pay_date: string | null;
  hourly: number | null;
  annual40: number | null;
  warn_count: number;
  report?: Report;
}
export const SAVED_COLUMNS = "id,created_by,created_at,deal_id,employee_name,employer_name,stub_count,latest_pay_date,hourly,annual40,warn_count";
