// Moved verbatim from server.js (Phase 2 split)
const { DEMO_MODE, pool } = require('./db');
const { sendNotificationToUsers } = require('./push');
const { createNotification } = require('./notifications');

// ---- Leaderboard change detection ----
// Two rankings: presents on a person's wishlist, and "najbardziej aktywni"
// (presents a person bought + reserved). After a change, the route compares a
// snapshot taken BEFORE it with a fresh one:
//   - first place changes hands  -> in-app notification + push to everyone
//   - someone takes second place -> in-app notification only (no push)
// The actor is never notified. A tie is not an overtake: whoever was ahead
// stays ahead, even if the other name sorts first.
//
// A snapshot is { leader, second, scores }: the top two { id, name, count }
// and every ranked person's count by id.

// rows: already sorted best first, each { id, name, count }
function makeSnapshot(rows) {
    const scores = {};
    rows.forEach(row => { scores[row.id] = row.count; });
    return { leader: rows[0] || null, second: rows[1] || null, scores };
}

// Which notifications does going from `previous` to `current` call for?
// -> { leader: { previousLeader } | null, second: { previousSecond } | null }
function detectChanges(previous, current) {
    const out = { leader: null, second: null };
    const newLeader = current && current.leader;
    if (!newLeader) return out;
    const scoreNow = (person) => current.scores[person.id] || 0;
    const prevLeader = previous && previous.leader;
    const prevSecond = previous && previous.second;

    // First place: a different person AND strictly ahead of the old leader now
    const sameLeader = prevLeader && prevLeader.id === newLeader.id;
    const onlyTied = prevLeader && newLeader.count <= scoreNow(prevLeader);
    if (!sameLeader && !onlyTied) out.leader = { previousLeader: prevLeader || null };

    // Second place: a different person who got strictly past the old second.
    // Not when there was no second before (nobody to take it from), not for the
    // old leader slipping down, and not when the old second moved UP to first
    // (the person now second was only promoted, they passed nobody).
    const newSecond = current.second;
    if (newSecond && prevSecond
        && newSecond.id !== prevSecond.id
        && !(prevLeader && newSecond.id === prevLeader.id)
        && newSecond.count > scoreNow(prevSecond)) {
        out.second = { previousSecond: prevSecond };
    }
    return out;
}

// Presents ranking
async function getLeaderboardLeader() {
    const [rows] = await pool.execute(`
        SELECT r.id, r.name, COUNT(p.id) as total_presents
        FROM recipients r
        LEFT JOIN presents p ON p.recipient_id = r.id
        GROUP BY r.id, r.name
        HAVING total_presents > 0
        ORDER BY total_presents DESC, r.name ASC
    `);
    return makeSnapshot(rows.map(row => ({ id: row.id, name: row.name, count: Number(row.total_presents) })));
}

function presentsNoun(count) {
    return count === 1 ? 'prezentem' : 'prezentami';
}

// `previous` is what getLeaderboardLeader() returned BEFORE the change
async function notifyLeaderboardChange(previous, actorId) {
    try {
        if (DEMO_MODE) return;
        const current = await getLeaderboardLeader();
        const changes = detectChanges(previous, current);

        if (changes.leader) {
            const newLeader = current.leader;
            const previousLeader = changes.leader.previousLeader;
            const count = newLeader.count;
            console.log(`🏆 [LEADERBOARD] New leader: ${newLeader.name} (${count} presents)`);
            await createNotification('leaderboard_leader', actorId || 0, {
                leaderName: newLeader.name,
                leaderId: newLeader.id,
                presentCount: count,
                previousLeaderName: previousLeader ? previousLeader.name : null
            });

            // Push notification too - a lead change is a fun, rare event.
            // data.url makes the SW open the ranking page on tap.
            const pushBody = previousLeader
                ? `${newLeader.name} wyprzedza ${previousLeader.name} i prowadzi z ${count} ${presentsNoun(count)}!`
                : `${newLeader.name} prowadzi w rankingu z ${count} ${presentsNoun(count)}!`;
            sendNotificationToUsers(actorId || 0, 'Zmiana w rankingu! 🏆', pushBody, {
                leaderboard: true,
                url: '/leaderboard.html'
            }).catch(err => {
                console.error('❌ [LEADERBOARD] Push send failed (non-fatal):', err);
            });
        }

        if (changes.second) {
            const newSecond = current.second;
            console.log(`🥈 [LEADERBOARD] New second place: ${newSecond.name} (${newSecond.count} presents)`);
            await createNotification('leaderboard_second', actorId || 0, {
                secondName: newSecond.name,
                secondId: newSecond.id,
                presentCount: newSecond.count,
                previousSecondName: changes.second.previousSecond.name
            });
        }
    } catch (err) {
        console.error('❌ [LEADERBOARD] Error checking leaderboard change:', err);
    }
}

// ---- "Najbardziej aktywni" (activity) ----
// Activity = presents a person bought + presents they reserved (a bought
// present is also reserved, so it counts twice - the same sum the
// leaderboard page shows). It is counted for the person's identified
// account (recipients.identified_by).
async function getActivityLeader() {
    const [rows] = await pool.execute(`
        SELECT id, name, activity FROM (
            SELECT r.id, r.name,
                (SELECT COUNT(*) FROM presents WHERE reserved_by = r.identified_by AND is_checked = 1)
                + (SELECT COUNT(*) FROM presents WHERE reserved_by = r.identified_by) AS activity
            FROM recipients r
            WHERE r.identified_by IS NOT NULL
        ) scored
        WHERE activity > 0
        ORDER BY activity DESC, name ASC
    `);
    return makeSnapshot(rows.map(row => ({ id: row.id, name: row.name, count: Number(row.activity) })));
}

function activityNoun(count) {
    return count === 1 ? 'aktywnością' : 'aktywnościami';
}

// `previous` is what getActivityLeader() returned BEFORE the change
async function notifyActivityLeaderChange(previous, actorId) {
    try {
        if (DEMO_MODE) return;
        const current = await getActivityLeader();
        const changes = detectChanges(previous, current);

        if (changes.leader) {
            const newLeader = current.leader;
            const previousLeader = changes.leader.previousLeader;
            const count = newLeader.count;
            console.log(`🔥 [LEADERBOARD] New activity leader: ${newLeader.name} (${count})`);
            await createNotification('activity_leader', actorId || 0, {
                leaderName: newLeader.name,
                leaderId: newLeader.id,
                activityCount: count,
                previousLeaderName: previousLeader ? previousLeader.name : null
            });

            const pushBody = previousLeader
                ? `${newLeader.name} wyprzedza ${previousLeader.name} i prowadzi z ${count} ${activityNoun(count)}!`
                : `${newLeader.name} prowadzi w rankingu aktywności z ${count} ${activityNoun(count)}!`;
            sendNotificationToUsers(actorId || 0, 'Zmiana w rankingu aktywności! 🔥', pushBody, {
                leaderboard: true,
                url: '/leaderboard.html'
            }).catch(err => {
                console.error('❌ [LEADERBOARD] Activity push send failed (non-fatal):', err);
            });
        }

        if (changes.second) {
            const newSecond = current.second;
            console.log(`🥈 [LEADERBOARD] New activity second place: ${newSecond.name} (${newSecond.count})`);
            await createNotification('activity_second', actorId || 0, {
                secondName: newSecond.name,
                secondId: newSecond.id,
                activityCount: newSecond.count,
                previousSecondName: changes.second.previousSecond.name
            });
        }
    } catch (err) {
        console.error('❌ [LEADERBOARD] Error checking activity leader change:', err);
    }
}

module.exports = { getLeaderboardLeader, notifyLeaderboardChange, getActivityLeader, notifyActivityLeaderChange, detectChanges, makeSnapshot };