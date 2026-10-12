#!/usr/bin/env node
// Teste le modèle sur toutes les courses archivées dont l'arrivée (5 premiers) est connue.
// Usage : node scripts/backtest.cjs
const fs = require("fs");
const path = require("path");
const E = require("../engine.js");
const D = path.join(__dirname, "..", "data");
const arch = JSON.parse(fs.readFileSync(path.join(D, "archive.json"), "utf8"));
const arr = JSON.parse(fs.readFileSync(path.join(D, "arrivees.json"), "utf8"));
const races = arch.filter((c) => arr[c.date] && arr[c.date].arrivee.length >= 5);

function evalW(W, subset) {
  let hb = 0, h5 = 0, hs = 0, exp5 = 0, rankSum = 0, winRank = 0, n = 0, avgP = 0;
  (subset || races).forEach((c) => {
    const a = arr[c.date].arrivee.slice(0, 5);
    const hs0 = JSON.parse(JSON.stringify(c.horses));
    const p = E.basesPicks(hs0, c, W);
    const nums = (l) => l.map((h) => h.n);
    const inter = (x, y) => x.filter((v) => y.indexOf(v) > -1).length;
    hb += inter(nums(p.top), a);
    h5 += inter(nums(p.ranked.slice(0, 5)), a);
    hs += inter(nums(p.top).concat(nums(p.comp), nums(p.outs)), a);
    const order = nums(p.ranked);
    a.forEach((x) => { rankSum += order.indexOf(x) + 1; });
    winRank += order.indexOf(a[0]) + 1;
    exp5 += 25 / c.horses.length;
    avgP += (c.horses.length + 1) / 2 * 5;
    n++;
  });
  return { n, hb, h5, hs, exp5: +exp5.toFixed(1), meanRank: +(rankSum / (5 * n)).toFixed(2), randRank: +(avgP / (5 * n)).toFixed(2), winRank: +(winRank / n).toFixed(1) };
}
const base = E.basesWeights();
const zero = () => { const w = {}; Object.keys(base).forEach((k) => { w[k] = 0; }); return w; };
const show = (label, r) => console.log(label.padEnd(26), "courses", r.n, "| top5:", r.h5, "(hasard", r.exp5 + ")", "| bases:", r.hb, "| sélection:", r.hs, "| rang moyen des 5 arrivés:", r.meanRank, "(hasard", r.randRank + ")", "| rang du gagnant:", r.winRank);
console.log(races.length + " courses : " + races.map((c) => c.date.slice(5) + (c.race.type === "trot" ? "T" : "G")).join(" "));
show("Réglage actuel", evalW(base));
console.log("— un seul critère à la fois —");
Object.keys(base).forEach((k) => { const w = zero(); w[k] = 1; show(k, evalW(w)); });
console.log("— un critère retiré —");
Object.keys(base).forEach((k) => { const w = Object.assign({}, base); w[k] = 0; show("sans " + k, evalW(w)); });
if (process.argv.indexOf("--par-type") > -1) {
  ["galop", "trot"].forEach((t) => show("type " + t, evalW(base, races.filter((c) => c.race.type === t))));
}
module.exports = { evalW, races };
