#!/usr/bin/env node
'use strict';
/**
 * Builds public/styles.deduped.min.css from public/styles.css using the plugins in
 * postcss.config.js (PurgeCSS, then cssnano). See public/CSS-README.md.
 *
 *   node scripts/build-css.js [--out <path>] [--check | --report] [--force] [--help]
 *
 *   (no flags)    build and write public/styles.deduped.min.css (needs --force, see FROZEN)
 *   --out <path>  build and write <path> instead (parent directories are created)
 *   --check       build in memory, compare with the committed file, exit 1 on any difference
 *   --report      same comparison, always exit 0
 *   --force       allow overwriting public/styles.deduped.min.css while FROZEN is true
 *
 * Input and output are normalised to LF: the working tree is CRLF on Windows
 * (core.autocrlf), git stores LF, and the build must give the same bytes everywhere.
 * The result also depends on the locked versions of postcss, purgecss, cssnano,
 * browserslist and caniuse-lite (package-lock.json), so run it after `npm ci`.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO_ROOT = path.resolve(__dirname, '..');
const SOURCE = 'public/styles.css';
const TARGET = 'public/styles.deduped.min.css';

/**
 * styles.deduped.min.css is a hand-patched derivative of an old styles.css build and is NOT
 * reproducible from today's sources (see public/CSS-README.md, "Frozen artifact"). While this
 * is true the script refuses to overwrite it unless --force is given. Set to false only after
 * the regenerated file has been proven visually identical.
 */
const FROZEN = true;

function parseArgs(argv) {
    const o = { out: null, check: false, report: false, force: false, help: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--out') {
            o.out = argv[++i];
            if (!o.out) fail('--out needs a path');
        } else if (a === '--check') o.check = true;
        else if (a === '--report') o.report = true;
        else if (a === '--force') o.force = true;
        else if (a === '--help' || a === '-h') o.help = true;
        else fail('unknown argument: ' + a);
    }
    if (o.check && o.report) fail('use either --check or --report');
    return o;
}

function fail(msg) {
    console.error('build-css: ' + msg);
    process.exit(2);
}

const lf = s => s.replace(/\r\n/g, '\n');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const normSel = s => s.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').trim();

/** Rule list keyed by "context | selector"; keyframe steps and nested rules included. */
function ruleMap(postcss, css) {
    const out = new Map();
    postcss.parse(css).walkRules(rule => {
        const ctx = [];
        for (let p = rule.parent; p && p.type !== 'root'; p = p.parent) {
            ctx.unshift(p.type === 'rule' ? '{' + normSel(p.selector) + '}' : '@' + p.name + ' ' + String(p.params).replace(/\s+/g, ' '));
        }
        const base = (ctx.length ? ctx.join(' > ') + ' | ' : '') + normSel(rule.selector);
        let key = base;
        for (let n = 1; out.has(key); n++) key = base + ' #' + (n + 1);
        const decls = [];
        rule.each(d => {
            if (d.type === 'decl') decls.push(d.prop + ':' + String(d.value).replace(/\s+/g, ' ') + (d.important ? '!important' : ''));
        });
        out.set(key, decls.join(';'));
    });
    return out;
}

function drift(postcss, committed, built) {
    const a = ruleMap(postcss, committed);
    const b = ruleMap(postcss, built);
    const res = { committedRules: a.size, builtRules: b.size, identical: 0, changed: [], onlyCommitted: [], onlyBuilt: [] };
    for (const [k, v] of a) {
        if (!b.has(k)) res.onlyCommitted.push(k);
        else if (b.get(k) === v) res.identical++;
        else res.changed.push(k);
    }
    for (const k of b.keys()) if (!a.has(k)) res.onlyBuilt.push(k);
    return res;
}

function printDrift(d) {
    console.log('rules: committed=' + d.committedRules + ' built=' + d.builtRules +
        ' identical=' + d.identical + ' changed=' + d.changed.length +
        ' only-in-committed=' + d.onlyCommitted.length + ' only-in-built=' + d.onlyBuilt.length);
    const list = (title, arr) => {
        if (!arr.length) return;
        console.log(title + ' (first 20 of ' + arr.length + '):');
        arr.slice(0, 20).forEach(k => console.log('  ' + (k.length > 140 ? k.slice(0, 137) + '...' : k)));
    };
    list('changed declarations', d.changed);
    list('only in committed file', d.onlyCommitted);
    list('only in rebuilt file', d.onlyBuilt);
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    if (opts.help) {
        console.log('usage: node scripts/build-css.js [--out <path>] [--check | --report] [--force]\n' +
            '  Builds ' + TARGET + ' from ' + SOURCE + ' with postcss.config.js (LF output).\n' +
            '  --out <path>  write the build there instead\n' +
            '  --check       compare a fresh build with the committed file, exit 1 if different\n' +
            '  --report      same comparison, always exit 0\n' +
            '  --force       allow overwriting ' + TARGET + ' while it is a frozen artifact (FROZEN in this script)');
        return;
    }
    // Resolve user paths before chdir; PurgeCSS globs in postcss.config.js are CWD-relative.
    const outPath = opts.out ? path.resolve(process.cwd(), opts.out) : null;
    process.chdir(REPO_ROOT);

    // Refuse before doing any work.
    const targetFile = path.join(REPO_ROOT, TARGET);
    const dest = outPath || targetFile;
    if (!opts.check && !opts.report && path.resolve(dest) === path.resolve(targetFile) && FROZEN && !opts.force) {
        fail(TARGET + ' is a frozen artifact: it is hand-patched and a rebuild changes rules and computed styles.\n' +
            '  Build elsewhere with --out <path>, compare with --report, or pass --force to overwrite it\n' +
            '  (then prove it with the snapshot harness first). See public/CSS-README.md.');
    }

    let postcss, plugins;
    try {
        postcss = require('postcss');
        plugins = require('../postcss.config.js').plugins;
    } catch (e) {
        fail('build tools missing (' + e.message.split('\n')[0] + '). Run `npm install` (they are devDependencies).');
    }

    const source = lf(fs.readFileSync(path.join(REPO_ROOT, SOURCE), 'utf8'));
    const result = await postcss(plugins).process(source, { from: SOURCE, to: TARGET, map: false });
    const built = lf(result.css);

    if (opts.check || opts.report) {
        const committed = lf(fs.readFileSync(targetFile, 'utf8'));
        const same = committed === built;
        console.log(SOURCE + ': ' + Buffer.byteLength(source) + ' B -> rebuilt ' + Buffer.byteLength(built) + ' B sha256 ' + sha256(built));
        console.log(TARGET + ': ' + Buffer.byteLength(committed) + ' B sha256 ' + sha256(committed));
        if (same) {
            console.log('in sync: the committed file equals a fresh build');
            return;
        }
        console.log('NOT in sync: the committed file differs from a fresh build');
        printDrift(drift(postcss, committed, built));
        if (opts.check) process.exit(1);
        return;
    }

    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, built);
    console.log(SOURCE + ': ' + Buffer.byteLength(source) + ' B');
    const shown = path.relative(REPO_ROOT, dest);
    console.log((shown.startsWith('..') ? dest : shown).replace(/\\/g, '/') + ': ' + Buffer.byteLength(built) + ' B');
    console.log('sha256 ' + sha256(built));
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
