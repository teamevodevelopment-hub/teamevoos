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

const num = { anyOf: [{ type: "number" }, { type: "null" }] };
const str = { anyOf: [{ type: "string" }, { type: "null" }] };
const date = { anyOf: [{ type: "string", description: "YYYY-MM-DD" }, { type: "null" }] };
const line = {
  type: "object",
  additionalProperties: false,
  required: ["label", "hours", "rate", "amount", "ytd"],
  properties: { label: { type: "string" }, hours: num, rate: num, amount: num, ytd: num },
};

/** JSON schema Claude's answer must match. */
export const STUB_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "is_pay_stub", "problem", "employee_name", "employee_address", "employer_name", "employer_address", "employer_phone",
    "job_title", "employee_id", "pay_date", "period_start", "period_end", "pay_frequency", "pay_type", "hire_date",
    "hourly_rate", "annual_salary", "hours_this_period", "gross_pay", "total_deductions", "net_pay", "ytd_gross",
    "ytd_net", "ytd_hours", "currency", "province", "earnings", "deductions", "notes", "concerns", "confidence",
  ],
  properties: {
    is_pay_stub: { type: "boolean" },
    problem: str,
    employee_name: str,
    employee_address: str,
    employer_name: str,
    employer_address: str,
    employer_phone: str,
    job_title: str,
    employee_id: str,
    pay_date: date,
    period_start: date,
    period_end: date,
    pay_frequency: { type: "string", enum: ["weekly", "biweekly", "semi_monthly", "monthly", "unknown"] },
    pay_type: { type: "string", enum: ["hourly", "salary", "commission", "mixed", "unknown"] },
    hire_date: date,
    hourly_rate: num,
    annual_salary: num,
    hours_this_period: num,
    gross_pay: num,
    total_deductions: num,
    net_pay: num,
    ytd_gross: num,
    ytd_net: num,
    ytd_hours: num,
    currency: str,
    province: str,
    earnings: { type: "array", items: line },
    deductions: { type: "array", items: line },
    notes: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
} as const;

export const STUB_PROMPT = `You read pay stubs for a Canadian car-finance dealership. A sales agent uploaded the pages or photos attached. Lenders will rely on what you read, so copy values exactly as printed.

Rules:
- Fill every field from the stub only. If something isn't printed, use null. Never guess a value and never do maths to fill a field (we calculate income ourselves).
- Dates as YYYY-MM-DD. Money and hours as plain numbers (1234.56), no symbols or commas.
- hourly_rate: the regular hourly rate if printed. annual_salary: only if a yearly salary is printed.
- hours_this_period: regular plus overtime hours worked this period, if printed.
- hire_date: only if the stub prints a hire, start, seniority or service date.
- pay_frequency: from a printed label, or from the pay period dates (7 days = weekly, 14 = biweekly, about 15 = semi_monthly, a month = monthly). Otherwise unknown.
- earnings: every earnings line (regular, overtime, vacation, stat holiday, bonus, commission, etc). deductions: every deduction line (income tax, CPP, EI, QPP, union dues, benefits, pension, etc).
- notes: short plain-English facts an agent should know, e.g. "Overtime is 18% of this cheque", "Includes $400 one-time bonus", "Vacation pay is paid on each cheque".
- concerns: anything that looks off or worth double-checking, e.g. missing employer address, numbers that don't add up, YTD lower than this period, edited-looking text, mismatched fonts, blurry or cut-off parts, no CPP/EI taken, stub looks like a template. Empty if nothing stands out. Don't accuse anyone of fraud; describe what you see.
- If the file is not a pay stub (or unreadable), set is_pay_stub false and explain briefly in problem.
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
  const regular = read.earnings.find((e) => /\b(regular|reg|base|straight)\b/i.test(e.label) && e.hours && e.amount);

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
  hourly = hourly ? round2(hourly) : null;

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

  const hasCpp = read.deductions.some((d) => /\b(cpp|qpp|pension plan)\b/i.test(d.label));
  const hasEi = read.deductions.some((d) => /\b(ei|employment ins|qpip)\b/i.test(d.label));
  const hasTax = read.deductions.some((d) => /tax/i.test(d.label));
  if (read.deductions.length) {
    const missing = [!hasTax && "income tax", !hasCpp && "CPP", !hasEi && "EI"].filter(Boolean);
    checks.push(
      missing.length
        ? { state: "warn", text: `No ${missing.join(", ")} taken off. Normal Canadian payroll deducts all three (CPP can stop late in the year once maxed).` }
        : { state: "ok", text: "Income tax, CPP and EI are all deducted, like normal payroll." },
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
