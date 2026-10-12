// Moved verbatim from server.js (Phase 2 split)

// Helper functions to reduce code duplication
const handleDbError = (err, res, message = 'Błąd serwera') => {
    console.error('Database error:', err);
    res.status(500).json({ error: message });
};

const notFound = (res, message = 'Nie znaleziono') => {
    res.status(404).json({ error: message });
};

const forbidden = (res, message = 'Brak uprawnień') => {
    res.status(403).json({ error: message });
};

const conflict = (res, message = 'Konflikt') => {
    res.status(409).json({ error: message });
};

const badRequest = (res, message = 'Nieprawidłowe dane') => {
    res.status(400).json({ error: message });
};

module.exports = { handleDbError, notFound, forbidden, conflict, badRequest };
