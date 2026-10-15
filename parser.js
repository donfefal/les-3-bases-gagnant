// Lecteur du journal hippique PMU'B (LONAB). Utilisé par la page et par scripts/update.cjs.
var PJ_MONTHS = { janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6, juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12 };
function pjIso(y, mo, d) {
  var n = PJ_MONTHS[String(mo).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
  return n ? y + "-" + String(n).padStart(2, "0") + "-" + String(d).padStart(2, "0") : "";
}
var PJ_PART = { de: 1, des: 1, du: 1, la: 1, le: 1, les: 1, et: 1, au: 1, aux: 1, sur: 1, en: 1 };
function pjKey(s) { return String(s || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z&]/g, "").split("").sort().join(""); }
function pjNum(s) { return parseFloat(String(s).replace(/\s/g, "").replace(",", ".")); }
function pjLines(items, tol) {
  var its = items.slice().sort(function (a, b) { return (b.y - a.y) || (a.x - b.x); }), lines = [], cur = null;
  its.forEach(function (it) {
    if (cur && Math.abs(cur.y - it.y) <= tol) { cur.items.push(it); } else { cur = { y: it.y, items: [it] }; lines.push(cur); }
  });
  lines.forEach(function (l) {
    l.items.sort(function (a, b) { return a.x - b.x; });
    l.text = l.items.map(function (i) { return i.s; }).join(" ").replace(/\s+/g, " ").trim();
  });
  return lines;
}
function pjCluster(xs, gap) {
  var s = xs.slice().sort(function (a, b) { return a - b; }), cl = [];
  s.forEach(function (x) { if (cl.length && x - cl[cl.length - 1].max <= gap) { cl[cl.length - 1].max = x; } else { cl.push({ min: x, max: x }); } });
  return cl;
}
function pjTitle(s, roman) {
  s = String(s).replace(/\s*\.\s*/g, ". ").replace(/\s+/g, " ").trim();
  var w = s.toLowerCase().split(" ");
  return w.map(function (t, i) {
    if (roman && /^\(?[ivx]{2,}\)?$/.test(t)) return t.toUpperCase();
    if (i > 0 && PJ_PART[t] && !/^[a-zà-ÿ]\.$/.test(w[i - 1])) return t;
    return t.replace(/(^|[\-'’(])([a-zà-ÿ])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }).join(" ").replace(/(\S+)\s+D(['’])$/, "D$2$1");
}
function pjList(txt, name) {
  var m = txt.match(new RegExp("(?:^|\\s)" + name + "\\s*:\\s*((?:\\d+\\s*[–\\-]\\s*)+\\d+)", "i"));
  return m ? m[1].split(/\s*[–\-]\s*/).map(Number) : [];
}

// Toutes les arrivées publiées dans le journal (bloc « Résultats des courses » et ligne « Arrivée du … »).
function pjArrivals(all) {
  var G = "4\\+1|QUART[ÉE]|QUINT[ÉE]\\+?|TIERC[ÉE]", D = "LUNDI|MARDI|MERCREDI|JEUDI|VENDREDI|SAMEDI|DIMANCHE";
  var by = {};
  function put(iso, nums) { if (iso && nums.length >= 3 && (!by[iso] || by[iso].length < nums.length)) by[iso] = nums; }
  var re = new RegExp("(?:" + G + ")\\W*\\s+DU\\s+(?:" + D + ")\\s+(\\d{2})\\/(\\d{2})\\/(\\d{4})", "gi"), ms = [], m;
  while ((m = re.exec(all))) ms.push(m);
  ms.forEach(function (mm, i) {
    var tail = all.slice(mm.index, i + 1 < ms.length ? ms[i + 1].index : all.length);
    var a = tail.match(/Arriv[ée]e\s*:\s*((?:\d+\s*[-–]\s*)+\d+)/i);
    if (!a) return;
    var nums = a[1].split(/\s*[-–]\s*/).map(Number);
    var f = tail.match(/SUITE\s+DE\s+L.ARRIV[ÉE]E.{0,400}?\b5\s*[èe]x?\s*:\s*(\d{1,2})\b/i);
    if (nums.length === 4 && f) nums.push(+f[1]);
    put(mm[3] + "-" + mm[2] + "-" + mm[1], nums);
  });
  var re2 = new RegExp("ARRIV[ÉE]E\\s+DU\\s+\\W*(?:" + G + ")\\W*\\s+DU\\s+(?:" + D + ")\\s+(\\d{1,2})\\s+([A-ZÉÛ]+)\\s+(\\d{4})\\s*:\\s*((?:\\d+\\s*-\\s*)*\\d+)", "gi");
  while ((m = re2.exec(all))) put(pjIso(m[3], m[2], m[1]), m[4].split(/\s*[-–]\s*/).map(Number));
  return Object.keys(by).sort().map(function (k) { return { iso: k, nums: by[k] }; });
}
function parseJournal(pages) {
  var res = { ok: false, error: "" };
  var tp = null, hdr = null;
  pages.forEach(function (pg) {
    if (tp) return;
    var h = pg.items.filter(function (i) { return i.s.trim() === "N°"; })[0];
    if (h) { tp = pg; hdr = h; }
  });
  if (!tp) { res.error = "Tableau des partants introuvable."; return res; }
  var tx = tp.width * 0.52;

  // 1. tableau des partants
  var nums = tp.items.filter(function (i) { return /^\d{1,2}$/.test(i.s.trim()) && Math.abs(i.x - hdr.x) <= 15 && i.y < hdr.y; });
  var rows = nums.map(function (nm) {
    var r = { n: parseInt(nm.s, 10), text: [], cotes: [] };
    tp.items.forEach(function (c) {
      if (c === nm || Math.abs(c.y - nm.y) > 3 || c.x <= nm.x + 5 || c.x >= tx) return;
      var s = c.s.trim();
      if (/^[HFM]\.\d{1,2}$/i.test(s)) { r.sexe = s; }
      else if (/^\d[\s\d]{2,6}\.?\s*M$/i.test(s)) { r.dist = pjNum(s.replace(/\D/g, "")); }
      else if (/^\d\.\d{2}\.\d{2}$/.test(s)) { var cp = s.split("."); r.chrono = +cp[0] * 60 + +cp[1] + +cp[2] / 100; }
      else if (/KG$/i.test(s)) { r.poids = pjNum(s.replace(/\.?KG/i, "")); }
      else if (/^[0-9A-Z](\.[0-9A-Z]){2,}$/.test(s)) { r.mus = s; r.musx = c.x; }
      else if (/^\d{1,3}(\s\d{3})+$|^\d{4,}$/.test(s)) { r.gains = pjNum(s); }
      else if (/^\d+(?:[.,]\d+)?\/\d+$/.test(s)) { r.cotes.push({ x: c.x, v: pjNum(s.split("/")[0]) }); }
      else { r.text.push(c); }
    });
    r.cotes.sort(function (a, b) { return a.x - b.x; });
    var gp = r.text.filter(function (c) { return /^\d{1,3}$/.test(c.s.trim()) && r.musx && c.x > r.musx; });
    if (gp.length) {
      r.text = r.text.filter(function (c) { return gp.indexOf(c) < 0; });
      if (!r.gains) r.gains = pjNum(gp.sort(function (a, b) { return a.x - b.x; }).map(function (c) { return c.s.trim(); }).join(""));
    }
    return r;
  }).filter(function (r) { return r.mus && (r.poids || r.dist); });
  var trot = rows.some(function (r) { return r.dist && !r.poids; });
  if (rows.length < 4) { res.error = "Moins de 4 partants lisibles dans le tableau."; return res; }

  var xs = []; rows.forEach(function (r) { r.text.forEach(function (c) { xs.push(c.x); }); });
  var starts = pjCluster(xs, 12).map(function (c) { return c.min; });
  var horses = rows.map(function (r) {
    var cols = ["", "", "", ""];
    r.text.sort(function (a, b) { return a.x - b.x; }).forEach(function (c) {
      var k = 0; starts.forEach(function (st, i) { if (st <= c.x + 4) k = i; });
      if (k > 3) k = 3;
      cols[k] = (cols[k] + " " + c.s).trim();
    });
    var cotes = r.cotes.map(function (c) { return c.v; });
    return {
      n: r.n, nom: pjTitle(cols[0]), jockey: pjTitle(cols[1]), ent: pjTitle(cols[2]),
      poids: r.poids || r.dist, dist: r.dist || 0, chrono: r.chrono || 0, mus: r.mus, gains: r.gains || 0,
      cotes: cotes, cote: cotes.length ? cotes[0] : 50,
      coteTxt: cotes.length ? cotes.map(function (c) { return c + "/1"; }).join(" · ") : "—"
    };
  }).sort(function (a, b) { return a.n - b.n; });

  // 2. en-tête de la course
  var race = { type: trot ? "trot" : "galop", jeu: "4+1", titre: "Course du journal", details: horses.length + " partants", arret: "" };
  var found = false;
  pages.forEach(function (pg) {
    if (found) return;
    var ls = pjLines(pg.items.filter(function (i) { return i.x > pg.width * 0.5; }), 3);
    for (var k = 0; k < ls.length; k++) {
      var m = ls[k].text.match(/^\W*(?:SP[ÉE]CIAL\s+)?\W*(?:4\+1|QUART[ÉE]|QUINT[ÉE]\+?|TIERC[ÉE])\W*\s+(?:SP[ÉE]CIAL\s+)?DU\s+(LUNDI|MARDI|MERCREDI|JEUDI|VENDREDI|SAMEDI|DIMANCHE)\s+(\d{1,2})\s+([A-ZÉÛ]+)\s+(\d{4})/i);
      if (!m) continue;
      found = true;
      race.jeu = (/QUART[ÉE]/i.test(ls[k].text) ? "Quarté" : /TIERC[ÉE]/i.test(ls[k].text) ? "Tiercé" : /QUINT[ÉE]/i.test(ls[k].text) ? "Quinté+" : "4+1") + " · " + m[1].toLowerCase() + " " + m[2] + " " + m[3].toLowerCase() + " " + m[4];
      race.iso = pjIso(m[4], m[3], m[2]);
      var t = (ls[k + 1] && ls[k + 1].text) || "";
      var sp = t.split(/\s+-\s+/);
      race.titre = sp.length > 1 ? pjTitle(sp[0]) + " · " + pjTitle(sp.slice(1).join(" - "), true) : pjTitle(t, true);
      var d = (ls[k + 2] && ls[k + 2].text) || "", dd = (ls[k + 3] && ls[k + 3].text) || "";
      var md = d.match(/(\d+)\s+CONCURRENTS?.*?COURSE\s*-\s*(.+)$/i);
      var mm = dd.match(/([\d\s]+?)\s*EUROS.*?([\d\s]+?)\s*M[ÈE]TRES/i);
      var parts = [];
      if (md) parts.push(pjTitle(md[2]).replace(/Steeple Chase/i, "Steeple-chase").replace(/^Attele$/i, "Attelé"));
      if (mm) parts.push(mm[2].replace(/\s+/g, " ").trim() + " m");
      parts.push((md ? md[1] : horses.length) + " partants");
      if (mm) parts.push(mm[1].replace(/\s+/g, " ").trim() + " €");
      race.details = parts.join(" · ");
      break;
    }
  });
  var all = pages.map(function (pg) { return pjLines(pg.items, 3).map(function (l) { return l.text; }).join(" "); }).join(" ");
  var ar = all.match(/ARR[ÊE]T\s+DES\s+JEUX[^0-9]*(\d{1,2})\s*h\s*(\d{2})/i);
  var dp = all.match(/D[ÉE]PART\s+DE\s+LA\s+COURSE[^0-9]*(\d{1,2})\s*h\s*(\d{2})/i);
  if (dp) race.details += " · départ " + dp[1] + " h " + dp[2];
  if (ar) race.arret = "Arrêt des jeux " + ar[1] + " h " + ar[2];

  // 3. aptitudes, entraîneurs et jockeys
  var info = { race: race, horses: horses, apt: { forme: [], classe: [], progres: [], regularite: [] }, week: { trainers: [], jockeys: [] }, enForme: { trainers: [], jockeys: [] }, result: null };
  var rl = pjLines(tp.items.filter(function (i) { return i.x > tp.width * 0.5; }), 3).map(function (l) { return l.text; }).join(" ");
  info.apt.forme = pjList(rl, "FORME");
  info.apt.classe = pjList(rl, "CLASSE");
  info.apt.progres = pjList(rl, "PROGR[ÈE]S");
  info.apt.regularite = pjList(rl, "R[ÉE]GULARIT[ÉE]");

  var hT = tp.items.filter(function (i) { return /ENTRA[IÎ]NEURS\s+EN\s+FORME/i.test(i.s); })[0];
  var hJ = tp.items.filter(function (i) { return /(JOCKEYS|DRIVERS)\s+EN\s+FORME/i.test(i.s); })[0];
  var fav = tp.items.filter(function (i) { return /FAVORIS/i.test(i.s); })[0];
  function names(its) { return its.sort(function (a, b) { return (b.y - a.y) || (a.x - b.x); }).map(function (i) { return i.s; }).join(" ").split(/\s+[–-]\s+/).map(function (s) { return s.replace(/\s+/g, " ").trim(); }).filter(Boolean); }
  if (hT && hJ) {
    info.enForme.trainers = names(tp.items.filter(function (i) { return i.x >= hT.x - 6 && i.y < hT.y - 1 && i.y > hJ.y + 1; }));
    info.enForme.jockeys = names(tp.items.filter(function (i) { return i.x >= hJ.x - 6 && i.y < hJ.y - 1 && i.y > (fav ? fav.y + 1 : hJ.y - 40) && !/FAVORIS/i.test(i.s); }));
  }
  var hW = tp.items.filter(function (i) { return /MEILLEURS\s+DE\s+LA\s+SEMAINE/i.test(i.s); })[0];
  if (hW) {
    var wk = tp.items.filter(function (i) { return i.x < tx && i.y < hW.y - 1 && i.y > hW.y - 130 && /^\s*\d{1,2}\s*-\s*[A-Za-zÀ-ÿ]/.test(i.s); });
    var cl = pjCluster(wk.map(function (i) { return i.x; }), 12);
    if (cl.length >= 4) {
      var bound = (cl[1].max + cl[2].min) / 2;
      wk.forEach(function (i) {
        var m = i.s.match(/^\s*(\d{1,2})\s*-\s*(.+)$/);
        (i.x < bound ? info.week.trainers : info.week.jockeys).push({ rank: parseInt(m[1], 10), name: m[2].replace(/\s+/g, " ").trim() });
      });
    }
  }

  // 4. dernier résultat publié
  var rm = all.match(/(?:4\+1|QUART[ÉE]|QUINT[ÉE]\+?|TIERC[ÉE])\W*\s+DU\s+(LUNDI|MARDI|MERCREDI|JEUDI|VENDREDI|SAMEDI|DIMANCHE)\s+(\d{2}\/\d{2}\/\d{4})/i);
  if (rm) {
    var tail = all.slice(rm.index);
    var a = tail.match(/Arriv[ée]e\s*:\s*((?:\d+\s*-\s*)+\d+)/i);
    var o = tail.match(/\bOrdre\s*:\s*(N[ée]ant|[\d\s]+?F)(?:\s*\(\s*([\d\s]+?)\s*G\s*\))?/);
    var ds = tail.match(/D[ée]sordre\s*:\s*([\d\s]+?F)\s*\(\s*([\d\s]+?)\s*G\s*\)/);
    var bo = tail.match(/Bonus\s*:\s*([\d\s]+?F)\s*\(\s*([\d\s]+?)\s*G\s*\)/);
    var fifth = tail.match(/SUITE\s+DE\s+L.ARRIV[ÉE]E.{0,400}?\b5\s*[èe]x?\s*:\s*(\d{1,2})\b/i);
    if (a) {
      info.result = {
        date: rm[1].toLowerCase() + " " + rm[2],
        arrivee: a[1].split(/\s*-\s*/).concat(a[1].split(/\s*-\s*/).length === 4 && fifth ? [fifth[1]] : []).join(" · "),
        ordre: o ? (/N[ée]ant/i.test(o[1]) ? "Aucun gagnant" : o[1].replace(/\s+/g, " ") + " CFA" + (o[2] ? " (" + o[2].replace(/\s+/g, " ") + " gagnants)" : "")) : "",
        desordre: ds ? ds[1].replace(/\s+/g, " ") + " CFA (" + ds[2].replace(/\s+/g, " ") + " gagnants)" : "",
        bonus: bo ? bo[1].replace(/\s+/g, " ") + " CFA (" + bo[2].replace(/\s+/g, " ") + " gagnants)" : ""
      };
    }
  }
  info.arrivals = pjArrivals(all);
  info.ok = true;
  return info;
}
if (typeof module !== "undefined" && module.exports) { module.exports = { parseJournal: parseJournal, pjKey: pjKey }; }
