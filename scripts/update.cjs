#!/usr/bin/env node
// Télécharge le journal hippique PMU'B sur lonab.bf, le lit, puis régénère index.html.
// Usage : node scripts/update.cjs            (téléchargement automatique)
//         node scripts/update.cjs --file x.pdf   (lire un PDF local)
const fs = require("fs");
const path = require("path");
const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");
const { parseJournal } = require("../parser.js");
const E = require("../engine.js");

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data", "journals.json");
const BASE = "https://lonab.bf/sites/default/files/";
const DIAG = [];
const _log = console.log;
console.log = function () { const l = Array.prototype.join.call(arguments, " "); DIAG.push(l); _log.apply(console, arguments); };
const UA = "LesTroisBasesGagnant/1.0 (lecture du journal hippique public)";
const KEEP_DAYS = 14;
const LOOKAHEAD_DAYS = 2;

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());

// Le fichier s'appelle JH_PMUB_DU_JJ-MM-AAAA.pdf. Son dossier est le mois de mise en ligne,
// qui peut précéder le jour de course : on essaie donc le mois de la course et les 4 jours d'avant.
function candidates(d) {
  const name = "JH_PMUB_DU_" + pad(d.getUTCDate()) + "-" + pad(d.getUTCMonth() + 1) + "-" + d.getUTCFullYear() + ".pdf";
  const folders = [];
  for (let back = 0; back <= 4; back++) {
    const t = new Date(d.getTime() - back * 864e5);
    const f = t.getUTCFullYear() + "-" + pad(t.getUTCMonth() + 1);
    if (folders.indexOf(f) === -1) folders.push(f);
  }
  const base = [name, name.replace("PMUB_DU", "PMU_DU")];
  const names = [];
  base.forEach((b) => ["", "_0", "_1", "_2"].forEach((sfx) => names.push(b.replace(".pdf", sfx + ".pdf"))));
  const out = [];
  names.forEach((nm) => folders.forEach((f) => out.push(BASE + f + "/" + nm)));
  return out;
}

async function download(url) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(60000) });
    if (!res.ok) { console.log("  " + res.status + "  " + url); return null; }
    const buf = new Uint8Array(await res.arrayBuffer());
    if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== "%PDF") { console.log("  pas un PDF : " + url); return null; }
    return buf;
  } catch (e) {
    console.log("  erreur réseau : " + url + " (" + e.message + ")");
    return null;
  }
}

async function readPdf(buf) {
  const doc = await pdfjs.getDocument({ data: buf, useSystemFonts: true }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push({
      width: page.view[2] - page.view[0],
      items: tc.items.filter((i) => i.str && i.str.trim()).map((i) => ({ s: i.str, x: i.transform[4], y: i.transform[5] }))
    });
  }
  return parseJournal(pages);
}

// Résultats officiels du jour : lonab.bf/resultats-gains-pmub (Res41_JJ_MM_AAAA.pdf, Res_JJ_MM_AAAA_QUARTE.pdf, Res_JJ_MM_AAAA_TIERCE.pdf)
const GAMES = { "4+1": "41", "Quarté": "QUARTE", "Tiercé": "TIERCE" };
function resultUrls(d, game) {
  const dd = pad(d.getUTCDate()), mm = pad(d.getUTCMonth() + 1), yy = d.getUTCFullYear();
  const folder = BASE + yy + "-" + mm + "/";
  return game === "41" ? [folder + "Res41_" + dd + "_" + mm + "_" + yy + ".pdf"] : [folder + "Res_" + dd + "_" + mm + "_" + yy + "_" + game + ".pdf"];
}
async function readResult(buf) {
  const doc = await pdfjs.getDocument({ data: buf, useSystemFonts: true }).promise;
  let txt = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    txt += " " + tc.items.map((i) => i.str).join(" ");
  }
  txt = txt.replace(/\s+/g, " ");
  const a = txt.match(/(?:Arriv[ée]e|\bARR)\s*:?\s*((?:\d{1,2}\s*[-–]\s*)+\d{1,2})/i);
  const dm = txt.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!a || !dm) { console.log("  texte lu mais arrivée introuvable : " + txt.slice(0, 200)); return null; }
  return { iso: dm[3] + "-" + dm[2] + "-" + dm[1], nums: a[1].split(/\s*[-–]\s*/).map(Number) };
}

async function main() {
  const store = fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA, "utf8")) : [];
  const ARCH = path.join(ROOT, "data", "archive.json");
  const archive = new Map((fs.existsSync(ARCH) ? JSON.parse(fs.readFileSync(ARCH, "utf8")) : []).map((c) => [c.date, c]));
  store.forEach((c) => { if (!archive.has(c.date)) archive.set(c.date, c); });
  const byDate = new Map(store.map((c) => [c.date, c]));
  const today = new Date();
  today.setUTCHours(12, 0, 0, 0);

  const jobs = [];
  const dir = path.join(ROOT, "journaux");
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir).filter((f) => /\.pdf$/i.test(f)).sort().forEach((f) => {
      jobs.push({ label: "journaux/" + f, load: async () => ({ buf: new Uint8Array(fs.readFileSync(path.join(dir, f))), url: "" }) });
    });
  }
  process.argv.forEach((a, i) => {
    if (a !== "--file" || !process.argv[i + 1]) return;
    const f = process.argv[i + 1];
    jobs.push({ label: f, load: async () => ({ buf: new Uint8Array(fs.readFileSync(f)), url: "" }) });
  });
  const offline = process.argv.indexOf("--offline") > -1;
  for (let off = -4; off <= (offline ? -5 : LOOKAHEAD_DAYS); off++) {
    const d = new Date(today.getTime() + off * 864e5);
    const key = iso(d);
    if (byDate.has(key) && byDate.get(key).auto) continue;
    jobs.push({
      label: "journal du " + key,
      auto: true,
      load: async () => {
        for (const u of candidates(d)) {
          const b = await download(u);
          if (b) return { buf: b, url: u };
        }
        return null;
      }
    });
  }

  for (const j of jobs) {
    console.log("→ " + j.label);
    const got = await j.load();
    if (!got) { console.log("  introuvable (pas encore publié ?)"); continue; }
    let info;
    try { info = await readPdf(got.buf); } catch (e) { console.log("  PDF illisible : " + e.message); continue; }
    if (!info.ok || !info.race.iso) { console.log("  lecture impossible : " + (info.error || "date de la course introuvable")); continue; }
    delete info.ok;
    const rec = Object.assign({ date: info.race.iso, source: got.url, auto: !!j.auto }, info);
    byDate.set(info.race.iso, rec);
    archive.set(info.race.iso, rec);
    console.log("  OK " + info.race.iso + " · " + info.race.titre + " (" + info.horses.length + " partants)");
  }

  const limit = iso(new Date(today.getTime() - KEEP_DAYS * 864e5));
  const list = Array.from(byDate.values()).filter((c) => c.date >= limit).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (!list.length) { console.log("Aucune course disponible : index.html n'est pas modifié."); return; }

  // Bilan : comparer les bases calculées à l'arrivée officielle de la même course.
  const ARR = path.join(ROOT, "data", "arrivees.json");
  const BIL = path.join(ROOT, "data", "bilan.json");
  const arrivees = fs.existsSync(ARR) ? JSON.parse(fs.readFileSync(ARR, "utf8")) : {};
  const bilan = fs.existsSync(BIL) ? JSON.parse(fs.readFileSync(BIL, "utf8")) : [];
  if (!offline) {
    for (let back = 0; back <= 2; back++) {
      const d = new Date(today.getTime() - back * 864e5), key = iso(d);
      if (arrivees[key] && arrivees[key].arrivee.length >= 5) continue;
      const c = archive.get(key);
      const g = c && GAMES[String(c.race.jeu).split(" ·")[0]];
      for (const game of g ? [g] : ["41", "QUARTE", "TIERCE"]) {
        for (const u of resultUrls(d, game)) {
          console.log("→ résultat " + key + " (" + game + ")");
          const b = await download(u);
          if (!b) continue;
          let r = null;
          try { r = await readResult(b); } catch (e) { console.log("  PDF illisible : " + e.message); }
          if (r && r.iso === key && r.nums.length >= 3) {
            const old = arrivees[key];
            if (!old || old.auto && old.arrivee.length < r.nums.length) arrivees[key] = { arrivee: r.nums.length === 4 ? completer(key, r.nums) : r.nums, source: "résultats lonab.bf", auto: true, jeu: Object.keys(GAMES).find((k) => GAMES[k] === game) };
            console.log("  OK arrivée " + r.nums.join("-"));
          }
        }
      }
    }
  }
  // Complète une arrivée de 4 numéros (5e place absente du journal) avec l'historique PMU collecté
  function completer(iso, nums) {
    try {
      const f = path.join(__dirname, "..", "data", "history", iso.slice(0, 7) + ".json.gz");
      if (!fs.existsSync(f)) return nums;
      const rows = JSON.parse(require("zlib").gunzipSync(fs.readFileSync(f)).toString()).filter((x) => x.date === iso);
      const ok = rows.filter((x) => x.arr.length >= 5 && nums.every((n, i) => x.arr[i] === String(n)) && /^\d+$/.test(x.arr[4]));
      return ok.length === 1 ? nums.concat([+ok[0].arr[4]]) : nums;
    } catch (e) { return nums; }
  }
  Array.from(archive.values()).forEach((c) => {
    (c.arrivals || []).forEach((a) => {
      if (a.nums.length === 4) a = { iso: a.iso, nums: completer(a.iso, a.nums) };
      const old = arrivees[a.iso];
      if (a.nums.length >= 5 && (!old || (old.auto && old.arrivee.length < a.nums.length))) {
        arrivees[a.iso] = { arrivee: a.nums, source: "journal du " + c.date, auto: true };
      }
    });
  });
  Object.keys(arrivees).sort().forEach((k) => {
    const course = archive.get(k);
    const arr = arrivees[k].arrivee;
    if (!course || !arr || arr.length < 5 || bilan.some((b) => b.date === k)) return;
    const b = E.basesBilan(course, arr);
    if (process.argv.indexOf("--calibrage") > -1) b.calib = true;
    bilan.push(b);
    console.log("Bilan ajouté pour le " + k + " : arrivée " + arr.join("-"));
  });
  bilan.forEach((b) => {
    if (b.conf !== undefined) return;
    const c = archive.get(b.date);
    b.conf = c ? (E.basesConfiance(JSON.parse(JSON.stringify(c.horses))) || {}).niveau || null : null;
  });
  bilan.sort((a, b) => (a.date < b.date ? -1 : 1));
  fs.writeFileSync(ARR, JSON.stringify(arrivees, null, 1));
  fs.writeFileSync(BIL, JSON.stringify(bilan));
  if (!offline) fs.writeFileSync(path.join(ROOT, "data", "diagnostic.txt"), "Dernière exécution : " + new Date().toISOString() + "\n" + DIAG.filter((l) => !/polyfill|Require stack|^- /.test(l)).join("\n") + "\n");
  const arch = Array.from(archive.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
  fs.writeFileSync(ARCH, JSON.stringify(arch));

  // Dernières arrivées affichées sur le site
  const arrivList = Object.keys(arrivees).sort().reverse().slice(0, 8).map((k) => {
    const c = archive.get(k);
    const e = { date: k, jeu: arrivees[k].jeu || (c ? String(c.race.jeu).split(" ·")[0] : ""), race: c ? c.race.titre : "", arrivee: arrivees[k].arrivee };
    if (c) e.bases = E.basesPicks(JSON.parse(JSON.stringify(c.horses)), c, E.basesWeights()).top.map((h) => h.n);
    return e;
  });
  const json = (x) => JSON.stringify(x).replace(/</g, "\\u003c");
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(list));
  const tpl = fs.readFileSync(path.join(ROOT, "template.html"), "utf8");
  fs.writeFileSync(path.join(ROOT, "index.html"), tpl.replace("__COURSES_JSON__", () => json(list)).replace("__BILAN_JSON__", () => json(bilan)).replace("__ARRIVEES_JSON__", () => json(arrivList)));
  console.log("Site mis à jour : " + list.map((c) => c.date).join(", "));
}

module.exports = { candidates: candidates, readResult: readResult };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
