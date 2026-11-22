import { useState } from 'react';
import { CATALOGUE, UnitType } from '../../simulation/treatment/catalogue';
import { STANDARDS, limitsFor, ParamId } from '../../simulation/treatment/compliance';
import { minimumSolubilityPH } from '../../simulation/chemistry/solubility';
import { METALS } from '../../simulation/core/stream';
import { INDUSTRIES } from '../../game/industries';
import { UnitSymbol } from '../components/Symbols';
import { CATEGORY_COLOR } from '../studio/nodes';
import { fmt } from '../format';

const PROFILES: Record<UnitType, { mechanism: string; params: string; opex: string; failure: string; notFor: string }> = {
  eq: { mechanism: 'Storage volume absorbs flow and load peaks (peak factor decays with retention time).', params: 'Volume, retention time (h)', opex: 'Mixing energy', failure: 'Undersized: peaks overload clarifiers and filters.', notFor: '—' },
  oilSep: { mechanism: 'Free-oil droplets rise at their Stokes velocity; removal follows ideal-basin (Hazen) theory.', params: 'Surface area → surface loading (m/h)', opex: 'Oil disposal', failure: 'Emulsified oil passes straight through.', notFor: 'Emulsions (break them with coagulation first)' },
  daf: { mechanism: 'Air dissolved in a pressurised recycle is released as micro-bubbles that attach to oil and floc; float is skimmed. Sized on the air-to-solids ratio (A/S) and hydraulic loading.', params: 'Area (m/h), recycle %, saturator pressure → A/S', opex: 'Recycle pump energy, float disposal', failure: 'Low A/S, high hydraulic loading, unbroken emulsions.', notFor: 'Stable emulsions without coagulation, dissolved organics' },
  neutralisation: { mechanism: 'Doses alkali or acid to a set-point; dose follows the titration curve (buffer capacity).', params: 'pH set-point, reagent, retention time', opex: 'Caustic / lime / acid', failure: 'Lowering pH re-dissolves carried-over metal hydroxides.', notFor: 'Removing anything by itself' },
  precipitation: { mechanism: 'Raises pH above the metal hydroxide solubility; each metal has its own optimum pH (amphoteric).', params: 'Reaction pH, retention time (particle growth)', opex: 'Caustic, hazardous sludge disposal', failure: 'Too low pH → dissolved metal; too high → zincate re-dissolution; pin floc escapes the clarifier.', notFor: 'Chelated metals (Phase 2)' },
  coagulation: { mechanism: 'Coagulant neutralises colloid charge (or sweeps them up), flocculation grows settleable floc. Consumes alkalinity.', params: 'Coagulant, dose (jar test), floc time, pH control', opex: 'Coagulant + extra sludge', failure: 'Under/over-dosing, wrong pH window, pH drop re-dissolves metals, aluminate at high pH.', notFor: 'Dissolved organics or dissolved metals' },
  clarifier: { mechanism: 'Gravity settling. Discrete particles: Hazen SOR theory. Mixed liquor: zone settling (Vesilind).', params: 'Surface area (SOR at peak flow), depth', opex: 'Sludge pumping & disposal', failure: 'High SOR; sludge blanket washout when SOR approaches the zone-settling velocity.', notFor: 'Colloids that have not been coagulated' },
  activatedSludge: { mechanism: 'Heterotrophs oxidise biodegradable COD (Monod kinetics); nitrifiers convert NH₄ at long SRT.', params: 'Volume (HRT), SRT, DO; watch MLSS and F/M', opex: 'Aeration electricity, waste sludge', failure: 'Washout, metal/pH inhibition, N limitation, alkalinity loss, no secondary clarifier.', notFor: 'Dissolved heavy metals, inert soluble COD' },
  crReduction: { mechanism: 'Metabisulfite reduces chromate Cr(VI) to Cr³⁺ at pH 2–2.5 (fast, acid-catalysed); Cr(III) is then precipitated as Cr(OH)₃ near pH 8.', params: 'Reduction pH, metabisulfite dose (× 2.74 mg/mg Cr), retention time', opex: 'Sulphuric acid, metabisulfite, then caustic to neutralise', failure: 'pH too high (slow), under-dosed reductant, short retention; Cr(VI) passes hydroxide precipitation untouched.', notFor: 'Anything other than oxidised chromium' },
  carbon: { mechanism: 'Freundlich adsorption of non-biodegradable dissolved organics onto activated carbon; carbon is consumed as it saturates.', params: 'Empty-bed contact time (EBCT)', opex: 'Replacement carbon (RM/kg)', failure: 'High feed solids blind the bed; high organic load exhausts carbon fast.', notFor: 'Bulk COD removal (use biology first), metals, solids' },
  sandFilter: { mechanism: 'Depth filtration (Iwasaki); capture falls as filtration rate rises (Yao collector theory).', params: 'Area → filtration rate (m/h), bed depth', opex: 'Backwash pumping', failure: 'High feed TSS (short runs), breakthrough at high rate.', notFor: 'Primary solids removal, colloids' },
  thickener: { mechanism: 'Gravity thickening: sludge compacts under its own weight; performance set by the solids loading rate.', params: 'Area → solids loading (kg/m²·d)', opex: 'Rake drive', failure: 'Overloaded: thin underflow, solids return in the supernatant.', notFor: 'Dewatering to a spadeable cake' },
  filterPress: { mechanism: 'Pressure filtration in recessed-plate chambers after polymer or lime conditioning.', params: 'Chamber volume, cycles/day, conditioning', opex: 'Polymer or lime, energy, cake disposal', failure: 'Undersized: short cycles, wet cake, dirty filtrate.', notFor: 'Dilute feed (thicken first)' },
  splitter: { mechanism: 'Weir box dividing a stream between two outlets at a set percentage.', params: 'Split to outlet a (%)', opex: '—', failure: 'Jammed gate sends everything one way.', notFor: '—' },
  mixer: { mechanism: 'Combines streams; pH and solubility are re-equilibrated after mixing.', params: '—', opex: '—', failure: 'Mixing can re-dissolve or precipitate metals.', notFor: '—' },
};

export function Encyclopedia() {
  const [tab, setTab] = useState<'units' | 'standards' | 'metals' | 'industries'>('units');
  const limitsA = limitsFor('A');
  const limitsB = limitsFor('B');
  return (
    <div className="page">
      <h1>Encyclopedia</h1>
      <p className="sub">Technology profiles, discharge standards and the chemistry behind the simulation. Every model is documented in the project&apos;s knowledge base.</p>
      <div className="row" style={{ marginBottom: 14 }}>
        {(['units', 'standards', 'metals', 'industries'] as const).map((t) => (
          <button key={t} className={`btn sm ${tab === t ? 'primary' : ''}`} onClick={() => setTab(t)}>
            {t === 'units' ? 'Treatment units' : t === 'standards' ? 'Discharge standards' : t === 'metals' ? 'Metal solubility' : 'Industries'}
          </button>
        ))}
      </div>
      {tab === 'units' && (
        <div className="grid g2">
          {(Object.keys(CATALOGUE) as UnitType[]).map((t) => {
            const d = CATALOGUE[t];
            const pr = PROFILES[t];
            return (
              <div key={t} className="panel">
                <div className="row">
                  <div style={{ background: '#fff', borderRadius: 4, padding: 4 }}>
                    <div style={{ width: 92, height: 52 }}>
                      <UnitSymbol type={t} accent={CATEGORY_COLOR[d.category]} />
                    </div>
                  </div>
                  <div>
                    <div className="mono" style={{ fontSize: 11, color: CATEGORY_COLOR[d.category], textTransform: 'uppercase' }}>
                      {d.category} · {d.tagPrefix}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{d.name}</div>
                  </div>
                </div>
                <dl className="kv" style={{ gridTemplateColumns: '110px 1fr', marginTop: 10 }}>
                  <dt>Mechanism</dt>
                  <dd style={{ fontFamily: 'var(--font)', textAlign: 'left' }}>{pr.mechanism}</dd>
                  <dt>Key parameters</dt>
                  <dd style={{ fontFamily: 'var(--font)', textAlign: 'left' }}>{pr.params}</dd>
                  <dt>Main OPEX</dt>
                  <dd style={{ fontFamily: 'var(--font)', textAlign: 'left' }}>{pr.opex}</dd>
                  <dt>Failure modes</dt>
                  <dd style={{ fontFamily: 'var(--font)', textAlign: 'left' }}>{pr.failure}</dd>
                  <dt>Not suitable for</dt>
                  <dd style={{ fontFamily: 'var(--font)', textAlign: 'left' }}>{pr.notFor}</dd>
                </dl>
              </div>
            );
          })}
        </div>
      )}
      {tab === 'standards' && (
        <div className="panel">
          <h2>Malaysia — Environmental Quality (Industrial Effluent) Regulations 2009</h2>
          <p className="muted" style={{ fontSize: 12 }}>
            {STANDARDS.source} Data version {STANDARDS.version}.
          </p>
          <table className="data">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>Unit</th>
                <th style={{ textAlign: 'right' }}>Standard A</th>
                <th style={{ textAlign: 'right' }}>Standard B</th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(limitsA) as ParamId[]).map((k) => {
                const a = limitsA[k]!;
                const b = limitsB[k]!;
                const f = (l: { min?: number; max?: number }) => (l.min !== undefined ? `${l.min}–${l.max}` : `${l.max}`);
                return (
                  <tr key={k}>
                    <td>{STANDARDS.parameters[k].label}</td>
                    <td className="muted">{STANDARDS.parameters[k].unit}</td>
                    <td className="num">{f(a)}</td>
                    <td className="num">{f(b)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {tab === 'metals' && (
        <div className="panel">
          <h2>Hydroxide solubility minima (model, 25 °C)</h2>
          <table className="data">
            <thead>
              <tr>
                <th>Metal</th>
                <th style={{ textAlign: 'right' }}>Optimum pH</th>
                <th style={{ textAlign: 'right' }}>Minimum solubility</th>
              </tr>
            </thead>
            <tbody>
              {METALS.map((m) => {
                const s = minimumSolubilityPH(m);
                return (
                  <tr key={m}>
                    <td>{m}(OH)₂</td>
                    <td className="num">{fmt(s.pH, 1)}</td>
                    <td className="num">{fmt(s.mgL, 3)} mg/L</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted" style={{ fontSize: 12 }}>A mixed-metal wastewater needs a compromise pH. In practice, effluent metal is usually limited by fine particles escaping solids separation, not by solubility.</p>
        </div>
      )}
      {tab === 'industries' && (
        <div className="grid g3">
          {Object.values(INDUSTRIES).map((t) => (
            <div key={t.id} className="panel">
              <div style={{ fontSize: 16, fontWeight: 600, color: '#fff' }}>{t.name}</div>
              <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
                {t.sector}
              </div>
              <p style={{ fontSize: 13 }}>{t.description}</p>
              <dl className="kv">
                <dt>Flow</dt>
                <dd>
                  {t.Q[0]}–{t.Q[1]} m³/d
                </dd>
                <dt>pH</dt>
                <dd>
                  {t.pH[0]}–{t.pH[1]}
                </dd>
                <dt>COD</dt>
                <dd>
                  {t.COD[0]}–{t.COD[1]} mg/L
                </dd>
              </dl>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
