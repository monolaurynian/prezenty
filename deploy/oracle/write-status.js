#!/usr/bin/env node
// Records what auto-deploy.sh is doing, for the /deploy page.
//
//   node write-status.js key=value [key.sub=value ...]
//
// Merges the given keys into $STATE_DIR/status.json (default
// /var/lib/prezenty-deploy) and writes it atomically, world-readable (the app
// runs as another user). "a.b=x" sets a nested key, "key=" sets null, and
// "true" / "false" become booleans. Everything else stays a string.
//
// auto-deploy.sh ignores a failure here: a broken status page must never stop
// a deploy. Not part of the app: nothing under lib/ or routes/ requires it.
'use strict';
const fs = require('fs');
const path = require('path');

const dir = process.env.STATE_DIR || '/var/lib/prezenty-deploy';
const file = path.join(dir, 'status.json');

function load() {
    try {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (err) {
        return {};   // missing or damaged: start again
    }
}

function convert(text) {
    if (text === '') return null;
    if (text === 'true') return true;
    if (text === 'false') return false;
    return text;
}

function setPath(target, dotted, value) {
    const keys = dotted.split('.');
    let node = target;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!node[key] || typeof node[key] !== 'object') node[key] = {};
        node = node[key];
    }
    node[keys[keys.length - 1]] = value;
}

const status = load();
for (const arg of process.argv.slice(2)) {
    const at = arg.indexOf('=');
    if (at < 1) continue;
    const key = arg.slice(0, at);
    if (!/^[A-Za-z][A-Za-z0-9_.]*$/.test(key) || /(^|\.)(__proto__|constructor|prototype)(\.|$)/.test(key)) continue;
    setPath(status, key, convert(arg.slice(at + 1)));
}
status.updatedAt = new Date().toISOString();

fs.mkdirSync(dir, { recursive: true });
const temp = file + '.tmp';
fs.writeFileSync(temp, JSON.stringify(status, null, 2) + '\n', { mode: 0o644 });
fs.chmodSync(temp, 0o644);
fs.renameSync(temp, file);