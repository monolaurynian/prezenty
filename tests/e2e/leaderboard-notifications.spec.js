'use strict';
/**
 * Who gets told when a ranking changes (lib/leaderboard.js).
 *
 * Rules locked in here, for both rankings (presents, "najbardziej aktywni"):
 *  - first place changes hands -> a leader notification (+ push);
 *  - someone takes second place -> a second-place notification, in-app only;
 *  - a tie is never an overtake: whoever was ahead stays ahead, even when the
 *    other name sorts first;
 *  - the old leader slipping to second, or the old second moving up to first,
 *    is not a second-place event.
 * Pure logic: no database, no browser. The notify functions run against
 * stand-ins for the database, push and notification modules.
 */
const path = require('path');
const { test, expect } = require('../fixtures');

const ROOT = path.join(__dirname, '..', '..');
const MOCKED = ['lib/db.js', 'lib/push.js', 'lib/notifications.js'].map(rel => require.resolve(path.join(ROOT, rel)));
const LEADERBOARD = require.resolve(path.join(ROOT, 'lib', 'leaderboard.js'));

let rows = [];
const created = [];
const pushes = [];
let lib;
const saved = {};

test.beforeAll(() => {
    MOCKED.concat(LEADERBOARD).forEach(file => { saved[file] = require.cache[file]; delete require.cache[file]; });
    const stub = (rel, exports) => {
        const file = require.resolve(path.join(ROOT, rel));
        require.cache[file] = { id: file, filename: file, loaded: true, exports };
    };
    stub('lib/db.js', { DEMO_MODE: false, pool: { execute: async () => [rows] } });
    stub('lib/push.js', { sendNotificationToUsers: async (...args) => { pushes.push(args); } });
    stub('lib/notifications.js', { createNotification: async (...args) => { created.push(args); } });
    lib = require(LEADERBOARD);
});

test.afterAll(() => {
    MOCKED.concat(LEADERBOARD).forEach(file => {
        if (saved[file]) require.cache[file] = saved[file]; else delete require.cache[file];
    });
});

test.beforeEach(() => { created.length = 0; pushes.length = 0; });

const person = (id, name, count) => ({ id, name, count });
// rows already ordered best first, like the SQL does
const snap = (...people) => lib.makeSnapshot(people);
const types = () => created.map(call => call[0]);

test.describe('detectChanges', () => {
    test('same leader growing is not news', () => {
        const changes = lib.detectChanges(snap(person(1, 'Ala', 2), person(2, 'Bob', 1)), snap(person(1, 'Ala', 4), person(2, 'Bob', 1)));
        expect(changes).toEqual({ leader: null, second: null });
    });

    test('first activity ever: a leader, but no second place yet', () => {
        const changes = lib.detectChanges(snap(), snap(person(1, 'Ala', 2)));
        expect(changes.leader).toEqual({ previousLeader: null });
        expect(changes.second).toBeNull();
    });

    test('a tie is not an overtake, even when the other name sorts first', () => {
        const before = snap(person(2, 'Zed', 3), person(1, 'Ala', 2));
        const after = snap(person(1, 'Ala', 3), person(2, 'Zed', 3));   // tied, Ala sorts first
        expect(lib.detectChanges(before, after)).toEqual({ leader: null, second: null });
    });

    test('a real overtake names who was passed, and the old leader slipping to second is silent', () => {
        const before = snap(person(2, 'Zed', 3), person(1, 'Ala', 2), person(3, 'Cy', 1));
        const after = snap(person(1, 'Ala', 4), person(2, 'Zed', 3), person(3, 'Cy', 1));
        const changes = lib.detectChanges(before, after);
        expect(changes.leader.previousLeader.name).toBe('Zed');
        expect(changes.second).toBeNull();
    });

    test('passing the person in second place is a second-place event', () => {
        const before = snap(person(1, 'Ala', 5), person(2, 'Bob', 3), person(3, 'Cy', 2));
        const after = snap(person(1, 'Ala', 5), person(3, 'Cy', 4), person(2, 'Bob', 3));
        const changes = lib.detectChanges(before, after);
        expect(changes.leader).toBeNull();
        expect(changes.second.previousSecond.name).toBe('Bob');
    });

    test('tying the person in second place is silent', () => {
        const before = snap(person(1, 'Ala', 5), person(2, 'Bob', 3), person(3, 'Cy', 2));
        const after = snap(person(1, 'Ala', 5), person(3, 'Cy', 3), person(2, 'Bob', 3));   // Cy sorts first
        expect(lib.detectChanges(before, after).second).toBeNull();
    });

    test('the old second moving up to first does not make the new second a news item', () => {
        const before = snap(person(1, 'Ala', 5), person(2, 'Bob', 3), person(3, 'Cy', 2));
        const after = snap(person(2, 'Bob', 6), person(1, 'Ala', 5), person(3, 'Cy', 2));
        const changes = lib.detectChanges(before, after);
        expect(changes.leader.previousLeader.name).toBe('Ala');
        expect(changes.second).toBeNull();   // Ala only slipped down
    });

    test('the leader losing points: the next one up leads, the one below is only promoted', () => {
        const before = snap(person(1, 'Ala', 5), person(2, 'Bob', 4), person(3, 'Cy', 2));
        const after = snap(person(2, 'Bob', 4), person(3, 'Cy', 2));
        const changes = lib.detectChanges(before, after);
        expect(changes.leader.previousLeader.name).toBe('Ala');
        expect(changes.second).toBeNull();
    });

    test('a second person appearing is not "taking" second place from anyone', () => {
        const changes = lib.detectChanges(snap(person(1, 'Ala', 5)), snap(person(1, 'Ala', 5), person(2, 'Bob', 1)));
        expect(changes.second).toBeNull();
    });

    test('nobody left: nothing to say', () => {
        expect(lib.detectChanges(snap(person(1, 'Ala', 1)), snap())).toEqual({ leader: null, second: null });
    });
});

test.describe('notify functions', () => {
    test('presents ranking: a tie creates no notification, an overtake creates leader + push, second is in-app only', async () => {
        const raw = (id, name, n) => ({ id, name, total_presents: n });
        const before = lib.makeSnapshot([person(2, 'Zed', 3), person(1, 'Ala', 2), person(3, 'Cy', 1)]);

        rows = [raw(1, 'Ala', 3), raw(2, 'Zed', 3), raw(3, 'Cy', 1)];   // tie
        await lib.notifyLeaderboardChange(before, 9);
        expect(created).toEqual([]);

        rows = [raw(1, 'Ala', 4), raw(2, 'Zed', 3), raw(3, 'Cy', 1)];    // overtake
        await lib.notifyLeaderboardChange(before, 9);
        expect(types()).toEqual(['leaderboard_leader']);
        expect(created[0][1]).toBe(9);
        expect(created[0][2]).toMatchObject({ leaderName: 'Ala', previousLeaderName: 'Zed', presentCount: 4 });
        expect(pushes).toHaveLength(1);

        created.length = 0; pushes.length = 0;
        const steady = lib.makeSnapshot([person(1, 'Ala', 5), person(2, 'Bob', 3), person(3, 'Cy', 2)]);
        rows = [raw(1, 'Ala', 5), raw(3, 'Cy', 4), raw(2, 'Bob', 3)];    // Cy passes Bob
        await lib.notifyLeaderboardChange(steady, 9);
        expect(types()).toEqual(['leaderboard_second']);
        expect(created[0][2]).toMatchObject({ secondName: 'Cy', previousSecondName: 'Bob', presentCount: 4 });
        expect(pushes).toHaveLength(0);
    });

    test('activity ranking: leader change + second place in one go, push only for the leader', async () => {
        const raw = (id, name, n) => ({ id, name, activity: n });
        const before = lib.makeSnapshot([person(1, 'Ala', 5), person(2, 'Bob', 4), person(3, 'Cy', 2)]);
        rows = [raw(3, 'Cy', 9), raw(2, 'Bob', 4), raw(1, 'Ala', 5)].sort((a, b) => b.activity - a.activity);   // Cy jumps to first
        await lib.notifyActivityLeaderChange(before, 9);
        // Cy leads; Ala (the old leader) just slips to second, so no second-place event
        expect(types()).toEqual(['activity_leader']);
        expect(created[0][2]).toMatchObject({ leaderName: 'Cy', previousLeaderName: 'Ala', activityCount: 9 });
        expect(pushes).toHaveLength(1);

        created.length = 0; pushes.length = 0;
        const steady = lib.makeSnapshot([person(1, 'Ala', 5), person(2, 'Bob', 3), person(3, 'Cy', 2)]);
        rows = [raw(1, 'Ala', 5), raw(3, 'Cy', 4), raw(2, 'Bob', 3)];
        await lib.notifyActivityLeaderChange(steady, 9);
        expect(types()).toEqual(['activity_second']);
        expect(created[0][2]).toMatchObject({ secondName: 'Cy', previousSecondName: 'Bob', activityCount: 4 });
        expect(pushes).toHaveLength(0);
    });

    test('a failed snapshot (null) never throws and never invents a second place', async () => {
        rows = [{ id: 1, name: 'Ala', activity: 3 }, { id: 2, name: 'Bob', activity: 2 }];
        await lib.notifyActivityLeaderChange(null, 9);
        expect(types()).toEqual(['activity_leader']);   // the old behaviour for a missing snapshot
    });
});