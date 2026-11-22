/**
 * Client tiers and the real company names used for medium and MNC clients. All real names live in this one file.
 * Names are flavour only: every wastewater, number and event in the game is fictional, and game text never names a
 * client as the cause of a breach (see knowledge/processes/client_tiers.md, "Neutral wording").
 * The "fictional names" setting swaps every real name for its fixed alias (`fictionalAlias`).
 */
import type { IndustryId } from './industries';

export type ClientTier = 'basic' | 'medium' | 'mnc' | 'flagship';

/** Large Malaysian companies (medium tier). */
const MEDIUM: Record<IndustryId, string[]> = {
  plating: [
    'Press Metal Aluminium Holdings', 'VS Industry', 'SKP Resources', 'Notion VTec', 'Kobay Technology', 'Dufu Technology', 'Uchi Technologies',
    'PIE Industrial', 'ATA IMS', 'CSC Steel Holdings', 'Ann Joo Resources', 'Hiap Teck Venture', 'Prestar Resources', 'Engtex Group', 'Coraza Integrated Technology',
  ],
  food: [
    'Mamee-Double Decker', 'QL Resources', 'Spritzer', 'Hup Seng Industries', 'Oriental Food Industries', 'Fraser & Neave Holdings', 'Power Root',
    'Apollo Food Holdings', 'Kawan Food', 'Farm Fresh', 'Gardenia Bakeries (KL)', 'Ayamas Food Corporation', 'Rex Industry', 'Khee San', 'Kilang Makanan Mamee',
  ],
  semiconductor: [
    'Inari Amertron', 'Unisem (M)', 'Malaysian Pacific Industries', 'ViTrox Corporation', 'Globetronics Technology', 'KESM Industries', 'Frontken Corporation',
    'Greatech Technology', 'Pentamaster Corporation', 'JHM Consolidation', 'Elsoft Research', 'Aemulus Holdings', 'D&O Green Technologies', 'Carsem (M)', 'SilTerra Malaysia',
  ],
};

/** Multinationals with Malaysian plants (MNC tier). */
const MNC: Record<IndustryId, string[]> = {
  plating: [
    'Panasonic Manufacturing Malaysia', 'Bosch (Penang)', 'Continental Automotive Components', 'Western Digital (Malaysia)', 'Seagate Technology (Malaysia)', 'Dyson Manufacturing',
    'Denso (Malaysia)', 'Murata Electronics (Malaysia)', 'TDK Electronics', 'Kyocera Document Technology', 'Sumitomo Electric Interconnect', 'Fuji Electric (Malaysia)', 'Hitachi Astemo', 'Samsung SDI Energy Malaysia', 'Sony EMCS (Malaysia)',
  ],
  food: [
    'Nestlé Manufacturing (Malaysia)', 'Unilever (Malaysia)', 'Mondelēz Malaysia', 'PepsiCo (Malaysia)', 'Coca-Cola Refreshments Malaysia', 'Ajinomoto (Malaysia)', 'Dutch Lady Milk Industries',
    'Kellanova Asia', 'Mars Foods Malaysia', 'Carlsberg Brewery Malaysia', 'Heineken Malaysia', 'Fonterra Brands (Malaysia)', 'Abbott Manufacturing Malaysia', 'Yakult (Malaysia)', 'Danone Dumex (Malaysia)',
  ],
  semiconductor: [
    'Intel Malaysia', 'Infineon Technologies (Kulim)', 'AMD Global Services', 'Micron Memory Malaysia', 'Texas Instruments Malaysia', 'NXP Malaysia', 'Renesas Semiconductor',
    'onsemi Seremban', 'ams OSRAM Penang', 'Broadcom Malaysia', 'Keysight Technologies Malaysia', 'Plexus Manufacturing', 'Jabil Circuit', 'Lam Research Malaysia', 'Kulicke & Soffa Malaysia',
  ],
};

/** flagship (ESG showcase) projects come from the same multinationals */
export const REAL_CLIENTS: Record<Exclude<ClientTier, 'basic'>, Record<IndustryId, string[]>> = { medium: MEDIUM, mnc: MNC, flagship: MNC };

const ALIAS_PREFIX = [
  'Apex', 'Orion', 'Vertex', 'Meridian', 'Summit', 'Pinnacle', 'Horizon', 'Atlas', 'Nova', 'Titan', 'Sterling', 'Crest', 'Vanguard', 'Polaris', 'Aurora',
];
const ALIAS_CORE: Record<IndustryId, string> = { plating: 'Metal Components', food: 'Food Industries', semiconductor: 'Semiconductor' };

/** Fixed fictional alias of a real name (same index in its list → same alias across saves). */
const ALIASES: Map<string, string> = new Map();
for (const tier of ['medium', 'mnc'] as const)
  for (const ind of Object.keys(MEDIUM) as IndustryId[])
    REAL_CLIENTS[tier][ind].forEach((n, i) =>
      ALIASES.set(n, `${ALIAS_PREFIX[i % ALIAS_PREFIX.length]} ${ALIAS_CORE[ind]} ${tier === 'mnc' ? 'International' : 'Berhad'}`),
    );

export function fictionalAlias(name: string): string {
  return ALIASES.get(name) ?? name;
}

// longest first, so "X (second site)" and overlapping names replace cleanly
const REAL_SORTED = [...ALIASES.keys()].sort((a, b) => b.length - a.length);

/** Replace every real company name in a text with its fictional alias (when the setting is on). */
export function brandText(text: string, fictional: boolean): string {
  if (!fictional || !text) return text;
  let t = text;
  for (const n of REAL_SORTED) if (t.includes(n)) t = t.split(n).join(ALIASES.get(n)!);
  return t;
}

export const TIER_LABEL: Record<ClientTier, string> = { basic: 'Local SME', medium: 'Large local company', mnc: 'Multinational', flagship: 'Flagship ESG project' };
