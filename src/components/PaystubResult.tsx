"use client";

import { I } from "./ui";
import { useState } from "react";
import { FREQ_LABEL, cad, type Analysis, type Check, type Report } from "@/lib/paystub";

const PAY_TYPE: Record<string, string> = { hourly: "Hourly", salary: "Salary", commission: "Commission", mixed: "Mixed", unknown: "Not shown" };

const fmtDate = (s: string | null | undefined) =>
  s && /^\d{4}-\d{2}-\d{2}$/.test(s)
    ? new Date(`${s}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    : "—";

const warnCount = (a: Analysis) => a.checks.filter((c) => c.state === "warn").length + a.read.concerns.length;
const short = (s: string | null | undefined) =>
  s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }) : "—";

/** A whole upload: one stub on its own, or several stubs compared side by side. */
export function PaystubReport({ report, onCopy, onReset }: { report: Report; onCopy: () => void; onReset: () => void }) {
  const [pick, setPick] = useState(0);
  const c = report.cross;
  if (!c) return <PaystubResult a={report.stubs[0]} onCopy={onCopy} onReset={onReset} />;

  const latest = report.stubs[0];
  const r = latest.read;
  const warns = report.stubs.reduce((t, s) => t + warnCount(s), 0) + c.checks.filter((x) => x.state === "warn").length;
  const shown = report.stubs[Math.min(pick, report.stubs.length - 1)];
  const rateText = c.hourlyMin != null && c.hourlyMax != null && c.hourlyMin !== c.hourlyMax ? `${cad(c.hourlyMin)} – ${cad(c.hourlyMax)}` : null;

  return (
    <>
      <section className="scard stub-head">
        <div>
          <h3>{r.employee_name || "Employee name not shown"}</h3>
          <p>
            {r.employer_name || "Employer not shown"}
            {r.job_title ? ` · ${r.job_title}` : ""}
          </p>
          <p className="stub-span">
            {c.count} pay stubs · {fmtDate(c.from)} to {fmtDate(c.to)}
          </p>
        </div>
        <span className={`stub-badge ${warns ? "warn" : "ok"}`}>{warns ? `${warns} thing${warns === 1 ? "" : "s"} to check` : "All stubs line up"}</span>
        <div className="stub-actions">
          <button className="btn primary" onClick={onCopy}>
            {I.copy}Copy summary
          </button>
          <button className="btn" onClick={onReset}>
            Check another
          </button>
        </div>
      </section>

      <div className="stub-kpis">
        <Kpi label="Hourly rate (latest)" value={cad(latest.hourly)} sub={rateText ? `Ranged ${rateText}` : (latest.hourlyHow ?? "Not enough on the stub")} />
        <Kpi
          label="Yearly at 40 h/week"
          value={cad(latest.annual40, false)}
          sub={latest.annual40 ? `${cad(latest.monthly40, false)} a month · from the latest stub` : "Needs an hourly rate"}
          big
        />
        <Kpi
          label="Time at job"
          value={latest.tenure ? latest.tenure.text : "Not on stub"}
          sub={latest.tenure ? `${latest.tenure.how === "estimate" ? "Estimated start" : "Hired"} ${fmtDate(latest.tenure.since)}` : "Ask for a job letter"}
        />
        <Kpi
          label="Average cheque"
          value={cad(c.avgGross)}
          sub={`Gross · ${c.avgNet != null ? `${cad(c.avgNet)} net` : "net not shown"}${c.avgHoursPerWeek != null ? ` · ${c.avgHoursPerWeek} h/week` : ""}`}
        />
      </div>

      <section className="scard">
        <h3>Across the {c.count} stubs</h3>
        <div className="stub-lines">
          <table className="stub-compare">
            <thead>
              <tr>
                <th>Pay date</th>
                <th className="n">Hours</th>
                <th className="n">Gross</th>
                <th className="n">Net</th>
                <th className="n">YTD gross</th>
              </tr>
            </thead>
            <tbody>
              {[...report.stubs].reverse().map((s, i) => (
                <tr key={i}>
                  <td>{short(s.read.pay_date ?? s.read.period_end)}</td>
                  <td className="n">{s.read.hours_this_period ?? "—"}</td>
                  <td className="n">{cad(s.read.gross_pay)}</td>
                  <td className="n">{cad(s.read.net_pay)}</td>
                  <td className="n">{cad(s.read.ytd_gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {c.annualFromAverage != null && (
          <p className="stub-note">
            Average cheque × {latest.periodsPerYear} pays a year = <b>{cad(c.annualFromAverage, false)}</b> a year. Use this when hours or overtime change from
            cheque to cheque.
          </p>
        )}
        <h4 className="stub-sub">Do the stubs agree?</h4>
        <Checks list={c.checks} />
      </section>

      <section className="scard stub-pickone">
        <h3>Each stub</h3>
        <div className="seg stub-seg" role="group" aria-label="Pick a stub">
          {report.stubs.map((s, i) => (
            <button key={i} aria-pressed={shown === s} onClick={() => setPick(i)}>
              {short(s.read.pay_date ?? s.read.period_end)}
              {warnCount(s) ? <i className="dot" aria-label="has things to check" /> : null}
            </button>
          ))}
        </div>
      </section>
      <PaystubResult a={shown} embedded />
    </>
  );
}

function Checks({ list }: { list: Check[] }) {
  return (
    <ul className="stub-checks">
      {list.map((c, i) => (
        <li key={i} className={c.state}>
          {c.state === "ok" ? I.check : I.alert}
          <span>{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** What the Paystub Verifier found: headline income, checks, and everything read off the stub. */
export function PaystubResult({ a, onCopy, onReset, embedded }: { a: Analysis; onCopy?: () => void; onReset?: () => void; embedded?: boolean }) {
  const r = a.read;
  const warns = warnCount(a);
  return (
    <>
      {!embedded && (
        <section className="scard stub-head">
          <div>
            <h3>{r.employee_name || "Employee name not shown"}</h3>
            <p>
              {r.employer_name || "Employer not shown"}
              {r.job_title ? ` · ${r.job_title}` : ""}
            </p>
          </div>
          <span className={`stub-badge ${warns ? "warn" : "ok"}`}>{warns ? `${warns} thing${warns === 1 ? "" : "s"} to check` : "Looks good"}</span>
          <div className="stub-actions">
            <button className="btn primary" onClick={onCopy}>
              {I.copy}Copy summary
            </button>
            <button className="btn" onClick={onReset}>
              Check another
            </button>
          </div>
        </section>
      )}

      {!embedded && (
        <div className="stub-kpis">
          <Kpi label="Hourly rate" value={cad(a.hourly)} sub={a.hourlyHow ?? "Not enough on the stub"} />
          <Kpi
            label="Yearly at 40 h/week"
            value={cad(a.annual40, false)}
            sub={a.annual40 ? `${cad(a.monthly40, false)} a month · ${cad(a.weekly40, false)} a week` : "Needs an hourly rate"}
            big
          />
          <Kpi
            label="Time at job"
            value={a.tenure ? a.tenure.text : "Not on stub"}
            sub={a.tenure ? `${a.tenure.how === "estimate" ? "Estimated start" : "Hired"} ${fmtDate(a.tenure.since)}` : "Ask for a job letter"}
          />
          <Kpi
            label="Pay schedule"
            value={FREQ_LABEL[a.frequency]}
            sub={`${PAY_TYPE[r.pay_type]}${a.hoursPerWeek != null ? ` · about ${a.hoursPerWeek} h/week` : ""}`}
          />
        </div>
      )}

      <section className="scard">
        <h3>Yearly income, three ways</h3>
        <div className="stub-ways">
          <Way label="Hourly × 40 h × 52 weeks" value={a.annual40} note="What most lenders use for hourly jobs." />
          <Way label={`This cheque × ${a.periodsPerYear ?? "?"} pays a year`} value={a.annualFromStub} note="Includes any overtime or extras on this cheque." />
          <Way
            label="Year-to-date pace"
            value={a.annualFromYtd}
            note={a.annualFromYtd ? "YTD gross stretched to a full year." : "Needs year-to-date pay covering at least 6 weeks."}
          />
        </div>
        <p className="stub-note">{a.tenureNote}</p>
      </section>

      <section className="scard">
        <h3>Checks</h3>
        <ul className="stub-checks">
          {a.checks.map((c, i) => (
            <li key={i} className={c.state}>
              {c.state === "ok" ? I.check : I.alert}
              <span>{c.text}</span>
            </li>
          ))}
          {r.concerns.map((c, i) => (
            <li key={`c${i}`} className="warn">
              {I.alert}
              <span>{c}</span>
            </li>
          ))}
        </ul>
        {r.notes.length > 0 && (
          <>
            <h4 className="stub-sub">Good to know</h4>
            <ul className="stub-notes">
              {r.notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </>
        )}
        <small className="stub-conf">
          Read confidence: <b>{r.confidence}</b>. Always glance at the stub yourself before sending it to a lender.
        </small>
      </section>

      <section className="scard">
        <h3>This cheque</h3>
        <dl className="stub-dl">
          <Row k="Pay date" v={fmtDate(r.pay_date)} />
          <Row k="Pay period" v={r.period_start || r.period_end ? `${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}` : "—"} />
          <Row k="Hours" v={r.hours_this_period != null ? `${r.hours_this_period}` : "—"} />
          <Row k="Gross pay" v={cad(r.gross_pay)} />
          <Row
            k="Deductions"
            v={
              r.total_deductions != null
                ? cad(r.total_deductions)
                : r.deductions.some((d) => d.amount != null)
                  ? `${cad(r.deductions.reduce((t, d) => t + (d.amount ?? 0), 0))} (added up)`
                  : "—"
            }
          />
          <Row k="Net pay" v={cad(r.net_pay)} strong />
          <Row k="YTD gross" v={cad(r.ytd_gross)} />
          <Row k="YTD net" v={cad(r.ytd_net)} />
          {r.annual_salary != null && <Row k="Salary on stub" v={cad(r.annual_salary, false)} />}
        </dl>
      </section>

      {(r.earnings.length > 0 || r.deductions.length > 0) && (
        <section className="scard">
          <h3>Line by line</h3>
          {r.earnings.length > 0 && <Lines title="Earnings" rows={r.earnings} showHours />}
          {r.deductions.length > 0 && <Lines title="Deductions" rows={r.deductions} />}
        </section>
      )}

      <section className="scard">
        <h3>Employer and employee</h3>
        <dl className="stub-dl">
          <Row k="Employer" v={r.employer_name ?? "—"} />
          <Row k="Employer address" v={r.employer_address ?? "—"} />
          <Row k="Employer phone" v={r.employer_phone ?? "—"} />
          <Row k="Employee" v={r.employee_name ?? "—"} />
          <Row k="Employee address" v={r.employee_address ?? "—"} />
          <Row k="Employee ID" v={r.employee_id ?? "—"} />
          <Row k="Province" v={r.province ?? "—"} />
        </dl>
      </section>
    </>
  );
}

function Kpi({ label, value, sub, big }: { label: string; value: string; sub: string; big?: boolean }) {
  return (
    <div className={`stub-kpi${big ? " big" : ""}`}>
      <small>{label}</small>
      <b>{value}</b>
      <span>{sub}</span>
    </div>
  );
}

function Way({ label, value, note }: { label: string; value: number | null; note: string }) {
  return (
    <div className="stub-way">
      <b>{cad(value, false)}</b>
      <span>{label}</span>
      <small>{note}</small>
    </div>
  );
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={strong ? "strong" : undefined}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}

function Lines({ title, rows, showHours }: { title: string; rows: Analysis["read"]["earnings"]; showHours?: boolean }) {
  return (
    <div className="stub-lines">
      <h4 className="stub-sub">{title}</h4>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            {showHours && <th className="n">Hours</th>}
            {showHours && <th className="n">Rate</th>}
            <th className="n">Amount</th>
            <th className="n">YTD</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l, i) => (
            <tr key={i}>
              <td>{l.label}</td>
              {showHours && <td className="n">{l.hours ?? "—"}</td>}
              {showHours && <td className="n">{l.rate != null ? cad(l.rate) : "—"}</td>}
              <td className="n">{cad(l.amount)}</td>
              <td className="n">{cad(l.ytd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
