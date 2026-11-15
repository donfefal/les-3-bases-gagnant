/* Module « Historique » : statistiques par numéro, co-occurrences, score historique et backtest.
 * 100 % statique : fonctionne dans le navigateur (global `Historique`) et sous Node (require).
 * Une course = { date:"AAAA-MM-JJ", hip:"VINCENNES", disc:"ATTELE", part:16, arr:[n1..n5], nums:[numéros des partants] }  (arr = 5 premiers, dans l'ordre).
 * Les statistiques comparent toujours le taux observé au « hasard » (5 / nombre de partants). */
(function (root, factory) {
  var H = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = H; else root.Historique = H;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var POIDS_FREQ = { global: 0.3, hip: 0.4, disc: 0.3 };   // pondération de la fréquence top 5
  var POIDS_COMPOSANTES = { freq: 0.6, co: 0.2, reg: 0.2 }; // fréquence, co-occurrences, régularité

  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function norm(s) { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z]/g, ""); }

  // ---- Décodage du fichier compact arrivees_historique.json : { hips:[], discs:[], courses:[[date,hi,di,part,a1..a5]] }
  function decoder(f) {
    return f.courses.map(function (r) {
      var abs = r[9] || [], nums = [], n, max = r[3] + abs.length;
      for (n = 1; n <= max; n++) if (abs.indexOf(n) === -1) nums.push(n);
      return { date: r[0], hip: f.hips[r[1]], disc: f.discs[r[2]], part: r[3], arr: r.slice(4, 9), nums: nums };
    });
  }

  // ---- Compteurs incrémentaux
  function nouvelleStats() { return { nb: 0, num: {}, paires: {} }; }
  function entree(S, n) { return S.num[n] || (S.num[n] = { s: 0, t: 0, e: 0, gapSum: 0, gapN: 0, lastTop: -1, derniere: "" }); }

  // Ajoute une course aux compteurs d'un périmètre (avec les paires si `avecPaires`).
  function ajouter(S, c, avecPaires) {
    var p = c.part, top = c.arr, N = nums(c), a, b, i, j, e, k;
    S.nb++;
    for (a = 0; a < N.length; a++) {
      i = N[a]; e = entree(S, i); e.s++; e.e += 5 / p;
      if (top.indexOf(i) > -1) {
        e.t++; e.derniere = c.date;
        if (e.lastTop > -1) { e.gapSum += e.s - e.lastTop; e.gapN++; }
        e.lastTop = e.s;
      }
    }
    if (avecPaires) {
      var pe = 20 / (p * (p - 1));
      for (a = 0; a < N.length; a++) for (b = a + 1; b < N.length; b++) {
        i = N[a]; j = N[b]; k = i + "-" + j; e = S.paires[k] || (S.paires[k] = { s: 0, t: 0, e: 0 });
        e.s++; e.e += pe;
        if (top.indexOf(i) > -1 && top.indexOf(j) > -1) e.t++;
      }
    }
  }
  function nums(c) { if (c.nums) return c.nums; var r = [], i; for (i = 1; i <= c.part; i++) r.push(i); return r; }
  function lire(S, n) {
    var e = S && S.num[n];
    if (!e || !e.s) return null;
    return { sorties: e.s, top5: e.t, taux: 100 * e.t / e.s, hasard: 100 * e.e / e.s, ecart: e.gapN ? e.gapSum / e.gapN : null, derniere: e.derniere };
  }
  function lirePaire(S, a, b) {
    var e = S && S.paires[(a < b ? a + "-" + b : b + "-" + a)];
    if (!e || e.s < 30) return null;
    return { ensemble: e.s, co: e.t, taux: 100 * e.t / e.s, hasard: 100 * e.e / e.s };
  }

  // ---- Construction de tous les périmètres (global, par hippodrome, par discipline) à partir d'une liste de courses
  function construire(courses, filtre) {
    filtre = filtre || {};
    var H = { nbCourses: 0, global: nouvelleStats(), hip: {}, disc: {} };
    courses.forEach(function (c) {
      if (filtre.depuis && c.date < filtre.depuis) return;
      if (filtre.hip && c.hip !== filtre.hip) return;
      if (filtre.disc && c.disc !== filtre.disc) return;
      H.nbCourses++;
      ajouter(H.global, c, true);
      ajouter(H.hip[c.hip] || (H.hip[c.hip] = nouvelleStats()), c, false);
      ajouter(H.disc[c.disc] || (H.disc[c.disc] = nouvelleStats()), c, false);
    });
    return H;
  }

  // ---- Export JSON final (stats_numeros.json, cooccurrences.json)
  function exporterNumeros(H) {
    function bloc(S) { var o = {}; Object.keys(S.num).forEach(function (n) { var r = lire(S, n); if (r) o[n] = { sorties: r.sorties, top5: r.top5, taux: +r.taux.toFixed(2), hasard: +r.hasard.toFixed(2), ecart: r.ecart == null ? null : +r.ecart.toFixed(2), derniere: r.derniere }; }); return { courses: S.nb, numeros: o }; }
    var out = { nbCourses: H.nbCourses, global: bloc(H.global), hippodromes: {}, disciplines: {} };
    Object.keys(H.hip).forEach(function (h) { if (H.hip[h].nb >= 30) out.hippodromes[h] = bloc(H.hip[h]); });
    Object.keys(H.disc).forEach(function (d) { out.disciplines[d] = bloc(H.disc[d]); });
    return out;
  }
  function exporterPaires(H) {
    var arr = [];
    Object.keys(H.global.paires).forEach(function (k) { var p = k.split("-"), r = lirePaire(H.global, +p[0], +p[1]); if (r) arr.push({ a: +p[0], b: +p[1], ensemble: r.ensemble, co: r.co, taux: +r.taux.toFixed(2), hasard: +r.hasard.toFixed(2) }); });
    return { nbCourses: H.nbCourses, paires: arr };
  }

  // ---- Score historique 0-100 d'un numéro (50 = neutre quand les données manquent)
  // histo : { global:{numeros}, hippodromes:{}, disciplines:{} } (stats_numeros.json) + { paires } (cooccurrences.json) ; lecture via `acces`.
  function scoreDepuisLecteurs(numero, partantsDuJour, L) {
    var rg = L.global(numero), rh = L.hip(numero), rd = L.disc(numero);
    var parts = [[rg, POIDS_FREQ.global], [rh, POIDS_FREQ.hip], [rd, POIDS_FREQ.disc]].filter(function (x) { return x[0]; });
    var freq = 50, reg = 50, co = 50;
    if (parts.length) {
      var tw = parts.reduce(function (s, x) { return s + x[1]; }, 0);
      freq = clamp(50 + 3 * parts.reduce(function (s, x) { return s + x[1] * (x[0].taux - x[0].hasard); }, 0) / tw, 0, 100);
    }
    if (rg && rg.ecart) { var attendu = 100 / rg.hasard; reg = clamp(50 + 50 * (attendu / rg.ecart - 1), 0, 100); }
    var d = [];
    (partantsDuJour || []).forEach(function (n) { if (n !== numero) { var r = L.paire(numero, n); if (r) d.push(r.taux - r.hasard); } });
    if (d.length) co = clamp(50 + 4 * d.reduce(function (s, x) { return s + x; }, 0) / d.length, 0, 100);
    return POIDS_COMPOSANTES.freq * freq + POIDS_COMPOSANTES.co * co + POIDS_COMPOSANTES.reg * reg;
  }
  function scoreHistorique(numero, hippodrome, discipline, partantsDuJour, histo) {
    if (!histo || !histo.global) return 50;
    var pair = {};
    (histo.paires || []).forEach(function (p) { pair[p.a + "-" + p.b] = p; });
    return scoreDepuisLecteurs(numero, partantsDuJour, {
      global: function (n) { return histo.global.numeros[n] || null; },
      hip: function (n) { var h = histo.hippodromes && histo.hippodromes[hippodrome]; return h && h.numeros[n] || null; },
      disc: function (n) { var h = histo.disciplines && histo.disciplines[discipline]; return h && h.numeros[n] || null; },
      paire: function (a, b) { return pair[(a < b ? a + "-" + b : b + "-" + a)] || null; }
    });
  }

  // Fusionne le score actuel (partant.score, 0-100) et le score historique ; retourne les partants triés.
  // poidsHisto : 0 à 1 (0,3 par défaut = 70 % actuel / 30 % historique).
  function recalculerScoresAvecHistorique(partants, hippodrome, discipline, histo, poidsHisto) {
    var w = poidsHisto == null ? 0.3 : clamp(poidsHisto, 0, 1);
    var nums = partants.map(function (h) { return h.n; });
    var pair = {};
    ((histo && histo.paires) || []).forEach(function (p) { pair[p.a + "-" + p.b] = p; });
    var out = partants.map(function (h) {
      var base = h.scoreBase != null ? h.scoreBase : h.score;
      var sh = scoreHistorique(h.n, hippodrome, discipline, nums, { global: histo && histo.global, hippodromes: histo && histo.hippodromes, disciplines: histo && histo.disciplines, paires: histo && histo.paires });
      var c = {}; for (var k in h) c[k] = h[k];
      c.scoreBase = base; c.scoreHisto = sh; c.score = (1 - w) * base + w * sh;
      return c;
    });
    return out.sort(function (a, b) { return b.score - a.score; });
  }

  // ---- Backtest « walk-forward » : chaque course est notée avec les seules courses qui la précèdent.
  // options : { depuis, minCourses (défaut 300), nbBases (défaut 3), rapports:{date:rapportDésordre}, mise }
  function backtest(courses, options) {
    var o = options || {}, k = o.nbBases || 3, minC = o.minCourses == null ? 300 : o.minCourses;
    var G = nouvelleStats(), HP = {}, DS = {}, n = 0, gagnants = 0, hits = 0, hitsHasard = 0, gagHasard = 0, mise = 0, gain = 0, avecRapport = 0, i;
    var cs = courses.filter(function (c) { return !o.depuis || c.date >= o.depuis; }).slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    function comb(a, b) { var r = 1; for (var x = 1; x <= b; x++) r = r * (a - b + x) / x; return r; }
    cs.forEach(function (c) {
      if (G.nb >= minC && c.part >= 8) {
        var hs = HP[c.hip], ds = DS[c.disc], nums = [], sc = [];
        nums = c.nums || [];
        if (!nums.length) for (i = 1; i <= c.part; i++) nums.push(i);
        var L = { global: function (x) { return lire(G, x); }, hip: function (x) { return lire(hs, x); }, disc: function (x) { return lire(ds, x); }, paire: function (a, b) { return lirePaire(G, a, b); } };
        nums.forEach(function (x) { sc.push({ n: x, s: scoreDepuisLecteurs(x, nums, L) }); });
        sc.sort(function (a, b) { return b.s - a.s; });
        var picks = sc.slice(0, k).map(function (x) { return x.n; });
        var h = picks.filter(function (x) { return c.arr.indexOf(x) > -1; }).length;
        n++; hits += h; hitsHasard += k * 5 / c.part; gagHasard += comb(5, k) / comb(c.part, k);
        if (h === k) {
          gagnants++;
          if (o.rapports && o.rapports[c.date]) { gain += o.rapports[c.date]; }
        }
        if (o.rapports && o.rapports[c.date]) { avecRapport++; mise += o.mise || 300; }
      }
      ajouter(G, c, true);
      ajouter(HP[c.hip] || (HP[c.hip] = nouvelleStats()), c, false);
      ajouter(DS[c.disc] || (DS[c.disc] = nouvelleStats()), c, false);
    });
    return {
      courses: n, gagnants: gagnants, tauxReussite: n ? 100 * gagnants / n : 0, tauxHasard: n ? 100 * gagHasard / n : 0,
      basesDansTop5: n ? 100 * hits / (n * k) : 0, basesDansTop5Hasard: n ? 100 * hitsHasard / (n * k) : 0,
      roi: avecRapport ? 100 * (gain - mise) / mise : null, miseTotale: avecRapport ? mise : null, gainTotal: avecRapport ? gain : null, coursesAvecRapport: avecRapport
    };
  }

  return { decoder: decoder, construire: construire, exporterNumeros: exporterNumeros, exporterPaires: exporterPaires, scoreHistorique: scoreHistorique, recalculerScoresAvecHistorique: recalculerScoresAvecHistorique, backtest: backtest, lire: lire, lirePaire: lirePaire, norm: norm, POIDS_FREQ: POIDS_FREQ, POIDS_COMPOSANTES: POIDS_COMPOSANTES };
});
