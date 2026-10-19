// Collecte de l'historique des courses (API publique PMU) pour entraîner/tester un modèle.
// Usage : node scripts/collect-history.cjs [--jours 60] [--plancher 2024-10-01]
// Remplit data/history/AAAA-MM.json.gz et data/history/state.json (reprend là où il s'est arrêté).
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const BASE = process.env.PMU_BASE || "https://online.turfinfo.api.pmu.fr/rest/client/7/programme/";
const DIR = path.join(__dirname, "..", "data", "history");
const arg = (n, d) => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; };
const BUDGET = +arg("jours", 60);
const PAUSE = +(process.env.PMU_PAUSE || 250);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const ddmmyyyy = (s) => s.slice(8, 10) + s.slice(5, 7) + s.slice(0, 4);

async function get(url, essais) {
  for (let k = 0; k < (essais || 3); k++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (les-3-bases-gagnant)", Accept: "application/json" } });
      if (r.status === 404 || r.status === 204) return null;
      if (r.ok) return await r.json();
      if (r.status === 429 || r.status >= 500) await sleep(2000 * (k + 1)); else return null;
    } catch (e) { await sleep(1500 * (k + 1)); }
  }
  return undefined; // échec réseau : on ne marque pas le jour comme fait
}

function compactParticipant(p) {
  const rd = p.dernierRapportDirect && p.dernierRapportDirect.rapport, rr = p.dernierRapportReference && p.dernierRapportReference.rapport;
  return {
    n: p.numPmu, nom: p.nom, age: p.age, sx: p.sexe, mu: p.musique || "",
    nc: p.nombreCourses, nv: p.nombreVictoires, np: p.nombrePlaces, g: p.gainsParticipant,
    dr: p.driver || "", en: p.entraineur || "", hp: p.handicapPoids, hv: p.handicapValeur,
    oe: p.oeilleres || "", dc: p.driverChange ? 1 : 0, st: p.statut, cote: rd == null ? null : rd, cref: rr == null ? null : rr,
    pos: p.ordreArrivee == null ? null : p.ordreArrivee
  };
}

async function jour(date) {
  const prog = await get(BASE + ddmmyyyy(date));
  if (prog === undefined) return undefined;
  const out = [];
  const reunions = (prog && prog.programme && prog.programme.reunions) || [];
  for (const r of reunions) {
    if (!r.pays || r.pays.code !== "FRA") continue;
    for (const c of r.courses || []) {
      if (!c.ordreArrivee || !c.ordreArrivee.length) continue;
      await sleep(PAUSE);
      const pp = await get(BASE + ddmmyyyy(date) + "/R" + r.numOfficiel + "/C" + c.numOrdre + "/participants");
      if (pp === undefined) return undefined;
      if (!pp || !pp.participants) continue;
      out.push({
        date: date, hip: r.hippodrome && r.hippodrome.libelleCourt, r: r.numOfficiel, c: c.numOrdre,
        disc: c.discipline, spec: c.specialite, dist: c.distance, piste: c.typePiste || "",
        pene: (c.penetrometre && c.penetrometre.intitule) || "", part: c.nombreDeclaresPartants, prix: c.montantPrix,
        cat: c.categorieParticularite || "", arr: c.ordreArrivee.map((x) => x.join("+")),
        h: pp.participants.filter((p) => p.statut !== "NON_PARTANT").map(compactParticipant)
      });
    }
  }
  return out;
}

function lireMois(m) {
  const f = path.join(DIR, m + ".json.gz");
  return fs.existsSync(f) ? JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString()) : [];
}
function ecrireMois(m, rows) {
  rows.sort((a, b) => (a.date + a.r * 100 + a.c).toString().localeCompare((b.date + b.r * 100 + b.c).toString()));
  fs.writeFileSync(path.join(DIR, m + ".json.gz"), zlib.gzipSync(JSON.stringify(rows)));
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const sf = path.join(DIR, "state.json");
  const hier = addDays(iso(new Date()), -1);
  const plancher = arg("plancher", addDays(hier, -730));
  let st = fs.existsSync(sf) ? JSON.parse(fs.readFileSync(sf)) : { newest: hier, oldest: addDays(hier, 1), courses: 0 };
  const pending = {}; // mois -> rows
  const ajouter = (date, rows) => {
    const m = date.slice(0, 7);
    if (!pending[m]) pending[m] = lireMois(m).filter((x) => x.date !== date);
    else pending[m] = pending[m].filter((x) => x.date !== date);
    rows.forEach((x) => pending[m].push(x));
  };
  let budget = BUDGET, total = 0;
  // 1) rattrapage vers l'avant (jusqu'à hier)
  for (let d = addDays(st.newest, 1); d <= hier && budget > 0; d = addDays(d, 1), budget--) {
    const rows = await jour(d); if (rows === undefined) { console.log("échec réseau " + d); break; }
    ajouter(d, rows); total += rows.length; st.newest = d; console.log(d + " : " + rows.length + " courses");
  }
  // 2) remontée vers le passé (jusqu'au plancher)
  for (let d = addDays(st.oldest, -1); d >= plancher && budget > 0; d = addDays(d, -1), budget--) {
    const rows = await jour(d); if (rows === undefined) { console.log("échec réseau " + d); break; }
    ajouter(d, rows); total += rows.length; st.oldest = d; console.log(d + " : " + rows.length + " courses");
  }
  Object.keys(pending).forEach((m) => ecrireMois(m, pending[m]));
  st.courses = fs.readdirSync(DIR).filter((f) => /\.json\.gz$/.test(f)).reduce((s, f) => s + lireMois(f.slice(0, 7)).length, 0);
  fs.writeFileSync(sf, JSON.stringify(st));
  console.log("Ajoutées : " + total + " · total " + st.courses + " courses · de " + st.oldest + " à " + st.newest);
})();
