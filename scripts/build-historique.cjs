#!/usr/bin/env node
// Génère les 4 JSON du module Historique à partir de data/history/*.json.gz (collecte PMU déjà en place).
// Usage : node scripts/build-historique.cjs [--debut 2025-11-15] [--fin 2026-11-15]
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const H = require("../js/historique.js");
const D = path.join(__dirname, "..", "data");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > -1 ? process.argv[i + 1] : d; };
const fin = arg("fin", "9999-12-31");
const debut = arg("debut", new Date(Date.now() - 730 * 864e5).toISOString().slice(0, 10)); // 24 mois par défaut
const nrm = (s) => H.norm(s);

const courses = [], parcours = {};
fs.readdirSync(path.join(D, "history")).filter((f) => /^\d{4}-\d{2}\.json\.gz$/.test(f)).sort().forEach((f) => {
  JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(D, "history", f)))).forEach((c) => {
    if (c.date < debut || c.date > fin) return;
    const a = (c.arr || []).slice(0, 5);
    if (a.length < 5 || !a.every((x) => /^\d+$/.test(String(x)))) return;
    const part = (c.h || []).filter((h) => (h.st || "PARTANT") === "PARTANT").length || c.part;
    if (!part || part < 5) return;
    const nums = (c.h || []).filter((h) => (h.st || "PARTANT") === "PARTANT").map((h) => +h.n).sort((x, y) => x - y);
    if (nums.length !== part || a.some((x) => !nums.includes(+x))) return; // données incohérentes
    const absent = []; for (let i = 1; i <= nums[nums.length - 1]; i++) if (!nums.includes(i)) absent.push(i);
    courses.push({ date: c.date, hip: String(c.hip || "").toUpperCase(), disc: c.disc || "", part, arr: a.map(Number), nums, absent });
    (c.h || []).forEach((h) => { if (h.nom && h.pos != null) (parcours[nrm(h.nom)] = parcours[nrm(h.nom)] || []).push([c.date, c.hip, c.disc, c.dist || 0, h.pos, part, h.cote || 0]); });
  });
});
courses.sort((a, b) => (a.date < b.date ? -1 : 1));

// 1. arrivees_historique.json (format compact)
const hips = [...new Set(courses.map((c) => c.hip))].sort(), discs = [...new Set(courses.map((c) => c.disc))].sort();
fs.writeFileSync(path.join(D, "arrivees_historique.json"), JSON.stringify({ debut, fin: courses.length ? courses[courses.length - 1].date : null, hips, discs, courses: courses.map((c) => [c.date, hips.indexOf(c.hip), discs.indexOf(c.disc), c.part, ...c.arr, c.absent]) }));
// 2-3. stats par numéro et co-occurrences
const histo = H.construire(courses);
fs.writeFileSync(path.join(D, "stats_numeros.json"), JSON.stringify(H.exporterNumeros(histo)));
const pairs = H.exporterPaires(histo);
fs.writeFileSync(path.join(D, "cooccurrences.json"), JSON.stringify(pairs));
// 4. parcours : uniquement les chevaux des dernières courses de l'archive (pour garder un fichier léger)
const arch = JSON.parse(fs.readFileSync(path.join(D, "archive.json"), "utf8"));
const dates = [...new Set(arch.map((c) => c.date))].sort().slice(-3);
const out = {};
arch.filter((c) => dates.includes(c.date)).forEach((c) => c.horses.forEach((h) => {
  const s = (parcours[nrm(h.nom)] || []).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 10);
  if (!s.length) return;
  const top3 = s.filter((x) => x[4] >= 1 && x[4] <= 3).length, rec = s.slice(0, 3), anc = s.slice(3, 6);
  const moy = (a) => a.length ? a.reduce((t, x) => t + x[4] / x[5], 0) / a.length : null; // place relative (0 = gagnant)
  out[nrm(h.nom)] = { nom: h.nom, sorties: s, top3: s.length ? +(100 * top3 / s.length).toFixed(0) : null, progression: moy(rec) != null && moy(anc) != null ? +(moy(anc) - moy(rec)).toFixed(2) : null };
}));
fs.writeFileSync(path.join(D, "parcours.json"), JSON.stringify({ generé: new Date().toISOString().slice(0, 10), chevaux: out }));
console.log(`Courses : ${courses.length} (${debut} → ${courses.length ? courses[courses.length - 1].date : "-"}) · hippodromes : ${hips.length} · numéros : ${Object.keys(histo.global.num).length} · paires : ${pairs.paires.length} · chevaux (parcours) : ${Object.keys(out).length}`);
