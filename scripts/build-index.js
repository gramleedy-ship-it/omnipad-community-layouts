#!/usr/bin/env node
// Omnipad community layouts: checks the layout files and (re)builds index.json. No dependencies (Node 18+).
//
//   node scripts/build-index.js validate            check every layouts/<game>/<name>.omnipad-layout (pull requests)
//   node scripts/build-index.js build --offline     rebuild index.json from the files, keeping the numbers it had
//   node scripts/build-index.js build               the scheduled Action: also, with GITHUB_TOKEN + GITHUB_REPOSITORY,
//                                                   - uploads each layout to the "layouts" release (its asset's
//                                                     download_count = the download number; nobody is identified)
//                                                   - makes one "Rate: <id>" issue per layout (label "rating") and
//                                                     counts its thumbs up / thumbs down reactions (read anonymously
//                                                     by everyone, made with each person's own GitHub account)
//                                                   - takes the author from the commit that added the file
//
// The app checks every file again (src/Omnipad/Layouts/CommunityLayouts.cs: full profile schema, SHA-256 against this
// index, anti-cheat list, system keys), so this is the first gate, not the only one. Keep the limits in step with it.

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const LAYOUTS = path.join(ROOT, 'layouts');
const INDEX = path.join(ROOT, 'index.json');
const STATS = path.join(ROOT, 'stats.json');
const EXT = '.omnipad-layout';
const MAX_BYTES = 16 * 1024, MAX_LINES = 400, MAX_LINE = 500;
const FAMILIES = ['xbox', 'playstation', 'switch', 'any'];
const CONTROLS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'LS', 'RS', 'Up', 'Down', 'Left', 'Right', 'Back', 'Start',
                  'Guide', 'Touchpad', 'LP', 'RP', 'Share', 'Mic'];
const SYSTEM_KEYS = ['win', 'lwin', 'rwin', 'apps', 'menu', 'contextmenu', 'sleep', 'power', 'wake', 'launchmail',
                     'launchapp1', 'launchapp2', 'browserhome', 'browsersearch'];
const SYSTEM_COMBOS = [['ctrl', 'alt', 'delete'], ['ctrl', 'shift', 'esc'], ['alt', 'tab'], ['alt', 'f4'], ['ctrl', 'esc'],
                       ['alt', 'esc'], ['ctrl', 'alt', 'esc']];

function antiCheat() {
  const f = path.join(__dirname, 'anticheat.txt');
  if (!fs.existsSync(f)) return new Set();
  return new Set(fs.readFileSync(f, 'utf8').split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(s => s && !s.startsWith('#')));
}

function normExe(e) {
  e = String(e || '').trim().toLowerCase();
  return !e || e.endsWith('.exe') ? e : e + '.exe';
}

/** Why a value presses a system key or runs a desktop action, or null. */
function systemKey(key, value) {
  if (/^radial[1-8]$/i.test(key)) {
    const t = value.split('|')[0].trim();
    if (/^action:/i.test(t) || (t && !t.includes(':') && !/^(none|off|nothing)$/i.test(t))) return `${key} runs a desktop action (${t})`;
  }
  const re = /key\s*:\s*([^,;|]+)/gi;
  let m;
  while ((m = re.exec(value))) {
    const parts = m[1].split('+').map(p => {
      let k = p.trim().toLowerCase();
      if (k === 'control' || k === 'lctrl' || k === 'rctrl') k = 'ctrl';
      else if (k === 'lalt' || k === 'ralt') k = 'alt';
      else if (k === 'lshift' || k === 'rshift') k = 'shift';
      else if (k === 'del') k = 'delete';
      else if (k === 'escape') k = 'esc';
      return k;
    }).filter(Boolean);
    if (parts.some(k => SYSTEM_KEYS.includes(k))) return `${key} presses a system key (${m[1].trim()})`;
    if (SYSTEM_COMBOS.some(c => c.every(k => parts.includes(k)))) return `${key} presses a system key (${m[1].trim()})`;
  }
  return null;
}

/** Reads and checks one layout file. rel: "layouts/<game>/<name>.omnipad-layout". */
function check(text, rel, blocked) {
  const errors = [];
  const meta = {};
  const entries = [];
  let exe = null;
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes > MAX_BYTES) errors.push(`bigger than ${MAX_BYTES / 1024} KB`);
  if (text.charCodeAt(0) === 0xfeff) errors.push('starts with a byte order mark (save it as UTF-8 without BOM)');
  if (text.includes('\0')) errors.push('not a text file');
  const lines = text.split('\n');
  if (lines.length > MAX_LINES) errors.push(`more than ${MAX_LINES} lines`);
  const parts = rel.replace(/\\/g, '/').split('/');
  if (parts.length !== 3 || parts[0] !== 'layouts' || !parts[2].endsWith(EXT)) errors.push('must be layouts/<game exe without .exe>/<name>.omnipad-layout');
  const folder = parts[1] || '', stem = (parts[2] || '').slice(0, -EXT.length);
  if (!/^[a-z0-9][a-z0-9_-]{0,40}$/.test(folder)) errors.push('the folder name: a-z, 0-9, _ - (the exe name without .exe, lower case)');
  if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(stem)) errors.push('the file name: a-z, 0-9 and dashes');
  let section = null, sections = 0;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (line.length > MAX_LINE) { errors.push(`a line longer than ${MAX_LINE} characters`); break; }
    const t = line.trim();
    if (!t) continue;
    const mm = /^;\s*@([a-z-]+)\s*:\s*(.*)$/i.exec(t);
    if (mm) { meta[mm[1].toLowerCase()] = mm[2].trim(); continue; }
    if (t.startsWith(';') || t.startsWith('#')) continue;
    if (t.startsWith('[') && t.endsWith(']')) {
      section = t.slice(1, -1).trim();
      sections++;
      if (!/^profile:/i.test(section)) errors.push(`only a [Profile:<game>.exe] section, not [${section}]`);
      else exe = normExe(section.slice(8));
      continue;
    }
    const eq = t.indexOf('=');
    if (eq <= 0) { errors.push(`not key=value: ${t.slice(0, 60)}`); continue; }
    if (!section) { errors.push('a line before the [Profile:<game>.exe] section'); continue; }
    const k = t.slice(0, eq).trim(), v = t.slice(eq + 1).trim();
    if (!/^[A-Za-z][A-Za-z0-9+]{0,40}$/.test(k)) errors.push(`odd setting name ${k}`);
    if (/^allowcompetitive$/i.test(k)) errors.push('AllowCompetitive is not allowed');
    if (/[\x00-\x1f]/.test(v)) errors.push(`control characters in ${k}`);
    const sys = systemKey(k, v);
    if (sys) errors.push(sys);
    entries.push([k, v]);
  }
  if (sections !== 1) errors.push('exactly one [Profile:<game>.exe] section');
  if (!entries.length) errors.push('the layout is empty');
  if (exe) {
    if (blocked.has(exe)) errors.push(`${exe} runs under an anti-cheat: Omnipad sends no keyboard / mouse there`);
    if (folder && exe !== folder + '.exe') errors.push(`the folder must be named after the exe (${exe.slice(0, -4)})`);
  }
  if (!meta.title || meta.title.length > 80) errors.push('; @title: is needed (80 characters at most)');
  if (!meta.game || meta.game.length > 80) errors.push('; @game: is needed (80 characters at most)');
  if ((meta.description || '').length > 300) errors.push('; @description: 300 characters at most');
  const family = (meta.family || 'any').toLowerCase();
  if (!FAMILIES.includes(family)) errors.push(`; @family: one of ${FAMILIES.join(', ')}`);
  const appId = meta['steam-app-id'] ? Number(meta['steam-app-id']) : 0;
  if (meta['steam-app-id'] && !(Number.isInteger(appId) && appId > 0)) errors.push('; @steam-app-id: a number');
  return { errors, meta, family, appId, exe, entries, id: folder + '.' + stem };
}

function walk() {
  const out = [];
  if (!fs.existsSync(LAYOUTS)) return out;
  for (const g of fs.readdirSync(LAYOUTS).sort()) {
    const dir = path.join(LAYOUTS, g);
    if (!fs.statSync(dir).isDirectory()) { out.push({ rel: 'layouts/' + g, text: '' }); continue; }
    for (const f of fs.readdirSync(dir).sort())
      out.push({ rel: `layouts/${g}/${f}`, text: fs.readFileSync(path.join(dir, f), 'utf8') });
  }
  return out;
}

function sha256(text) { return crypto.createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex'); }

function readJson(f, fallback) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fallback; } }

// ------------------------------------------------------------ GitHub (the scheduled Action only)

async function gh(method, url, body, headers) {
  const res = await fetch(url.startsWith('http') ? url : 'https://api.github.com' + url, {
    method,
    headers: Object.assign({
      'Authorization': 'Bearer ' + process.env.GITHUB_TOKEN,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'omnipad-community-index'
    }, headers || {}),
    body: body === undefined ? undefined : (Buffer.isBuffer(body) ? body : JSON.stringify(body))
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${method} ${url}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? {} : res.json();
}

async function ghAll(url) {
  const all = [];
  for (let page = 1; page < 100; page++) {
    const part = await gh('GET', url + (url.includes('?') ? '&' : '?') + 'per_page=100&page=' + page);
    if (!part || !part.length) break;
    all.push(...part);
    if (part.length < 100) break;
  }
  return all;
}

async function online(repo, layouts, stats) {
  // The release that serves the files (anonymous downloads, counted by GitHub).
  let rel = await gh('GET', `/repos/${repo}/releases/tags/layouts`);
  if (!rel) rel = await gh('POST', `/repos/${repo}/releases`, { tag_name: 'layouts', name: 'Layout files', body: 'Served to Omnipad. Do not edit by hand: the index Action keeps it in step with layouts/.' });
  const assets = await ghAll(`/repos/${repo}/releases/${rel.id}/assets`);
  // Rating issues (label "rating"), one per layout; their reactions are the votes.
  const issues = await ghAll(`/repos/${repo}/issues?labels=rating&state=all`);
  for (const l of layouts) {
    const name = l.id + EXT;
    const a = assets.find(x => x.name === name);
    const s = stats[l.id] || (stats[l.id] = { base: 0 });
    if (a && a.label === l.sha256.slice(0, 16)) l.downloads = s.base + a.download_count;
    else {
      if (a) { s.base += a.download_count; await gh('DELETE', `/repos/${repo}/releases/assets/${a.id}`); }
      const up = rel.upload_url.replace(/\{.*\}$/, '') + `?name=${encodeURIComponent(name)}&label=${l.sha256.slice(0, 16)}`;
      await gh('POST', up, Buffer.from(l.text, 'utf8'), { 'Content-Type': 'text/plain; charset=utf-8' });
      l.downloads = s.base;
    }
    let issue = issues.find(i => i.title === 'Rate: ' + l.id);
    if (!issue) {
      issue = await gh('POST', `/repos/${repo}/issues`, {
        title: 'Rate: ' + l.id, labels: ['rating'],
        body: `**${l.title}** for ${l.game} (\`${l.file}\`).\n\nRate it with a reaction on this post: :+1: works well, :-1: doesn't. Omnipad counts them a few times a day. Comments welcome; problems: use Report in the app.`
      });
    }
    l.rate_url = issue.html_url;
    l.up = (issue.reactions && issue.reactions['+1']) || 0;
    l.down = (issue.reactions && issue.reactions['-1']) || 0;
    if (!l.author) {
      const commits = await gh('GET', `/repos/${repo}/commits?path=${encodeURIComponent(l.file)}&per_page=100`);
      const first = commits && commits.length ? commits[commits.length - 1] : null;
      if (first && first.author && first.author.login) l.author = first.author.login;
    }
  }
}

// ------------------------------------------------------------ main

async function main() {
  const mode = process.argv[2] || 'validate';
  const offline = process.argv.includes('--offline') || !process.env.GITHUB_TOKEN;
  const blocked = antiCheat();
  const files = walk();
  let bad = 0;
  const layouts = [];
  const ids = new Set();
  for (const f of files) {
    const r = check(f.text, f.rel, blocked);
    if (ids.has(r.id)) r.errors.push('id used twice: ' + r.id);
    ids.add(r.id);
    if (r.errors.length) { bad++; console.log(`PROBLEM ${f.rel}\n  - ${r.errors.join('\n  - ')}`); continue; }
    if (mode === 'validate') console.log(`ok      ${f.rel}`);
    const preview = {};
    for (const [k, v] of r.entries) if (CONTROLS.some(c => c.toLowerCase() === k.toLowerCase())) preview[k] = v;
    layouts.push({ id: r.id, title: r.meta.title, game: r.meta.game, exe: [r.exe], steam_app_id: r.appId || undefined, family: r.family,
                   author: '', description: r.meta.description || '', file: f.rel, sha256: sha256(f.text), size: Buffer.byteLength(f.text, 'utf8'),
                   preview, text: f.text });
  }
  if (mode === 'validate') { console.log(bad ? `${bad} file(s) with problems` : `${files.length} file(s) OK`); process.exit(bad ? 1 : 0); }
  if (mode !== 'build') { console.log('Usage: node scripts/build-index.js validate | build [--offline]'); process.exit(2); }

  const repo = process.env.GITHUB_REPOSITORY || (readJson(INDEX, {}).repo) || 'omnipad/community-layouts';
  const old = readJson(INDEX, { layouts: [] });
  const prev = {};
  for (const l of old.layouts || []) prev[l.id] = l;
  const stats = readJson(STATS, {});
  for (const l of layouts) {
    const p = prev[l.id] || {};
    l.download_url = `https://github.com/${repo}/releases/download/layouts/${l.id}${EXT}`;
    l.downloads = p.downloads || 0; l.up = p.up || 0; l.down = p.down || 0; l.rate_url = p.rate_url || '';
    l.author = p.author || '';
    l.updated = p.sha256 === l.sha256 && p.updated ? p.updated : new Date().toISOString().slice(0, 19) + 'Z';
  }
  if (!offline) await online(repo, layouts, stats);
  const out = layouts.map(l => ({
    id: l.id, title: l.title, game: l.game, exe: l.exe, steam_app_id: l.steam_app_id, family: l.family, author: l.author,
    description: l.description, file: l.file, download_url: l.download_url, sha256: l.sha256, size: l.size,
    downloads: l.downloads, up: l.up, down: l.down, rating: l.up + l.down ? Math.round(1000 * l.up / (l.up + l.down)) / 1000 : 0,
    rate_url: l.rate_url, updated: l.updated, preview: l.preview
  }));
  const body = { version: 1, repo, generated: old.generated || '', layouts: out };
  const same = JSON.stringify(Object.assign({}, old, { generated: '' })) === JSON.stringify(Object.assign({}, body, { generated: '' }));
  body.generated = same && old.generated ? old.generated : new Date().toISOString().slice(0, 19) + 'Z';
  fs.writeFileSync(INDEX, JSON.stringify(body, null, 1) + '\n');
  if (!offline) fs.writeFileSync(STATS, JSON.stringify(stats, null, 1) + '\n');
  console.log(`index.json: ${out.length} layouts${bad ? `, ${bad} file(s) left out` : ''}${same ? ' (unchanged)' : ''}`);
}

module.exports = { check, systemKey, sha256 };
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
