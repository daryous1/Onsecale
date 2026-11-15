/* On se cale : trouve un créneau qui convient à tout le groupe.
   Aucune donnée ne quitte le téléphone, sauf ce que tu envoies toi-même par message.
   Les événements sont stockés dans le téléphone (localStorage). Les invitations et les résultats
   voyagent dans des liens qui contiennent l'événement, donc aucun serveur n'est nécessaire. */
(function () {
"use strict";

var KEY = "onsecale:v2";
var MAX_DAYS = 14;
var $app = document.getElementById("app");
var toastEl = document.getElementById("toast");

/* ---------- utilitaires ---------- */
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function pad(n) { return n < 10 ? "0" + n : "" + n; }
function pl(n, a, b) { return n + " " + (n > 1 ? b : a); }
function isoOf(y, m, d) { return y + "-" + pad(m) + "-" + pad(d); }
var now = new Date();
var todayIso = isoOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
function dateOf(iso) { var p = iso.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
var fWd = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
var fMo = new Intl.DateTimeFormat("fr-FR", { month: "short" });
var fLong = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
var fMonthYear = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
function dayParts(iso) { var d = dateOf(iso); return { wd: fWd.format(d).replace(".", ""), n: d.getDate(), mo: fMo.format(d).replace(".", "") }; }
function longDay(iso) { return fLong.format(dateOf(iso)); }
function fmtT(m) { var h = Math.floor(m / 60), mm = m % 60; return h + "h" + (mm ? pad(mm) : ""); }
function hourLabel(h) { return h === 24 ? "minuit" : h + "h"; }
function newId() { return Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, "a"); }

var toastTimer = 0;
function toast(m) { toastEl.textContent = m; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.hidden = true; }, 4500); }

/* ---------- stockage sur le téléphone ---------- */
function loadDB() {
  try { var d = JSON.parse(localStorage.getItem(KEY)); if (d && Array.isArray(d.events)) return d; } catch (e) {}
  return { name: "", events: [] };
}
var DB = loadDB();
function saveDB() {
  try { localStorage.setItem(KEY, JSON.stringify(DB)); return true; }
  catch (e) { toast("Impossible d'enregistrer sur ce téléphone."); return false; }
}
function findEv(id) { for (var i = 0; i < DB.events.length; i++) if (DB.events[i].id === id) return DB.events[i]; return null; }

/* ---------- données d'un événement ---------- */
function geo(ev) { var spd = (ev.end - ev.start) * 60 / ev.step; return { spd: spd, n: ev.days.length * spd }; }
function slotStart(ev, s) { return ev.start * 60 + s * ev.step; }
function enc(b) { var o = ""; for (var i = 0; i < b.length; i += 4) o += ((b[i] || 0) * 8 + (b[i + 1] || 0) * 4 + (b[i + 2] || 0) * 2 + (b[i + 3] || 0)).toString(16); return o; }
function dec(h, n) {
  var b = [], i; for (i = 0; i < n; i++) b.push(0); h = h || "";
  for (i = 0; i < h.length && i * 4 < n; i++) { var v = parseInt(h.charAt(i), 16) || 0; for (var k = 0; k < 4; k++) { if (i * 4 + k < n) b[i * 4 + k] = (v >> (3 - k)) & 1; } }
  return b;
}
function count(b) { var c = 0; for (var i = 0; i < b.length; i++) c += b[i]; return c; }
function tally(ev) {
  var n = geo(ev).n, counts = [], who = [], i;
  for (i = 0; i < n; i++) { counts.push(0); who.push([]); }
  ev.responses.forEach(function (r, ri) { var b = dec(r.bits, n); for (var j = 0; j < n; j++) { if (b[j]) { counts[j]++; who[j].push(ri); } } });
  return { counts: counts, who: who };
}
function bestRanges(ev, t) {
  var g = geo(ev), out = [];
  ev.days.forEach(function (iso, d) {
    var s = 0;
    while (s < g.spd) {
      var i = d * g.spd + s;
      if (!t.counts[i]) { s++; continue; }
      var key = t.who[i].join(","), e = s + 1;
      while (e < g.spd && t.who[d * g.spd + e].join(",") === key) e++;
      out.push({ d: d, s: s, e: e, c: t.counts[i], who: t.who[i] });
      s = e;
    }
  });
  out.sort(function (a, b) { return b.c - a.c || (b.e - b.s) - (a.e - a.s) || a.d - b.d || a.s - b.s; });
  return out.slice(0, 5);
}
function summary(ev, b) {
  var g = geo(ev), lines = [];
  ev.days.forEach(function (iso, d) {
    var s = 0, parts = [];
    while (s < g.spd) {
      if (!b[d * g.spd + s]) { s++; continue; }
      var e = s; while (e < g.spd && b[d * g.spd + e]) e++;
      parts.push(fmtT(slotStart(ev, s)) + "–" + fmtT(slotStart(ev, e)));
      s = e;
    }
    if (parts.length) lines.push(longDay(iso) + " : " + parts.join(", "));
  });
  return lines;
}
function message(ev, name, b) {
  return "Mes dispos pour « " + ev.title + " » (" + name + ")\n" + summary(ev, b).join("\n") +
    "\n\nCode à coller dans On se cale (ne pas modifier) :\n[dispo:" + ev.id + ":" + encodeURIComponent(name) + ":" + enc(b) + "]";
}
function safeDecode(s) { try { return decodeURIComponent(s); } catch (e) { return s; } }
function parseCodes(text) {
  var re = /\[dispo:([a-z0-9]+):([^:\]\s]*):([0-9a-f]*)\]/gi, out = [], m;
  while ((m = re.exec(text))) out.push({ id: m[1], name: safeDecode(m[2]), hex: m[3].toLowerCase() });
  return out;
}
function upsert(ev, name, hex) {
  var nm = String(name).trim().slice(0, 24), i = -1;
  ev.responses.forEach(function (r, k) { if (r.name.toLowerCase() === nm.toLowerCase()) i = k; });
  if (i >= 0) ev.responses[i] = { name: nm, bits: hex }; else ev.responses.push({ name: nm, bits: hex });
}
function bestText(ev) {
  if (!ev.responses.length) return "";
  var b = bestRanges(ev, tally(ev));
  if (!b.length) return "";
  var r = b[0];
  return longDay(ev.days[r.d]) + " " + fmtT(slotStart(ev, r.s)) + "–" + fmtT(slotStart(ev, r.e)) + " (" + r.c + "/" + ev.responses.length + " dispos)";
}

/* ---------- liens d'invitation et de résultats ---------- */
function toB64(s) {
  var bytes = new TextEncoder().encode(s), bin = "";
  for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromB64(t) {
  t = t.replace(/-/g, "+").replace(/_/g, "/"); while (t.length % 4) t += "=";
  var bin = atob(t), b = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(b);
}
function makeLink(ev, withResp) {
  var o = { i: ev.id, t: ev.title, d: ev.days, s: ev.start, e: ev.end, p: ev.step };
  if (withResp) o.r = ev.responses.map(function (r) { return [r.name, r.bits]; });
  return location.origin + location.pathname + "#join=" + toB64(JSON.stringify(o));
}
function cleanEvent(o) {
  if (!o || typeof o !== "object") return null;
  var id = String(o.i || ""), t = String(o.t || "").trim().slice(0, 60), days = o.d, s = +o.s, e = +o.e, p = +o.p, i;
  if (!/^[a-z0-9]{3,12}$/.test(id) || !t) return null;
  if (!Array.isArray(days) || !days.length || days.length > MAX_DAYS) return null;
  for (i = 0; i < days.length; i++) if (!/^\d{4}-\d{2}-\d{2}$/.test(days[i])) return null;
  if (!(s >= 0 && e <= 24 && e > s && Math.floor(s) === s && Math.floor(e) === e)) return null;
  if (p !== 30 && p !== 60) return null;
  var ev = { id: id, title: t, days: days.slice(), start: s, end: e, step: p, owner: false, responses: [], mine: "" }, resp = null;
  if (Array.isArray(o.r)) {
    var need = Math.ceil(geo(ev).n / 4); resp = [];
    o.r.slice(0, 60).forEach(function (r) {
      if (Array.isArray(r) && typeof r[0] === "string" && typeof r[1] === "string" && /^[0-9a-f]*$/.test(r[1]) && r[1].length === need && r[0].trim())
        resp.push({ name: r[0].trim().slice(0, 24), bits: r[1] });
    });
  }
  return { ev: ev, resp: resp };
}
function importLink(tok) {
  var o; try { o = JSON.parse(fromB64(tok)); } catch (e) { return null; }
  var c = cleanEvent(o); if (!c) return null;
  var ex = findEv(c.ev.id);
  if (!ex) { if (c.resp) c.ev.responses = c.resp; DB.events.unshift(c.ev); ex = c.ev; }
  else if (!ex.owner) { ex.title = c.ev.title; if (c.resp) ex.responses = c.resp; }
  saveDB();
  return ex.id;
}

/* ---------- partage et copie ---------- */
function canShare() { return typeof navigator.share === "function"; }
function copyText(txt) {
  function fallback() {
    var ta = document.createElement("textarea"); ta.value = txt; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    document.body.appendChild(ta); ta.select(); var ok = false;
    try { ok = document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta); return ok;
  }
  if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt).then(function () { return true; }, function () { return fallback(); });
  return Promise.resolve(fallback());
}
function doCopy(txt, okMsg) { copyText(txt).then(function (ok) { toast(ok ? okMsg : "Copie impossible sur cet appareil."); }); }
function doShare(txt) { navigator.share({ text: txt }).catch(function () {}); }
function waHref(txt) { return "https://wa.me/?text=" + encodeURIComponent(txt); }
function inviteText(ev) { return "Salut ! On cale « " + ev.title + " » ? Indique tes dispos ici : " + makeLink(ev, false); }
function resultsText(ev) { var b = bestText(ev); return "Résultats pour « " + ev.title + " »" + (b ? " : meilleur créneau " + b : "") + ".\nVoir le détail : " + makeLink(ev, true); }
function shareRow(txt, key) {
  return '<div class="stack">' +
    '<a class="btn primary" target="_blank" rel="noopener" href="' + esc(waHref(txt)) + '">Envoyer sur WhatsApp</a>' +
    (canShare() ? '<button type="button" class="btn" data-act="share" data-k="' + key + '">Autre application…</button>' : "") +
    '<button type="button" class="btn" data-act="copy" data-k="' + key + '">Copier</button></div>';
}

/* ---------- état de l'interface ---------- */
var ui = { tab: "mine", sel: -1, confirm: "", paste: "", titleDraft: null, paint: false, mine: [], days: {}, installEv: null,
  month: { y: now.getFullYear(), m: now.getMonth() } };
function persistMine(ev) { ev.mine = enc(ui.mine); saveDB(); }
function isStandalone() { return window.matchMedia && window.matchMedia("(display-mode: standalone)").matches; }

/* ---------- vues ---------- */
function gridHtml(ev, mode) {
  var g = geo(ev), edit = mode === "edit", t = edit ? null : tally(ev), tot = ev.responses.length, h, s, d;
  h = '<div class="gridwrap"><div class="grid ' + (edit ? "edit" : "heat") + (edit && ui.paint ? " painting" : "") + '" style="--cols:' + ev.days.length + '"><span class="corner"></span>';
  ev.days.forEach(function (iso, di) {
    var p = dayParts(iso), inner = "<span>" + esc(p.wd) + "</span><b>" + p.n + "</b><span>" + esc(p.mo) + "</span>";
    h += edit ? '<button type="button" class="dh" data-act="toggle-day" data-d="' + di + '" aria-label="Tout cocher le ' + esc(longDay(iso)) + '">' + inner + "</button>" : '<div class="dh">' + inner + "</div>";
  });
  for (s = 0; s < g.spd; s++) {
    var tm = slotStart(ev, s), label = (ev.step === 60 || tm % 60 === 0) ? fmtT(tm) : "";
    h += edit ? '<button type="button" class="th" data-act="toggle-row" data-s="' + s + '">' + label + "</button>" : '<div class="th">' + label + "</div>";
    for (d = 0; d < ev.days.length; d++) {
      var i = d * g.spd + s;
      if (edit) {
        var on = ui.mine[i];
        h += '<button type="button" class="c' + (on ? " on" : "") + '" data-act="cell" data-i="' + i + '" aria-pressed="' + (on ? "true" : "false") + '" aria-label="' + esc(longDay(ev.days[d]) + " à " + fmtT(tm)) + '"></button>';
      } else {
        var c = t.counts[i], p2 = tot ? Math.round(c / tot * 100) : 0;
        h += '<button type="button" class="c heat' + (tot && c === tot ? " all" : "") + (i === ui.sel ? " sel" : "") + '" data-act="rcell" data-i="' + i + '" style="--p:' + p2 + '%" aria-label="' + esc(longDay(ev.days[d]) + " à " + fmtT(tm) + " : " + pl(c, "personne libre", "personnes libres")) + '">' + (c || "") + "</button>";
      }
    }
  }
  return h + "</div></div>";
}
function backLink() { return '<a class="back" href="#/">‹ Mes événements</a>'; }
function hourOpts(a, b, sel) { var o = ""; for (var h = a; h <= b; h++) o += '<option value="' + h + '"' + (h === sel ? " selected" : "") + ">" + hourLabel(h) + "</option>"; return o; }

function homeView() {
  var h = '<header class="hero"><p class="kicker">Dispos entre amis</p><h1>On se cale</h1><p class="lead">Trouve le créneau qui arrange tout le monde.</p></header><div class="stack" style="margin-top:16px">' +
    '<a class="btn primary" href="#/new">Nouvel événement</a>';
  if (ui.installEv && !isStandalone()) h += '<button type="button" class="btn" data-act="install">Installer l\'appli sur ce téléphone</button>';
  if (DB.events.length) {
    h += '<div class="stack">' + DB.events.map(function (ev) {
      return '<a class="card evcard" href="#/e/' + ev.id + '"><b>' + esc(ev.title) + '</b><span class="muted">' + pl(ev.days.length, "jour", "jours") + " · " +
        pl(ev.responses.length, "réponse", "réponses") + " · " + (ev.owner ? "Tu organises" : "Invité") + "</span></a>";
    }).join("") + "</div>";
  } else h += '<p class="muted">Aucun événement pour l\'instant. Crée le premier, ou ouvre un lien d\'invitation reçu d\'un ami.</p>';
  h += '<div class="card stack"><h2>Tu as reçu un lien ?</h2><p class="muted">Touche-le dans ta messagerie. S\'il s\'ouvre dans le navigateur au lieu de l\'appli, colle-le ici.</p>' +
    '<input class="in" id="join-in" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Colle le lien ici">' +
    '<button type="button" class="btn" data-act="join">Rejoindre</button></div></div>';
  return h;
}
function createView() {
  return backLink() + '<header class="hero"><p class="kicker">Nouvel événement</p><h1>Quand on se voit ?</h1><p class="lead">Choisis les jours possibles. Tes amis cochent leurs dispos, tu vois les meilleurs créneaux.</p></header><div class="card stack" style="margin-top:16px">' +
    '<div><label class="lbl" for="ev-title">Nom de l\'événement</label><input class="in" id="ev-title" maxlength="60" autocomplete="off" placeholder="Ex. Soirée jeux de société" value="' + esc(ui.titleDraft || "") + '"></div>' +
    '<div><span class="lbl">Jours possibles (' + MAX_DAYS + ' maximum)</span><div id="cal"></div><p class="muted" id="cal-sum" style="margin-top:8px"></p></div>' +
    '<div class="two"><div><label class="lbl" for="ev-start">Dès</label><select class="in" id="ev-start">' + hourOpts(0, 23, 9) + '</select></div>' +
    '<div><label class="lbl" for="ev-end">Jusqu\'à</label><select class="in" id="ev-end">' + hourOpts(1, 24, 23) + '</select></div></div>' +
    '<div><label class="lbl" for="ev-step">Précision des cases</label><select class="in" id="ev-step"><option value="60" selected>1 heure</option><option value="30">30 minutes</option></select></div>' +
    '<button type="button" class="btn primary" data-act="create">Créer l\'événement</button></div>';
}
function headerView(ev) {
  return '<header class="hero"><p class="kicker">' + (ev.owner ? "Tu organises" : "Tu es invité") + '</p><h1>' + esc(ev.title) + '</h1><p class="lead">' +
    pl(ev.days.length, "jour", "jours") + " · " + hourLabel(ev.start) + " à " + hourLabel(ev.end) + " · " + pl(ev.responses.length, "réponse", "réponses") + "</p></header>";
}
function tabsView(ev) {
  var t = [["mine", "Mes dispos"], ["res", "Résultats"]];
  if (ev.owner) t.push(["org", "Organisateur"]);
  return '<div class="tabs" role="tablist">' + t.map(function (x) { return '<button type="button" role="tab" class="tab" aria-selected="' + (ui.tab === x[0]) + '" data-act="tab" data-tab="' + x[0] + '">' + x[1] + "</button>"; }).join("") + "</div>";
}
function mineView(ev) {
  var h = '<section class="stack"><div><label class="lbl" for="my-name">Ton prénom</label><input class="in" id="my-name" maxlength="24" autocomplete="given-name" value="' + esc(DB.name) + '"></div>' +
    '<p class="muted">Touche les cases où tu es libre. Touche un jour ou une heure pour tout cocher d\'un coup.</p>' + gridHtml(ev, "edit") +
    '<div class="row between"><span id="count" aria-live="polite" class="muted"></span><div class="row">' +
    '<button type="button" class="btn small" data-act="paint" aria-pressed="' + ui.paint + '">Glisser pour cocher : ' + (ui.paint ? "oui" : "non") + '</button>' +
    '<button type="button" class="btn small" data-act="clear">Tout effacer</button></div></div>' +
    '<div class="card stack"><h2>' + (ev.owner ? "Ma réponse" : "Envoyer ma réponse") + '</h2>';
  if (ev.owner) {
    h += '<button type="button" class="btn primary" data-act="save-mine">Enregistrer ma réponse</button>';
  } else {
    h += '<p class="muted">Rien n\'est partagé tant que tu n\'as pas envoyé ton message à l\'organisateur. Il collera le code dans l\'appli.</p>' +
      '<a id="wa" class="btn primary" target="_blank" rel="noopener" href="#">Envoyer sur WhatsApp</a>' +
      (canShare() ? '<button type="button" class="btn" data-act="share-mine">Autre application…</button>' : "") +
      '<button type="button" class="btn" data-act="copy-mine">Copier le message</button>' +
      '<textarea id="msg" class="in" readonly rows="6" aria-label="Message à envoyer"></textarea>';
  }
  return h + "</div></section>";
}
function detailHtml(ev, i) {
  if (i < 0) return '<p class="muted">Touche une case pour voir qui est libre.</p>';
  var g = geo(ev), d = Math.floor(i / g.spd), s = i % g.spd, t = tally(ev), who = t.who[i], ins = [], outs = [];
  ev.responses.forEach(function (r, ri) { (who.indexOf(ri) >= 0 ? ins : outs).push(r.name); });
  return "<h3>" + esc(longDay(ev.days[d])) + " · " + fmtT(slotStart(ev, s)) + "–" + fmtT(slotStart(ev, s + 1)) + "</h3>" +
    "<p><b>Libres (" + ins.length + ")</b> " + (ins.length ? esc(ins.join(", ")) : "personne") + "</p>" +
    "<p><b>Pas libres (" + outs.length + ")</b> " + (outs.length ? esc(outs.join(", ")) : "personne") + "</p>";
}
function resView(ev) {
  var tot = ev.responses.length;
  if (!tot) return '<section class="stack"><p class="lead">' + (ev.owner ? "Personne n'a encore répondu. Ajoute les réponses reçues dans l'onglet Organisateur." :
    "Les résultats apparaissent ici quand l'organisateur te partage le lien des résultats.") + "</p></section>";
  var t = tally(ev), best = bestRanges(ev, t);
  var h = '<section class="stack"><div class="card"><h2 style="margin-bottom:12px">Meilleurs créneaux</h2>';
  if (best.length) {
    h += '<ul class="list">' + best.map(function (r) {
      var names = r.who.map(function (ri) { return ev.responses[ri].name; });
      return '<li><div class="grow"><b>' + esc(longDay(ev.days[r.d])) + "</b> · " + fmtT(slotStart(ev, r.s)) + "–" + fmtT(slotStart(ev, r.e)) +
        '<div class="muted">' + esc(names.join(", ")) + '</div></div><span class="pill">' + r.c + "/" + tot + "</span></li>";
    }).join("") + "</ul>";
  } else h += '<p class="muted">Aucun créneau en commun pour le moment.</p>';
  return h + '</div><div class="legend"><span>0</span><i></i><span>' + tot + "</span></div>" + gridHtml(ev, "heat") +
    '<div class="card" id="detail">' + detailHtml(ev, ui.sel) + "</div>" +
    '<div><span class="lbl">Ont répondu</span><div class="chips">' + ev.responses.map(function (r) { return '<span class="chip">' + esc(r.name) + "</span>"; }).join("") + "</div></div></section>";
}
function orgView(ev) {
  var g = geo(ev), h = '<section class="stack">';
  h += '<div class="card stack"><h2>1. Inviter tes amis</h2><p class="muted">Ce lien contient l\'événement. Chaque ami l\'ouvre, coche ses dispos et te renvoie un message.</p>' + shareRow(inviteText(ev), "invite") + "</div>";
  h += '<div class="card stack"><h2>2. Ajouter les réponses</h2><p class="muted">Copie ici les messages reçus, en entier. Tu peux en coller plusieurs d\'un coup. Seul le code entre crochets compte.</p>' +
    '<textarea id="paste" class="in" rows="5" placeholder="Colle ici les messages reçus">' + esc(ui.paste) + '</textarea>' +
    '<button type="button" class="btn primary" data-act="add-codes">Ajouter</button></div>';
  h += '<div class="card stack"><h2>Réponses reçues (' + ev.responses.length + ")</h2>";
  if (ev.responses.length) {
    h += '<ul class="list">' + ev.responses.map(function (r, ri) {
      var c = count(dec(r.bits, g.n)), conf = ui.confirm === "del:" + ri;
      return '<li><div class="grow"><b>' + esc(r.name) + '</b><div class="muted">' + pl(c, "créneau", "créneaux") + '</div></div>' +
        '<button type="button" class="btn small danger" data-act="del-resp" data-ri="' + ri + '">' + (conf ? "Confirmer" : "Supprimer") + "</button></li>";
    }).join("") + "</ul>";
  } else h += '<p class="muted">Aucune réponse pour le moment.</p>';
  h += "</div>";
  if (ev.responses.length) h += '<div class="card stack"><h2>3. Partager les résultats</h2><p class="muted">Ce lien contient toutes les réponses. Tes amis le touchent pour voir les meilleurs créneaux.</p>' + shareRow(resultsText(ev), "results") + "</div>";
  h += '<div class="card stack"><h2>Nom de l\'événement</h2><input class="in" id="title-edit" maxlength="60" value="' + esc(ui.titleDraft === null ? ev.title : ui.titleDraft) + '" aria-label="Nom de l\'événement">' +
    '<button type="button" class="btn" data-act="save-title">Enregistrer le nom</button></div></section>';
  return h;
}
function eventFooter(ev) {
  return '<div style="margin-top:24px"><button type="button" class="btn danger" data-act="del-event">' + (ui.confirm === "delev" ? "Confirmer la suppression" : "Supprimer cet événement") + '</button>' +
    '<p class="muted" style="margin-top:8px">L\'événement est retiré de ce téléphone uniquement.</p></div>';
}
function eventView(ev) {
  if (ui.tab === "org" && !ev.owner) ui.tab = "mine";
  return backLink() + headerView(ev) + tabsView(ev) + (ui.tab === "res" ? resView(ev) : ui.tab === "org" ? orgView(ev) : mineView(ev)) + eventFooter(ev);
}

function render() {
  var r = getRoute(), h, ev = r.id ? findEv(r.id) : null;
  if (r.name === "new") h = createView();
  else if (r.name === "event") h = ev ? eventView(ev) : backLink() + '<h1>Événement introuvable</h1><p class="lead">Il a été supprimé de ce téléphone, ou le lien est incomplet.</p>';
  else h = homeView();
  $app.innerHTML = h;
  if (r.name === "new") renderCal();
  else if (ev && r.name === "event" && ui.tab === "mine") updateSend(ev);
}
function renderCal() {
  var el = document.getElementById("cal"); if (!el) return;
  var m = ui.month, first = new Date(m.y, m.m, 1), off = (first.getDay() + 6) % 7, dim = new Date(m.y, m.m + 1, 0).getDate();
  var label = fMonthYear.format(first); label = label.charAt(0).toUpperCase() + label.slice(1);
  var isCur = m.y === now.getFullYear() && m.m === now.getMonth();
  var h = '<div class="calhead"><button type="button" class="calnav" data-act="cal-prev" aria-label="Mois précédent"' + (isCur ? " disabled" : "") + '>‹</button><b>' + esc(label) +
    '</b><button type="button" class="calnav" data-act="cal-next" aria-label="Mois suivant">›</button></div><div class="calgrid">';
  ["L", "M", "M", "J", "V", "S", "D"].forEach(function (x) { h += '<span class="wd">' + x + "</span>"; });
  for (var i = 0; i < off; i++) h += "<span></span>";
  for (var d = 1; d <= dim; d++) {
    var iso = isoOf(m.y, m.m + 1, d), on = !!ui.days[iso];
    h += '<button type="button" class="dayb' + (on ? " on" : "") + '" data-act="day" data-iso="' + iso + '"' + (iso < todayIso ? " disabled" : "") + ' aria-pressed="' + on + '">' + d + "</button>";
  }
  el.innerHTML = h + "</div>";
  var keys = selectedDays(), sum = document.getElementById("cal-sum");
  if (sum) sum.textContent = keys.length ? pl(keys.length, "jour choisi", "jours choisis") + " : " + keys.map(longDay).join(", ") : "Aucun jour choisi pour l'instant.";
}
function selectedDays() { return Object.keys(ui.days).filter(function (k) { return ui.days[k]; }).sort(); }

function setCell(i, v) {
  ui.mine[i] = v;
  var el = $app.querySelector('.grid.edit .c[data-i="' + i + '"]');
  if (el) { el.classList.toggle("on", !!v); el.setAttribute("aria-pressed", v ? "true" : "false"); }
}
function updateSend(ev) {
  var cnt = count(ui.mine), c = document.getElementById("count");
  if (c) c.textContent = pl(cnt, "créneau choisi", "créneaux choisis");
  if (ev.owner) return;
  var msg = message(ev, (DB.name || "").trim() || "…", ui.mine);
  var ta = document.getElementById("msg"); if (ta) ta.value = msg;
  var wa = document.getElementById("wa"); if (wa) wa.href = waHref(msg);
}

/* ---------- routage ---------- */
function getRoute() {
  var h = location.hash || "", m;
  if (h.indexOf("#join=") === 0) return { name: "join", tok: h.slice(6) };
  m = h.match(/^#\/e\/([a-z0-9]+)$/);
  if (m) return { name: "event", id: m[1] };
  if (h === "#/new") return { name: "new" };
  return { name: "home" };
}
var curKey = null;
function route() {
  var r = getRoute();
  if (r.name === "join") {
    var id = importLink(r.tok);
    history.replaceState(null, "", location.pathname + (id ? "#/e/" + id : "#/"));
    toast(id ? "Événement ajouté." : "Ce lien n'est pas valide.");
    r = getRoute();
  }
  var key = r.name + (r.id || "");
  if (key !== curKey) {
    curKey = key; ui.sel = -1; ui.confirm = ""; ui.paste = ""; ui.paint = false; ui.titleDraft = null;
    var ev = r.id ? findEv(r.id) : null;
    ui.tab = ev && ev.owner ? "org" : "mine";
    ui.mine = ev ? dec(ev.mine, geo(ev).n) : [];
    if (r.name === "new") { ui.days = {}; }
    window.scrollTo(0, 0);
  }
  render();
}

/* ---------- actions ---------- */
function curEvent() { var r = getRoute(); return r.id ? findEv(r.id) : null; }
function textFor(ev, k) { return k === "invite" ? inviteText(ev) : resultsText(ev); }

$app.addEventListener("click", function (e) {
  var wa = e.target.closest("#wa"), ev = curEvent();
  if (wa) {
    if (!(DB.name || "").trim()) { e.preventDefault(); toast("Entre ton prénom avant d'envoyer."); return; }
    if (!count(ui.mine)) { e.preventDefault(); toast("Coche au moins un créneau avant d'envoyer."); return; }
    return;
  }
  var t = e.target.closest("[data-act]"); if (!t) return;
  var a = t.getAttribute("data-act"), g = ev ? geo(ev) : null, i, k;

  if (a === "install") {
    if (!ui.installEv) return;
    ui.installEv.prompt(); ui.installEv.userChoice.then(function () { ui.installEv = null; render(); }); return;
  }
  if (a === "join") {
    var v = (document.getElementById("join-in").value || "").trim(), m = v.match(/#join=([A-Za-z0-9_-]+)/);
    var tok = m ? m[1] : (/^[A-Za-z0-9_-]{20,}$/.test(v) ? v : "");
    var id = tok ? importLink(tok) : null;
    if (!id) { toast("Ce lien n'est pas valide."); return; }
    location.hash = "#/e/" + id; return;
  }
  if (a === "cal-prev" || a === "cal-next") {
    var nm = ui.month.m + (a === "cal-next" ? 1 : -1), ny = ui.month.y;
    if (nm < 0) { nm = 11; ny--; } else if (nm > 11) { nm = 0; ny++; }
    ui.month = { y: ny, m: nm }; renderCal(); return;
  }
  if (a === "day") {
    var iso = t.getAttribute("data-iso");
    if (!ui.days[iso] && selectedDays().length >= MAX_DAYS) { toast(MAX_DAYS + " jours au maximum."); return; }
    ui.days[iso] = !ui.days[iso]; renderCal(); return;
  }
  if (a === "create") {
    var title = (document.getElementById("ev-title").value || "").trim() || "Notre prochaine sortie";
    var st = +document.getElementById("ev-start").value, en = +document.getElementById("ev-end").value, sp = +document.getElementById("ev-step").value, days = selectedDays();
    if (!days.length) { toast("Choisis au moins un jour."); return; }
    if (en <= st) { toast("L'heure de fin doit être après l'heure de début."); return; }
    var nid = newId(); while (findEv(nid)) nid = newId();
    DB.events.unshift({ id: nid, title: title, days: days, start: st, end: en, step: sp, owner: true, responses: [], mine: "" });
    if (saveDB()) { ui.days = {}; location.hash = "#/e/" + nid; }
    return;
  }
  if (a === "tab") { ui.tab = t.getAttribute("data-tab"); ui.confirm = ""; render(); return; }
  if (!ev) return;

  if (a === "cell") { if (ui.paint) return; i = +t.getAttribute("data-i"); setCell(i, ui.mine[i] ? 0 : 1); persistMine(ev); updateSend(ev); return; }
  if (a === "toggle-day") {
    var d = +t.getAttribute("data-d"), all = true;
    for (k = 0; k < g.spd; k++) if (!ui.mine[d * g.spd + k]) all = false;
    for (k = 0; k < g.spd; k++) setCell(d * g.spd + k, all ? 0 : 1);
    persistMine(ev); updateSend(ev); return;
  }
  if (a === "toggle-row") {
    var s = +t.getAttribute("data-s"), all2 = true;
    for (k = 0; k < ev.days.length; k++) if (!ui.mine[k * g.spd + s]) all2 = false;
    for (k = 0; k < ev.days.length; k++) setCell(k * g.spd + s, all2 ? 0 : 1);
    persistMine(ev); updateSend(ev); return;
  }
  if (a === "clear") { for (k = 0; k < g.n; k++) setCell(k, 0); persistMine(ev); updateSend(ev); return; }
  if (a === "paint") {
    ui.paint = !ui.paint; t.setAttribute("aria-pressed", ui.paint); t.textContent = "Glisser pour cocher : " + (ui.paint ? "oui" : "non");
    var gr = $app.querySelector(".grid.edit"); if (gr) gr.classList.toggle("painting", ui.paint);
    if (ui.paint) toast("La grille ne défile plus : glisse le doigt pour cocher.");
    return;
  }
  if (a === "save-mine") {
    var nm2 = (DB.name || "").trim();
    if (!nm2) { toast("Entre ton prénom d'abord."); return; }
    if (!count(ui.mine)) { toast("Coche au moins un créneau."); return; }
    upsert(ev, nm2, enc(ui.mine)); saveDB(); toast("Ta réponse est enregistrée."); render(); return;
  }
  if (a === "copy-mine" || a === "share-mine") {
    if (!(DB.name || "").trim()) { toast("Entre ton prénom avant d'envoyer."); return; }
    if (!count(ui.mine)) { toast("Coche au moins un créneau avant d'envoyer."); return; }
    var msg = message(ev, DB.name.trim(), ui.mine);
    if (a === "share-mine") doShare(msg); else doCopy(msg, "Message copié. Colle-le dans ta messagerie.");
    return;
  }
  if (a === "share" || a === "copy") {
    var txt = textFor(ev, t.getAttribute("data-k"));
    if (a === "share") doShare(txt); else doCopy(txt, "Copié. Colle-le dans ta messagerie.");
    return;
  }
  if (a === "rcell") {
    var old = ui.sel; ui.sel = +t.getAttribute("data-i");
    var oe = $app.querySelector('.c.heat[data-i="' + old + '"]'); if (oe) oe.classList.remove("sel");
    t.classList.add("sel"); document.getElementById("detail").innerHTML = detailHtml(ev, ui.sel); return;
  }
  if (a === "add-codes") {
    var codes = parseCodes(ui.paste);
    if (!codes.length) { toast("Aucun code trouvé dans ce texte."); return; }
    var need = Math.ceil(g.n / 4), good = codes.filter(function (c) { return c.id === ev.id && c.hex.length === need && c.name.trim(); });
    if (!good.length) { toast("Ces codes ne correspondent pas à cet événement."); return; }
    good.forEach(function (c) { upsert(ev, c.name, c.hex); });
    saveDB(); ui.paste = ""; toast(pl(good.length, "réponse ajoutée", "réponses ajoutées") + "."); render(); return;
  }
  if (a === "del-resp") {
    var ri = +t.getAttribute("data-ri");
    if (ui.confirm !== "del:" + ri) { ui.confirm = "del:" + ri; render(); return; }
    ev.responses.splice(ri, 1); ui.confirm = ""; saveDB(); toast("Réponse supprimée."); render(); return;
  }
  if (a === "save-title") {
    var tt = (ui.titleDraft === null ? ev.title : ui.titleDraft).trim();
    if (!tt) { toast("Le nom ne peut pas être vide."); return; }
    ev.title = tt; ui.titleDraft = null; saveDB(); toast("Nom enregistré."); render(); return;
  }
  if (a === "del-event") {
    if (ui.confirm !== "delev") { ui.confirm = "delev"; render(); return; }
    DB.events = DB.events.filter(function (x) { return x.id !== ev.id; }); saveDB(); location.hash = "#/"; return;
  }
});
$app.addEventListener("input", function (e) {
  var id = e.target.id, ev = curEvent();
  if (id === "my-name") { DB.name = e.target.value; saveDB(); if (ev) updateSend(ev); }
  else if (id === "paste") ui.paste = e.target.value;
  else if (id === "title-edit") ui.titleDraft = e.target.value;
  else if (id === "ev-title") ui.titleDraft = e.target.value;
});

/* glisser pour cocher plusieurs cases */
var painting = null;
function cellAt(x, y) { var el = document.elementFromPoint(x, y); return el && el.closest ? el.closest(".grid.edit .c") : null; }
$app.addEventListener("pointerdown", function (e) {
  if (!ui.paint) return;
  var c = e.target.closest(".grid.edit .c"); if (!c) return;
  var i = +c.getAttribute("data-i"), ev = curEvent(); if (!ev) return;
  painting = { v: ui.mine[i] ? 0 : 1, ev: ev }; setCell(i, painting.v); updateSend(ev); e.preventDefault();
});
$app.addEventListener("pointermove", function (e) {
  if (!painting) return;
  var c = cellAt(e.clientX, e.clientY); if (!c) return;
  var i = +c.getAttribute("data-i");
  if (ui.mine[i] !== painting.v) { setCell(i, painting.v); updateSend(painting.ev); }
});
function endPaint() { if (painting) { persistMine(painting.ev); painting = null; } }
document.addEventListener("pointerup", endPaint);
document.addEventListener("pointercancel", endPaint);

/* ---------- installation et démarrage ---------- */
window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); ui.installEv = e; if (getRoute().name === "home") render(); });
window.addEventListener("appinstalled", function () { ui.installEv = null; toast("Appli installée."); if (getRoute().name === "home") render(); });
window.addEventListener("hashchange", route);
route();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
}
})();
