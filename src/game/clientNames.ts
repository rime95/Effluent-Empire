/**
 * Generic (fictional) company names for basic-tier customers: about 40 per industry, built from common Malaysian
 * company-name parts. Real names for medium/MNC clients live in realClients.ts (added with the client tiers).
 */
import type { IndustryId } from './industries';

const PREFIX = [
  'Sinar', 'Kemas', 'Perdana', 'Jaya', 'Mega', 'Bintang', 'Cahaya', 'Gemilang', 'Mutiara', 'Seri', 'Tekun', 'Wawasan', 'Bestari', 'Murni',
  'Setia', 'Indah', 'Utama', 'Teguh', 'Maju', 'Harmoni', 'Delta', 'Alpha', 'Beta', 'Kristal', 'Nusantara', 'Lembah', 'Pelangi', 'Suria',
  'Tiara', 'Zenith', 'Orkid', 'Rimba', 'Puncak', 'Sentosa', 'Bayu', 'Kencana', 'Megah', 'Cemerlang', 'Saujana', 'Dinamik',
];

const CORE: Record<IndustryId, string[]> = {
  plating: ['Electroplating', 'Metal Finishing', 'Surface Technology', 'Chrome Works', 'Plating Industries', 'Anodising', 'Metal Coating', 'Galvanising'],
  food: ['Foods', 'Snacks', 'Noodle Factory', 'Sauce Industries', 'Dairy', 'Beverages', 'Food Processing', 'Confectionery', 'Bakery Industries', 'Frozen Foods'],
  semiconductor: ['Electronics', 'Wafer Fab', 'Microchips', 'Semiconductor', 'Microsystems', 'Precision Electronics', 'Silicon Technology', 'Circuits'],
};

const SUFFIX = ['Sdn Bhd', '(M) Sdn Bhd', 'Industries Sdn Bhd', 'Manufacturing Sdn Bhd'];

function build(ind: IndustryId, offset: number): string[] {
  const cores = CORE[ind];
  return PREFIX.map((p, i) => {
    const core = cores[(i + offset) % cores.length];
    // "Industries"/"Manufacturing" suffix only after a core that does not already say it
    let suffix = SUFFIX[(i * 3 + offset) % SUFFIX.length];
    if (/Industries|Factory|Works/.test(core) && suffix !== '(M) Sdn Bhd') suffix = 'Sdn Bhd';
    return `${p} ${core} ${suffix}`;
  });
}

export const GENERIC_NAMES: Record<IndustryId, string[]> = {
  plating: build('plating', 0),
  food: build('food', 3),
  semiconductor: build('semiconductor', 5),
};
