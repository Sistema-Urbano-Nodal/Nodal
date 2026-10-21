/* The team's document "Condiciones de pago y membresía de pago" names the paid membership "Nodal Fundadores". On
   20 Oct 2026 the team renamed it "Membresía Fundador" (Founder Membership, Membresia Fundador), feminine in Spanish.
   Tests that hold NODAL's Spanish to that document word for word apply the same rename to the document's text first,
   so any other drift still fails. In order: the heading of section 2, then the name after "membresía" (never
   "membresía Membresía"), then after "de" and "sobre", which take the article, then the name alone. */
const RENAME = [
  ['Nodal Fundadores — Membresía anual de pago', 'Membresía Fundador — Anual de pago'],
  ['membresía Nodal Fundadores', 'Membresía Fundador'],
  ['de Nodal Fundadores', 'de la Membresía Fundador'],
  ['sobre Nodal Fundadores', 'sobre la Membresía Fundador'],
  ['Nodal Fundadores', 'Membresía Fundador'],
];

export const renamed = text => RENAME.reduce((value, [from, to]) => value.split(from).join(to), text);
