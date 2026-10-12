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
  return folders.map((f) => BASE + f + "/" + name);
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
  for (let off = 0; off <= (offline ? -1 : LOOKAHEAD_DAYS); off++) {
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
  Array.from(archive.values()).forEach((c) => {
    (c.arrivals || []).forEach((a) => {
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
  bilan.sort((a, b) => (a.date < b.date ? -1 : 1));
  fs.writeFileSync(ARR, JSON.stringify(arrivees, null, 1));
  fs.writeFileSync(BIL, JSON.stringify(bilan));
  const arch = Array.from(archive.values()).sort((a, b) => (a.date < b.date ? -1 : 1));
  fs.writeFileSync(ARCH, JSON.stringify(arch));

  const json = (x) => JSON.stringify(x).replace(/</g, "\\u003c");
  fs.mkdirSync(path.dirname(DATA), { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify(list));
  const tpl = fs.readFileSync(path.join(ROOT, "template.html"), "utf8");
  fs.writeFileSync(path.join(ROOT, "index.html"), tpl.replace("__COURSES_JSON__", () => json(list)).replace("__BILAN_JSON__", () => json(bilan)));
  console.log("Site mis à jour : " + list.map((c) => c.date).join(", "));
}

module.exports = { candidates: candidates };
if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
