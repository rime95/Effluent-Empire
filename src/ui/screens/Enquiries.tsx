import { engineersBusy, useGame } from '../../game/store';
import { projectSlots } from '../../game/staff';
import { INDUSTRIES } from '../../game/industries';
import type { Screen } from '../App';
import { INDUSTRY_LABEL, fmt, rm } from '../format';
import { TIER_LABEL } from '../../game/realClients';
import type { Requirements } from '../../game/requirements';

/** contract terms beyond the discharge standard, in words */
function terms(r?: Requirements): string[] {
  if (!r) return [];
  const t: string[] = [];
  if (r.sludgeCapRMd !== undefined) t.push(`sludge disposal cost ≤ RM ${r.sludgeCapRMd}/d`);
  if (r.reuseMin !== undefined) t.push(`≥ ${Math.round(r.reuseMin * 100)} % of the wastewater back to the process on the reuse spec`);
  if (r.zld) t.push('zero liquid discharge (water recovered, concentrate hauled)');
  if (r.standby) t.push('duty/standby on every dosing pump and blower');
  if (r.effluentFactor !== undefined) t.push(`effluent at ≤ ${Math.round(r.effluentFactor * 100)} % of every Standard A limit`);
  if (r.energyMax_kWhm3 !== undefined) t.push(`net energy ≤ ${r.energyMax_kWhm3.toFixed(2)} kWh/m³`);
  if (r.sludgeMax_kgm3 !== undefined) t.push(`sludge ≤ ${r.sludgeMax_kgm3.toFixed(3)} kg DS/m³`);
  if (r.cakeWetMax_kgd !== undefined) t.push(`wet sludge cake ≤ ${Math.round(r.cakeWetMax_kgd)} kg/d`);
  if (r.metalRecoveryMin_kgd !== undefined) t.push(`metal recovered ≥ ${r.metalRecoveryMin_kgd.toFixed(1)} kg/d (electrowinning)`);
  return t;
}

const TIER_BRIEF: Record<string, string> = {
  medium: 'A large listed company: bigger budget, its own engineering standard (N+1 machines) and Standard A wherever it can be met.',
  mnc: 'A multinational with a group sustainability target: a generous budget, but water reuse or zero discharge and full redundancy are contract terms.',
  mega: 'The final boss: one plating campus with every problem at once — a strong, salty main rinse plus separate chrome, electroless-nickel and nickel-rinse drains. Zero liquid discharge, a cap on wet sludge cake (dry it), a nickel recovery target (electrowin the nickel rinse) and full redundancy. The biggest contract in the game.',
  flagship: 'A multinational showcase plant for its ESG report: the biggest budget in the game, and a green scorecard on top of water reuse or zero discharge — effluent well inside Standard A, low energy and little sludge. Beat each green target by 10 % for its share of the ESG bonus.',
};
import { brand } from '../prefs';

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
                {brand(e.company)}
                {e.variant && <span className="pill warn" style={{ marginLeft: 6, fontSize: 9 }}>TOUGH JOB</span>}
                {e.tier && <span className={`pill ${e.tier === 'mega' ? 'fail' : e.tier === 'flagship' ? 'warn' : e.tier === 'mnc' ? 'pass' : 'info'}`} style={{ marginLeft: 6, fontSize: 9 }}>{TIER_LABEL[e.tier].toUpperCase()}</span>}
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
              {e.declaredSide && Object.keys(e.declaredSide).length > 0 && (
                <div style={{ fontSize: 12 }}>
                  <div className="muted" style={{ marginBottom: 4 }}>Separate raw streams (declared) — the values above are the main stream:</div>
                  {(e.trueStream.side ?? []).map((sd) => {
                    const x = e.declaredSide![sd.id];
                    if (!x) return null;
                    const metal = [x.Ni !== undefined ? `Ni ${fmt(x.Ni, 0)}` : '', x.Cu !== undefined ? `Cu ${fmt(x.Cu, 0)}` : '', x.CrVI !== undefined ? `Cr(VI) ${fmt(x.CrVI, 0)}` : ''].filter(Boolean).join(' · ');
                    return (
                      <div key={sd.id} style={{ padding: '4px 0', borderTop: '1px solid var(--chrome-line)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <span>{sd.label}</span>
                          <span className="mono">{fmt(x.Q, x.Q < 10 ? 1 : 0)} m³/d</span>
                        </div>
                        <div className="mono muted" style={{ fontSize: 11 }}>
                          pH {fmt(x.pH)} · COD {fmt(x.COD, 0)}{metal ? ` · ${metal}` : ''} mg/L
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
                </div>
              )}
              {e.tier && <div className="note info"><b>{TIER_LABEL[e.tier]}.</b> {TIER_BRIEF[e.tier]}</div>}
              {e.esgBonusRM ? <div className="note info" style={{ fontSize: 12, borderColor: "var(--ok)" }}>ESG bonus pool: <b>{rm(e.esgBonusRM)}</b>, paid at commissioning for each green target beaten by 10 %.</div> : null}
              {terms(e.requirements).length > 0 && (
                <div className="note warn">
                  <b>Contract terms (checked at commissioning):</b> {terms(e.requirements).join('; ')}.
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
