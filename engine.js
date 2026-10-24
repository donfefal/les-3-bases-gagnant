// Moteur d'analyse des bases. Utilisé par la page (navigateur) et par scripts/update.cjs (bilan).
var _basesKey = typeof pjKey !== "undefined" ? pjKey : require("./parser.js").pjKey;

var BASES_FACTORS = [
  { k: "forme", label: "Forme récente", w: 30 },
  { k: "marche", label: "Avis du marché", w: 30 },
  { k: "classe", label: "Classe (gains)", w: 10 },
  { k: "poids", label: "Avantage de poids", w: 0 },
  { k: "apt", label: "Aptitudes du journal", w: 20 },
  { k: "ent", label: "Entourage", w: 0 },
  { k: "chrono", label: "Chrono (trot)", w: 0 }
];
var BASES_APT = [
  { k: "forme", label: "forme" }, { k: "classe", label: "classe" },
  { k: "progres", label: "progrès" }, { k: "regularite", label: "régularité" }
];
var BASES_PTS = { "1": 10, "2": 8, "3": 6, "4": 4, "5": 3, "6": 1, "7": 1, "8": 1, "9": 1 };

function basesOrd(n) { return n === 1 ? "1er" : n + "e"; }
function basesWeights() { var w = {}; BASES_FACTORS.forEach(function (f) { w[f.k] = f.w; }); return w; }
function basesMean(a) { return a.length ? a.reduce(function (x, y) { return x + y; }, 0) / a.length : 0; }
function basesPerson(rank, enForme) { return (rank ? 0.7 * (14 - rank) / 13 : 0) + (enForme ? 0.3 : 0); }
function basesForme(mus) {
  var t = mus.split(".").slice(0, 5), ws = 0, s = 0;
  t.forEach(function (c, i) { var w = 5 - i; ws += w; s += w * (BASES_PTS[c] || 0); });
  return ws ? s / (ws * 10) : 0;
}

// Note chaque partant (champs h.f, h.score, ...) et renvoie la liste classée par score.
function basesAnalyse(hs, info, W) {
  info = info || {};
  W = W || basesWeights();
  var lists = info.apt || {};
  var wkT = {}, wkJ = {}, fT = {}, fJ = {};
  ((info.week && info.week.trainers) || []).forEach(function (p) { wkT[_basesKey(p.name)] = p.rank; });
  ((info.week && info.week.jockeys) || []).forEach(function (p) { wkJ[_basesKey(p.name)] = p.rank; });
  ((info.enForme && info.enForme.trainers) || []).forEach(function (n) { fT[_basesKey(n)] = true; });
  ((info.enForme && info.enForme.jockeys) || []).forEach(function (n) { fJ[_basesKey(n)] = true; });

  var maxG = Math.max.apply(null, hs.map(function (h) { return h.gains; }));
  var maxP = Math.max.apply(null, hs.map(function (h) { return h.poids; }));
  var minP = Math.min.apply(null, hs.map(function (h) { return h.poids; }));
  hs.forEach(function (h) {
    h.pm = basesMean((h.cotes && h.cotes.length ? h.cotes : [h.cote]).map(function (c) { return 1 / (c + 1); }));
    var s = 0; h.cites = [];
    BASES_APT.forEach(function (a) {
      var pos = (lists[a.k] || []).indexOf(h.n);
      if (pos > -1) { s += (5 - pos) / 5; h.cites.push(a.label + " (" + basesOrd(pos + 1) + ")"); }
    });
    h.aptRaw = s / 4;
    var kt = _basesKey(h.ent), kj = _basesKey(h.jockey);
    h.rT = wkT[kt] || 0; h.rJ = wkJ[kj] || 0; h.fT = !!fT[kt]; h.fJ = !!fJ[kj];
  });
  var maxM = Math.max.apply(null, hs.map(function (h) { return h.pm; }));
  var maxA = Math.max.apply(null, hs.map(function (h) { return h.aptRaw; }));
  var chs = hs.map(function (h) { return h.chrono; }).filter(function (c) { return c > 0; });
  var maxC = chs.length ? Math.max.apply(null, chs) : 0, minC = chs.length ? Math.min.apply(null, chs) : 0;
  var useC = chs.length >= 3;
  var tot = 0; BASES_FACTORS.forEach(function (f) { if (f.k !== "chrono" || useC) tot += W[f.k]; });
  tot = tot || 1;
  hs.forEach(function (h) {
    h.f = {
      forme: basesForme(h.mus),
      marche: maxM ? h.pm / maxM : 0,
      classe: maxG ? h.gains / maxG : 0,
      poids: maxP > minP ? (maxP - h.poids) / (maxP - minP) : 0.5,
      apt: maxA ? h.aptRaw / maxA : 0,
      ent: (basesPerson(h.rT, h.fT) + basesPerson(h.rJ, h.fJ)) / 2,
      chrono: useC ? (h.chrono > 0 ? (maxC > minC ? (maxC - h.chrono) / (maxC - minC) : 0.5) : 0) : 0
    };
    var s = 0; BASES_FACTORS.forEach(function (f) { if (f.k !== "chrono" || useC) s += W[f.k] * h.f[f.k]; });
    h.score = 100 * s / tot;
  });
  return hs.slice().sort(function (a, b) { return b.score - a.score; });
}

// Trois bases, complément (rangs 4 à 6) et outsiders (cote d'au moins 20/1).
function basesPicks(hs, info, W) {
  var r = basesAnalyse(hs, info, W), top = r.slice(0, 3), rest = r.slice(3), comp = rest.slice(0, 3);
  var outs = rest.filter(function (h) { return h.cote >= 20 && comp.indexOf(h) === -1; }).slice(0, 3);
  return { ranked: r, top: top, comp: comp, outs: outs };
}


// Indice de confiance : plus le marché se concentre sur 3 chevaux, plus les bases ont réussi dans le passé.
// Seuils et taux mesurés sur plus de 6 000 courses PMU (cotes de référence), séparés selon la taille du champ.
var BASES_CONFIANCE = {
  gros: { min: 13, seuils: [0.40, 0.49], taux: [51, 57, 72] },
  petit: { min: 0, seuils: [0.58, 0.685], taux: [67, 77, 83] }
};
function basesConfiance(hs) {
  var ip = hs.filter(function (h) { return h.cote > 0 && h.cote < 400; }).map(function (h) { return 1 / (h.cote + 1); });
  if (ip.length < 8 || ip.length < 0.8 * hs.length) return null;
  var tot = ip.reduce(function (a, b) { return a + b; }, 0);
  ip.sort(function (a, b) { return b - a; });
  var p3 = (ip[0] + ip[1] + ip[2]) / tot;
  var set = hs.length >= BASES_CONFIANCE.gros.min ? BASES_CONFIANCE.gros : BASES_CONFIANCE.petit;
  var i = p3 < set.seuils[0] ? 0 : p3 < set.seuils[1] ? 1 : 2;
  return { niveau: ["faible", "moyenne", "forte"][i], taux: set.taux[i], hasard: Math.round(500 / hs.length), p3: Math.round(p3 * 100) / 100 };
}

// Compare les choix du site à l'arrivée officielle (les cinq premiers numéros).
function basesBilan(course, arrivee, W) {
  var hs = JSON.parse(JSON.stringify(course.horses));
  var p = basesPicks(hs, course, W || basesWeights());
  function nums(a) { return a.map(function (h) { return h.n; }); }
  function inter(a, b) { return a.filter(function (x) { return b.indexOf(x) > -1; }).length; }
  var arr = arrivee.slice(0, 5), bases = nums(p.top), comp = nums(p.comp), outs = nums(p.outs);
  return {
    date: course.date, race: course.race.titre, partants: hs.length,
    bases: bases, comp: comp, outs: outs, arrivee: arr,
    conf: (basesConfiance(hs) || {}).niveau || null,
    hitsBases: inter(bases, arr), hitsSel: inter(bases.concat(comp, outs), arr), hitsTop5: inter(nums(p.ranked.slice(0, 5)), arr)
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { BASES_FACTORS: BASES_FACTORS, BASES_APT: BASES_APT, basesAnalyse: basesAnalyse, basesPicks: basesPicks, basesBilan: basesBilan, basesConfiance: basesConfiance, basesWeights: basesWeights };
}
