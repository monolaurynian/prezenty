// Moved verbatim from server.js (Phase 2 split)
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { DEMO_MODE, pool } = require('../lib/db');
const { handleDbError, notFound, conflict, badRequest } = require('../lib/http-errors');
const { requireAuth } = require('../lib/auth');
const { cache, clearCombinedDataCache } = require('../lib/cache');

// API Routes

// Login
router.post('/api/login', async (req, res) => {
    console.log('Login request received:', { username: req.body.username, hasPassword: !!req.body.password });
    const { username, password } = req.body;

    if (DEMO_MODE) {
        // Demo mode - accept any login
        if (username && password) {
            console.log('Demo login successful for user:', username);
            req.session.userId = 1;
            req.session.username = username;
            
            // Save session explicitly
            req.session.save((err) => {
                if (err) {
                    console.error('Session save error:', err);
                    return res.status(500).json({ error: 'Błąd zapisu sesji' });
                }
                console.log('Session saved successfully:', {
                    userId: req.session.userId,
                    username: req.session.username
                });
                res.json({ success: true, user: { id: 1, username: username } });
            });
        } else {
            return res.status(401).json({ error: 'Wprowadź nazwę użytkownika i hasło' });
        }
        return;
    }

    try {
        const [rows] = await pool.execute('SELECT * FROM users WHERE username = ?', [username]);
        const user = rows[0];

        if (!user || !bcrypt.compareSync(password, user.password)) {
            console.log('Login failed: invalid credentials for user:', username);
            return res.status(401).json({ error: 'Nieprawidłowa nazwa użytkownika lub hasło' });
        }

        console.log('Login successful for user:', username);
        req.session.userId = user.id;
        req.session.username = user.username;

        console.log('Session created:', { userId: req.session.userId, username: req.session.username });

        // Save session explicitly
        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ error: 'Błąd zapisu sesji' });
            }
            console.log('Session saved successfully:', {
                userId: req.session.userId,
                username: req.session.username
            });
            res.json({ success: true, user: { id: user.id, username: user.username } });
        });
    } catch (err) {
        console.error('Database error during login:', err);
        return handleDbError(err, res, 'Błąd serwera');
    }
});

// Change username - password re-verification required
router.put('/api/account/username', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.status(503).json({ error: 'Niedostępne w trybie demo' });
    const userId = req.session.userId;
    const { newUsername, password } = req.body || {};

    const trimmed = (newUsername || '').trim();
    if (!trimmed || !password) {
        return badRequest(res, 'Podaj nową nazwę użytkownika i hasło');
    }
    if (trimmed.length < 3 || trimmed.length > 30) {
        return badRequest(res, 'Nazwa użytkownika musi mieć od 3 do 30 znaków');
    }

    try {
        const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
        if (rows.length === 0) return notFound(res, 'Nie znaleziono konta');
        if (!bcrypt.compareSync(password, rows[0].password)) {
            return res.status(401).json({ error: 'Nieprawidłowe hasło' });
        }

        const [taken] = await pool.execute(
            'SELECT id FROM users WHERE username = ? AND id != ?',
            [trimmed, userId]
        );
        if (taken.length > 0) {
            return conflict(res, 'Ta nazwa użytkownika jest już zajęta');
        }

        await pool.execute('UPDATE users SET username = ? WHERE id = ?', [trimmed, userId]);
        req.session.username = trimmed;
        clearCombinedDataCache();

        console.log(`✏️ [ACCOUNT] User ${userId} renamed to "${trimmed}"`);
        res.json({ success: true, username: trimmed });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas zmiany nazwy użytkownika');
    }
});

// Delete account - permanent. Password re-verification required.
// The person's presence in the FAMILY DATA is preserved: recipients stay
// (identification unclaimed), presents stay (creator anonymized), but the
// user's reservations are released and their private data removed.
router.delete('/api/account', requireAuth, async (req, res) => {
    if (DEMO_MODE) return res.status(503).json({ error: 'Niedostępne w trybie demo' });
    const userId = req.session.userId;
    const { password } = req.body || {};

    if (!password) {
        return badRequest(res, 'Podaj hasło, aby potwierdzić usunięcie konta');
    }

    try {
        const [rows] = await pool.execute('SELECT * FROM users WHERE id = ?', [userId]);
        if (rows.length === 0) return notFound(res, 'Nie znaleziono konta');
        if (!bcrypt.compareSync(password, rows[0].password)) {
            return res.status(401).json({ error: 'Nieprawidłowe hasło' });
        }

        console.log(`🗑️ [ACCOUNT] Deleting account ${userId} (${rows[0].username})`);

        // Detach family data instead of destroying it
        await pool.execute('UPDATE recipients SET identified_by = NULL WHERE identified_by = ?', [userId]);
        await pool.execute('UPDATE presents SET reserved_by = NULL WHERE reserved_by = ?', [userId]);
        try {
            await pool.execute('UPDATE presents SET created_by = NULL WHERE created_by = ?', [userId]);
        } catch (e) {
            // created_by may still be NOT NULL on old installs - make it nullable and retry
            try {
                await pool.execute('ALTER TABLE presents MODIFY COLUMN created_by INT NULL');
                await pool.execute('UPDATE presents SET created_by = NULL WHERE created_by = ?', [userId]);
            } catch (e2) {
                console.error('⚠️ [ACCOUNT] Could not anonymize created_by:', e2.message);
            }
        }

        // Remove private data (tables without FK cascades)
        try { await pool.execute('DELETE FROM push_subscriptions WHERE user_id = ?', [userId]); } catch (e) {}
        try { await pool.execute('DELETE FROM notifications WHERE user_id = ? OR actor_id = ?', [userId, userId]); } catch (e) {}
        try {
            // Anonymous threads the user participated in (messages cascade)
            await pool.execute('DELETE FROM anon_threads WHERE initiator_id = ? OR target_id = ?', [userId, userId]);
        } catch (e) {}

        // Finally the account itself (FK cascades clean the rest)
        await pool.execute('DELETE FROM users WHERE id = ?', [userId]);

        clearCombinedDataCache();
        cache.invalidatePresents();

        req.session.destroy(() => {});
        console.log(`✅ [ACCOUNT] Account ${userId} deleted`);
        res.json({ success: true });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas usuwania konta');
    }
});

// Logout
router.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Check auth status
router.get('/api/auth', (req, res) => {
    console.log('Auth check - Full session details:', {
        userId: req.session.userId,
        username: req.session.username
    });
    if (req.session.userId) {
        console.log('Auth check: User IS authenticated');
        res.json({ authenticated: true, user: { id: req.session.userId, username: req.session.username } });
    } else {
        console.log('Auth check: User NOT authenticated');
        res.json({ authenticated: false });
    }
});

// Registered later than the rest of this router, at the position these routes have always had
// in the request pipeline (see server.js), so the registered route order is unchanged.
const lateRouter = express.Router();

// Registration API
lateRouter.post('/api/register', async (req, res) => {
    console.log('Registration request received:', { username: req.body.username, hasPassword: !!req.body.password });
    const { username, password } = req.body;

    if (!username || !password) {
        console.log('Registration failed: missing username or password');
        return badRequest(res, 'Wymagane jest podanie nazwy użytkownika i hasła');
    }

    if (DEMO_MODE) {
        // Demo mode - simulate registration
        console.log('Demo mode registration for:', username);

        // In demo mode, just log them in as the demo user
        req.session.userId = 1;
        req.session.username = username;

        console.log('Demo registration successful:', { userId: 1, username: username });
        res.json({ success: true, user: { id: 1, username: username } });
        return;
    }

    try {
        console.log('Checking if username exists:', username);
        const [rows] = await pool.execute('SELECT id FROM users WHERE username = ?', [username]);

        if (rows.length > 0) {
            console.log('Registration failed: username already exists:', username);
            return conflict(res, 'Nazwa użytkownika jest już zajęta');
        }

        console.log('Creating new user:', username);
        const hashedPassword = bcrypt.hashSync(password, 10);
        const [result] = await pool.execute('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);

        console.log('User created successfully:', { id: result.insertId, username: username });

        // Automatycznie loguj użytkownika po rejestracji
        req.session.userId = result.insertId;
        req.session.username = username;

        console.log('Session created:', { userId: req.session.userId, username: req.session.username });

        res.json({ success: true, user: { id: result.insertId, username: username } });
    } catch (err) {
        console.error('Database error during registration:', err);
        return handleDbError(err, res, 'Błąd podczas rejestracji');
    }
});

module.exports = { router, lateRouter };
