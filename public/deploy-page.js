// /deploy: shows what the Oracle VM's auto-deploy is doing, from
// GET /api/deploy-status. Everything from the server is drawn with
// textContent only (it comes from files another process writes).
//
// While a deploy runs the page asks every 2 s; otherwise every 15 s. The app
// restarts in the middle of a deploy, so a failed request while a deploy was
// running is shown as "restarting", not as an error, and polling goes on.
(function () {
    'use strict';

    const FAST_MS = 2000;
    const SLOW_MS = 15000;
    const RETRY_MS = 3000;
    const CHECK_EVERY_MIN = 5;   // deploy/oracle/prezenty-deploy.timer

    const STEPS = ['pulling', 'installing', 'restarting', 'checking'];
    const STEP_TEXT = {
        pulling: 'pobieranie zmian z GitHuba',
        installing: 'instalowanie zależności',
        restarting: 'restart aplikacji',
        checking: 'sprawdzanie, czy aplikacja działa',
        rolling_back: 'wycofywanie zmian'
    };
    const REASON_TEXT = {
        npm_failed: 'instalacja zależności się nie powiodła',
        health_failed: 'aplikacja nie przeszła kontroli po starcie',
        not_fast_forward: 'nie można scalić zmian (lokalne zmiany na serwerze?)',
        script_stopped: 'skrypt wdrożenia zatrzymał się niespodziewanie',
        stale: 'skrypt wdrożenia przestał odpowiadać'
    };

    const statusLine = document.getElementById('statusLine');
    const facts = document.getElementById('facts');
    const logBox = document.getElementById('log');

    let last = null;          // last good answer
    let lastLogKey = null;
    let timer = null;

    function node(tag, className, text) {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    function ago(iso) {
        const time = Date.parse(iso);
        if (!iso || Number.isNaN(time)) return '';
        const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
        if (seconds < 10) return 'przed chwilą';
        if (seconds < 60) return seconds + ' s temu';
        if (seconds < 3600) return Math.floor(seconds / 60) + ' min temu';
        if (seconds < 86400) return Math.floor(seconds / 3600) + ' godz. temu';
        return new Date(time).toLocaleDateString('pl-PL');
    }

    function setStatus(kind, label, detail) {
        statusLine.className = 'term-status is-' + kind;
        statusLine.textContent = '';
        statusLine.appendChild(node('span', 'dot', '●'));
        statusLine.appendChild(document.createTextNode(label));
        if (detail) {
            statusLine.appendChild(document.createTextNode('  '));
            statusLine.appendChild(node('span', 'detail', detail));
        }
    }

    function progressBar(step) {
        const index = STEPS.indexOf(step);
        if (index < 0) return '';
        return '[' + '#'.repeat(index + 1) + '.'.repeat(STEPS.length - index - 1) + '] krok ' + (index + 1) + '/' + STEPS.length + ': ';
    }

    function fact(label, commit, when) {
        facts.appendChild(node('dt', '', label));
        const value = node('dd');
        if (commit) {
            value.appendChild(node('span', 'sha', commit.short));
            value.appendChild(document.createTextNode(commit.subject || ''));
        }
        if (when) {
            value.appendChild(document.createTextNode(commit ? ' ' : ''));
            value.appendChild(node('span', 'ago', when));
        }
        facts.appendChild(value);
    }

    function renderStatus(data) {
        if (!data.available) {
            setStatus('none', 'BRAK DANYCH',
                'ten serwer nie jest wdrażany przez maszynę Oracle albo nic jeszcze nie wdrożono');
            return;
        }
        if (data.state === 'deploying') {
            const step = data.step ? progressBar(data.step) + (STEP_TEXT[data.step] || '') : 'start';
            setStatus('busy', 'WDRAŻANIE', step);
        } else if (data.state === 'rolled_back') {
            if (data.healthyAfterRollback === false) {
                setStatus('bad', 'BŁĄD', 'aplikacja nie odpowiada nawet po wycofaniu zmian');
            } else {
                const why = REASON_TEXT[data.reason] || 'wdrożenie się nie udało';
                setStatus('bad', 'WYCOFANO', 'nowa wersja odrzucona (' + why + '), działa poprzednia');
            }
        } else if (data.state === 'failed') {
            setStatus('bad', 'BŁĄD', REASON_TEXT[data.reason] || 'wdrożenie się nie udało');
        } else {
            setStatus('ok', 'GOTOWE', 'aplikacja działa na najnowszej wersji');
        }
    }

    function renderFacts(data) {
        facts.textContent = '';
        if (!data.available) return;
        if (data.deployed) fact('na serwerze', data.deployed, ago(data.deployed.date));
        if (data.state === 'deploying' && data.target) fact('wdrażane', data.target, ago(data.startedAt));
        if (data.state === 'rolled_back' && data.skipped) fact('odrzucone', data.skipped, ago(data.finishedAt));
        if (data.checkedAt) fact('sprawdzono', null, ago(data.checkedAt) + ' (co ' + CHECK_EVERY_MIN + ' min)');
    }

    function lineClass(text) {
        if (/FAILED|unhealthy|cannot|Stopped unexpectedly/i.test(text)) return 'is-bad';
        if (/^Deployed |healthy on/.test(text)) return 'is-ok';
        if (/^Deploying |installing/.test(text)) return 'is-busy';
        return '';
    }

    function renderLog(data) {
        const lines = data.available ? data.log || [] : [];
        const key = lines.join('\n');
        if (key === lastLogKey) return;
        lastLogKey = key;
        const atBottom = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 24;
        logBox.textContent = '';
        if (!lines.length) {
            logBox.appendChild(node('span', 'empty', '(pusto)'));
            return;
        }
        lines.forEach(function (line) {
            // "2026-11-12T21:23:28+00:00 Deployed abc." -> "21:23:28 Deployed abc."
            const match = /^(\d{4}-\d{2}-\d{2}T\S+)\s+(.*)$/.exec(line);
            const time = match ? Date.parse(match[1]) : NaN;
            const message = match ? match[2] : line;
            const row = node('span', 'row ' + lineClass(message));
            if (!Number.isNaN(time)) row.appendChild(node('span', 'time', new Date(time).toLocaleTimeString('pl-PL')));
            row.appendChild(document.createTextNode(message));
            logBox.appendChild(row);
        });
        if (atBottom) logBox.scrollTop = logBox.scrollHeight;
    }

    function render(data) {
        renderStatus(data);
        renderFacts(data);
        renderLog(data);
    }

    function schedule(ms) {
        clearTimeout(timer);
        timer = setTimeout(poll, ms);
    }

    function poll() {
        if (document.hidden) { schedule(SLOW_MS); return; }
        fetch('/api/deploy-status', { cache: 'no-store', credentials: 'same-origin' })
            .then(function (response) {
                if (response.status === 401) { window.location.href = '/'; return null; }
                if (!response.ok) throw new Error('HTTP ' + response.status);
                return response.json();
            })
            .then(function (data) {
                if (!data) return;
                last = data;
                render(data);
                schedule(data.available && data.state === 'deploying' ? FAST_MS : SLOW_MS);
            })
            .catch(function () {
                // The app restarts in the middle of a deploy: that is expected
                if (last && last.state === 'deploying') {
                    setStatus('busy', 'RESTART', 'aplikacja się restartuje, to potrwa chwilę…');
                } else {
                    setStatus('bad', 'BRAK POŁĄCZENIA', 'próbuję ponownie…');
                }
                schedule(RETRY_MS);
            });
    }

    document.addEventListener('visibilitychange', function () {
        if (!document.hidden) poll();
    });
    // "5 min temu" keeps counting between answers
    setInterval(function () { if (last) renderFacts(last); }, 10000);
    poll();
})();