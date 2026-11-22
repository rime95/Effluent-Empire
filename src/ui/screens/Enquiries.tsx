import { engineersBusy, useGame } from '../../game/store';
import { projectSlots } from '../../game/staff';
import { INDUSTRIES } from '../../game/industries';
import type { Screen } from '../App';
import { INDUSTRY_LABEL, fmt, rm } from '../format';

const IND_COLOR: Record<string, string> = { plating: 'var(--chem)', food: 'var(--bio)', semiconductor: 'var(--clean)' };

export function Enquiries({ go }: { go: (s: Screen) => void }) {
  const g = useGame();
  const slots = projectSlots(g.staff);
  const live = engineersBusy(g);
  const busy = live >= slots;
  return (
    <div className="page">
      <h1>Customer Enquiries</h1>
      <p className="sub">
        Declared data comes from the customer and is approximate — undeclared contaminants happen. Engineers busy (projects + plant upgrades): {live} / {slots}. {busy && <b style={{ color: 'var(--warn)' }}>Hire another engineer to run more projects in parallel.</b>}
      </p>
      {g.enquiries.length === 0 && <p className="muted">No open enquiries. Advance a week.</p>}
      <div className="grid g3">
        {g.enquiries.map((e) => {
          const t = INDUSTRIES[e.industry];
          const d = e.declared;
          return (
            <div key={e.id} className="card">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="ind" style={{ color: IND_COLOR[e.industry] }}>
                  {INDUSTRY_LABEL[e.industry]}
                </span>
                <span className="pill std">Standard {e.standard}</span>
              </div>
              <div className="company">
                {e.company}
                {e.variant && <span className="pill warn" style={{ marginLeft: 6, fontSize: 9 }}>TOUGH JOB</span>}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {t.description}
              </div>
              <dl className="kv">
                <dt>Flow</dt>
                <dd>{d.Q} m³/d</dd>
                <dt>pH</dt>
                <dd>{fmt(d.pH)}</dd>
                <dt>COD</dt>
                <dd>{fmt(d.COD, 0)} mg/L</dd>
                <dt>TSS</dt>
                <dd>{fmt(d.TSS, 0)} mg/L</dd>
                <dt>Oil &amp; grease</dt>
                <dd>{fmt(d.OG, 0)} mg/L</dd>
                {d.Ni !== undefined && (
                  <>
                    <dt>Nickel</dt>
                    <dd>{fmt(d.Ni)} mg/L</dd>
                  </>
                )}
                {d.Cu !== undefined && (
                  <>
                    <dt>Copper</dt>
                    <dd>{fmt(d.Cu)} mg/L</dd>
                  </>
                )}
                {d.Zn !== undefined && (
                  <>
                    <dt>Zinc</dt>
                    <dd>{fmt(d.Zn)} mg/L</dd>
                  </>
                )}
              </dl>
              <hr style={{ border: 'none', borderTop: '1px solid var(--chrome-line)', margin: 0 }} />
              <dl className="kv">
                <dt>Contract (design &amp; build)</dt>
                <dd style={{ color: '#fff' }}>{rm(e.contractValue)}</dd>
                <dt>Max operating cost</dt>
                <dd>{rm(e.opexLimitRMd)}/d</dd>
                <dt>Deadline</dt>
                <dd>{e.deadlineWeeks} weeks</dd>
                <dt>Offer expires</dt>
                <dd>week {e.expiresWeek}</dd>
              </dl>
              {e.difficult && <div className="note warn">Demanding client: tight deadline and a squeezed budget.</div>}
              {e.variant && (
                <div className="note info">
                  <b>Tough job — {e.variant.label}.</b> {e.variant.brief}
                  {e.requirements?.sludgeCapRMd !== undefined && <div style={{ marginTop: 4 }}>Contract term: sludge disposal cost ≤ RM {e.requirements.sludgeCapRMd}/d (checked at commissioning).</div>}
                </div>
              )}
              <div className="row">
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() => {
                    g.accept(e.id);
                    go('lab');
                  }}
                >
                  Sign contract
                </button>
                <button className="btn ghost" onClick={() => g.decline(e.id)}>
                  Decline
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
