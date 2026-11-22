import { useState } from 'react';
import { useGame } from '../../game/store';
import { VARIANTS } from '../../game/variants';
import { TECH } from '../../game/tech';
import { TIERS } from '../../game/customers';
import { TIER_LABEL, type ClientTier } from '../../game/realClients';
import type { IndustryId } from '../../game/industries';
import { INDUSTRY_LABEL, rm } from '../format';
import { brand } from '../prefs';
import type { Screen } from '../App';

const INDUSTRIES: IndustryId[] = ['plating', 'food', 'semiconductor'];

/**
 * Developer mode: testing tools for checking new content (tech, client tiers, tough jobs) without grinding.
 * Only shown when developer mode is switched on for this company (pause menu).
 */
export function Developer({ go }: { go: (s: Screen) => void }) {
  const g = useGame();
  const [industry, setIndustry] = useState<IndustryId>('plating');
  const [tier, setTier] = useState<ClientTier>('basic');
  const active = g.projects.find((p) => p.id === g.activeProjectId);
  return (
    <div className="page">
      <h1>Developer mode</h1>
      <p className="sub">
        Testing tools for this company only. Grants are booked in the ledger as “Developer”, and the save is marked DEV. Switch it off in the menu (Esc). Tip: use “Save as new slot” first to keep your real company clean.
      </p>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
        <div className="card">
          <h3>Company</h3>
          <dl className="kv">
            <dt>Cash</dt>
            <dd>{rm(g.cash)}</dd>
            <dt>Reputation</dt>
            <dd>{g.reputation}</dd>
          </dl>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {[500_000, 2_000_000, 10_000_000].map((a) => (
              <button key={a} className="btn sm" onClick={() => g.dev({ kind: 'cash', amount: a })}>
                + {rm(a)}
              </button>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>Set reputation (medium clients from {TIERS.medium.reputation}, MNC from {TIERS.mnc.reputation} + water reclaim):</div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            {[0, 10, 25, 40, 50, 60, 80, 100].map((r) => (
              <button key={r} className={`btn sm ${g.reputation === r ? 'primary' : 'ghost'}`} onClick={() => g.dev({ kind: 'reputation', value: r })}>
                {r}
              </button>
            ))}
          </div>
        </div>

        <div className="card">
          <h3>Technology</h3>
          <p className="muted" style={{ fontSize: 12 }}>
            Researched: {g.tech.length} / {Object.keys(TECH).length}
          </p>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn sm primary" onClick={() => g.dev({ kind: 'allTech' })}>
              Unlock all (free)
            </button>
            <button className="btn sm ghost" onClick={() => g.dev({ kind: 'clearTech' })}>
              Reset tree
            </button>
            <button className="btn sm ghost" onClick={() => go('tech')}>
              Open tree
            </button>
          </div>
        </div>

        <div className="card">
          <h3>Active project</h3>
          <p className="muted" style={{ fontSize: 12 }}>{active ? `${brand(active.enquiry.company)} — ${active.status}` : 'No active project.'}</p>
          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
            <button className="btn sm" disabled={!active} onClick={() => g.dev({ kind: 'labNow' })} title="Every queued lab test reports next week">
              Lab results next week
            </button>
            <button
              className="btn sm"
              disabled={!active || (active.status !== 'design' && active.status !== 'failed')}
              onClick={() => {
                g.dev({ kind: 'referenceDesign' });
                go('studio');
              }}
              title="Replace the design with the reference design the job was priced on (tier, tough-job or base train)"
            >
              Load reference design
            </button>
          </div>
        </div>
      </div>

      <h2 style={{ marginTop: 18 }}>Spawn an enquiry</h2>
      <p className="muted" style={{ fontSize: 12 }}>
        Adds a job at the top of Customer Enquiries (expires in 8 weeks). Tier jobs use your current tech for their contract (MNC reuse needs RO/UF/reclaim in the design; ZLD needs the evaporator researched). If the feed can’t support an MNC target the job is offered as medium tier, as in normal play.
      </p>
      <div className="card">
        <div className="row" style={{ flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
          <span className="muted" style={{ fontSize: 12 }}>Industry</span>
          {INDUSTRIES.map((i) => (
            <button key={i} className={`btn sm ${industry === i ? 'primary' : 'ghost'}`} onClick={() => setIndustry(i)}>
              {INDUSTRY_LABEL[i]}
            </button>
          ))}
          <span className="muted" style={{ fontSize: 12, marginLeft: 12 }}>Client tier</span>
          {(['basic', 'medium', 'mnc'] as ClientTier[]).map((t) => (
            <button key={t} className={`btn sm ${tier === t ? 'primary' : 'ghost'}`} onClick={() => setTier(t)}>
              {TIER_LABEL[t]}
            </button>
          ))}
          <button className="btn sm primary" style={{ marginLeft: 12 }} onClick={() => g.dev({ kind: 'spawn', force: { industry, tier } })}>
            Spawn
          </button>
        </div>
        <div className="muted" style={{ fontSize: 12, margin: '12px 0 6px' }}>Tough jobs (technology variants):</div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
          {VARIANTS.map((v) => (
            <button key={v.id} className="btn sm" onClick={() => g.dev({ kind: 'spawn', force: { variantId: v.id } })} title={`${v.brief} Needs: ${v.requires.map((r) => TECH[r].name).join(', ')}`}>
              {v.label}
              {v.requires.some((r) => !g.tech.includes(r)) && <span className="lock">needs tech</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
