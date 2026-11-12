// What the Oracle VM's auto-deploy is doing, for the /deploy page.
//
// deploy/oracle/auto-deploy.sh (root, every 5 minutes) writes status.json and
// deploy.log into DEPLOY_STATE_DIR (default /var/lib/prezenty-deploy, readable
// by the app's user). This module reads and cleans them. Both files are
// written by another process, so every value is checked and capped before it
// goes to a browser; the page draws it with textContent only.
//
// Anywhere else (Render, Vercel, a laptop, demo mode) the folder does not
// exist and the answer is { available: false }.
const fs = require('fs');
const path = require('path');

const STATE_DIR = process.env.DEPLOY_STATE_DIR || '/var/lib/prezenty-deploy';
const STALE_MS = 20 * 60 * 1000;   // "deploying" for longer than this = the script is gone
const MAX_LOG_LINES = 80;
const MAX_LOG_BYTES = 64 * 1024;   // only the end of the file is read

const STATES = ['idle', 'deploying', 'rolled_back', 'failed'];
const STEPS = ['pulling', 'installing', 'restarting', 'checking', 'rolling_back'];
const REASONS = ['npm_failed', 'health_failed', 'not_fast_forward', 'script_stopped', 'stale'];
const RESULTS = ['ok', 'rolled_back', 'failed'];

function text(value, max) {
    if (typeof value !== 'string') return null;
    // eslint-disable-next-line no-control-regex
    const cleaned = value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim();
    return cleaned ? cleaned.slice(0, max || 200) : null;
}

function oneOf(value, allowed) {
    return allowed.includes(value) ? value : null;
}

function isoDate(value) {
    if (typeof value !== 'string') return null;
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : new Date(time).toISOString();
}

function commit(value, withDate) {
    if (!value || typeof value !== 'object') return null;
    const sha = typeof value.sha === 'string' && /^[0-9a-f]{7,40}$/i.test(value.sha) ? value.sha.toLowerCase() : null;
    if (!sha) return null;
    const out = { sha, short: sha.slice(0, 7), subject: text(value.subject, 200) };
    if (withDate) out.date = isoDate(value.date);
    return out;
}

// Last lines of deploy.log, cleaned. Missing file = no lines.
function readLog(dir) {
    let fd;
    try {
        fd = fs.openSync(path.join(dir, 'deploy.log'), 'r');
        const size = fs.fstatSync(fd).size;
        const length = Math.min(size, MAX_LOG_BYTES);
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, size - length);
        let lines = buffer.toString('utf8').split('\n');
        if (size > length) lines = lines.slice(1);   // the first line may be cut in half
        return lines.map(line => text(line, 300)).filter(Boolean).slice(-MAX_LOG_LINES);
    } catch (err) {
        return [];
    } finally {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch (err) { /* ignore */ } }
    }
}

function readDeployStatus(options) {
    const dir = (options && options.dir) || STATE_DIR;
    const now = (options && options.now) || Date.now();
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(path.join(dir, 'status.json'), 'utf8'));
    } catch (err) {
        return { available: false };
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { available: false };

    let state = oneOf(raw.state, STATES) || 'idle';
    let reason = oneOf(raw.reason, REASONS);
    let result = oneOf(raw.result, RESULTS);
    let step = oneOf(raw.step, STEPS);
    const startedAt = isoDate(raw.startedAt);

    // The script died without saying so (power cut, kill -9): do not show
    // "deploying" for ever
    if (state === 'deploying' && (!startedAt || now - Date.parse(startedAt) > STALE_MS)) {
        state = 'failed';
        reason = 'stale';
        result = 'failed';
        step = null;
    }

    return {
        available: true,
        state,
        step: state === 'deploying' ? step : null,
        branch: text(raw.branch, 60),
        deployed: commit(raw.deployed, true),
        target: commit(raw.target, false),
        skipped: commit(raw.skipped, false),
        result,
        reason,
        healthyAfterRollback: typeof raw.healthyAfterRollback === 'boolean' ? raw.healthyAfterRollback : null,
        startedAt,
        finishedAt: isoDate(raw.finishedAt),
        checkedAt: isoDate(raw.checkedAt),
        log: readLog(dir),
        serverTime: new Date(now).toISOString()
    };
}

module.exports = { readDeployStatus, STATE_DIR };