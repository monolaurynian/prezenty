// Moved verbatim from server.js (Phase 2 split)
const { pool } = require('./db');
const { cache } = require('./cache');

// A recipient's columns WITHOUT the picture's bytes. profile_picture is a
// LONGBLOB: `SELECT r.*` pulled every picture out of the database on each
// list load (and sent it, as a JSON array of numbers, from
// /api/user/identification). The pages only need to know whether there is a
// picture; it is served by GET /api/recipients/:id/profile-picture.
// Pair with withPictureUrl().
const RECIPIENT_COLUMNS = `r.id, r.name, r.identified_by, r.profile_picture_type, r.created_at, r.updated_at,
                   CASE WHEN r.profile_picture IS NOT NULL THEN 1 ELSE 0 END as has_profile_picture`;

// Row from a query using RECIPIENT_COLUMNS -> the shape the pages expect:
// profile_picture is the picture's URL, or null
const withPictureUrl = (row) => {
    if (!row) return row;
    const { has_profile_picture, ...rest } = row;
    return { ...rest, profile_picture: has_profile_picture ? `/api/recipients/${row.id}/profile-picture` : null };
};

// Helper to get user identification status
const getUserIdentification = async (userId) => {
    try {
        const [rows] = await pool.execute(`SELECT ${RECIPIENT_COLUMNS} FROM recipients r WHERE r.identified_by = ?`, [userId]);
        return withPictureUrl(rows[0]) || null;
    } catch (err) {
        throw err;
    }
};

// Helper to get recipient by ID
const getRecipientById = async (id) => {
    try {
        const [rows] = await pool.execute(`
            SELECT ${RECIPIENT_COLUMNS}, u.username as identified_by_username 
            FROM recipients r 
            LEFT JOIN users u ON r.identified_by = u.id 
            WHERE r.id = ?
        `, [id]);
        return withPictureUrl(rows[0]) || null;
    } catch (err) {
        throw err;
    }
};

// Helper to get all presents with recipient and user info
const getAllPresents = async () => {
    const cacheKey = 'all_presents';
    const cached = cache.get(cacheKey);
    if (cached) {
        console.log('Using cached presents data');
        return cached;
    }

    try {
        const [rows] = await pool.execute(`
            SELECT p.id, p.title, p.recipient_id, p.comments, p.is_checked, p.reserved_by, p.created_by, p.created_at,
                   r.name as recipient_name, u.username as reserved_by_username
            FROM presents p 
            LEFT JOIN recipients r ON p.recipient_id = r.id 
            LEFT JOIN users u ON p.reserved_by = u.id
            ORDER BY p.id DESC
        `);

        cache.set(cacheKey, rows);
        return rows;
    } catch (err) {
        throw err;
    }
};

module.exports = { getUserIdentification, getRecipientById, getAllPresents, RECIPIENT_COLUMNS, withPictureUrl };
