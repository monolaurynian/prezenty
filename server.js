const express = require('express');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
const mysql = require('mysql2/promise');
const MySQLStore = require('express-mysql-session')(session);

// Load .env file in development, but not in production
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// MySQL database configuration
const dbConfig = {
    host: process.env.DB_HOST || '153.92.7.101',
    user: process.env.DB_USER || 'u662139794_prezenty',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'u662139794_prezenty',
    port: parseInt(process.env.DB_PORT) || 3306,
    charset: 'utf8mb4',
    connectTimeout: 60000
};

// Debug database configuration
console.log('Database configuration:', {
    host: dbConfig.host,
    user: dbConfig.user,
    database: dbConfig.database,
    port: dbConfig.port,
    hasPassword: !!dbConfig.password
});

// Create MySQL connection pool
const pool = mysql.createPool({
    ...dbConfig,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

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

// Helper to get user identification status
const getUserIdentification = async (userId) => {
    try {
        const [rows] = await pool.execute('SELECT r.* FROM recipients r WHERE r.identified_by = ?', [userId]);
        return rows[0] || null;
    } catch (err) {
        throw err;
    }
};

// Helper to get recipient by ID
const getRecipientById = async (id) => {
    try {
        const [rows] = await pool.execute(`
            SELECT r.*, u.username as identified_by_username 
            FROM recipients r 
            LEFT JOIN users u ON r.identified_by = u.id 
            WHERE r.id = ?
        `, [id]);
        return rows[0] || null;
    } catch (err) {
        throw err;
    }
};

// Helper to get all presents with recipient and user info
const getAllPresents = async () => {
    try {
        const [rows] = await pool.execute(`
            SELECT p.*, r.name as recipient_name, u.username as reserved_by_username, p.created_by
            FROM presents p 
            LEFT JOIN recipients r ON p.recipient_id = r.id 
            LEFT JOIN users u ON p.reserved_by = u.id
            ORDER BY p.created_at DESC
        `);
        return rows;
    } catch (err) {
        throw err;
    }
};

const app = express();
const PORT = process.env.PORT || 5173;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? false : true,
    credentials: true
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

// Create session store
const sessionStore = new MySQLStore(dbConfig);

app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'prezenty_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
}));

// Configure multer for file uploads (store in memory for database storage)
const storage = multer.memoryStorage();

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Tylko pliki obrazów są dozwolone'), false);
        }
    }
});



// Authentication middleware
function requireAuth(req, res, next) {
    console.log('Auth check - session:', { userId: req.session.userId, username: req.session.username });
    if (req.session.userId) {
        console.log('Auth successful for user:', req.session.username);
        next();
    } else {
        console.log('Auth failed: no session');
        res.status(401).json({ error: 'Wymagana autoryzacja' });
    }
}

// Routes
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    // If user is authenticated, redirect to recipients page
    if (req.session.userId) {
        res.redirect('/recipients');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    }
});

app.get('/recipients', (req, res) => {
    // If user is not authenticated, redirect to login page
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(__dirname, 'public', 'recipients.html'));
    }
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// API Routes

// Login
app.post('/api/login', async (req, res) => {
    console.log('Login request received:', { username: req.body.username, hasPassword: !!req.body.password });
    const { username, password } = req.body;
    
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
        
        res.json({ success: true, user: { id: user.id, username: user.username } });
    } catch (err) {
        console.error('Database error during login:', err);
        return handleDbError(err, res, 'Błąd serwera');
    }
});

// Logout
app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Check auth status
app.get('/api/auth', (req, res) => {
    console.log('Auth check - session:', { userId: req.session.userId, username: req.session.username });
    if (req.session.userId) {
        res.json({ authenticated: true, user: { id: req.session.userId, username: req.session.username } });
    } else {
        res.json({ authenticated: false });
    }
});

// Recipients API
app.get('/api/recipients', requireAuth, async (req, res) => {
    console.log('Getting recipients for user:', req.session.userId);
    
    try {
        const [rows] = await pool.execute(`
            SELECT r.*, u.username as identified_by_username 
            FROM recipients r 
            LEFT JOIN users u ON r.identified_by = u.id 
            ORDER BY r.name
        `);
        
        // Add profile picture URLs for recipients that have them
        const recipients = rows.map(recipient => {
            if (recipient.profile_picture) {
                recipient.profile_picture = `/api/recipients/${recipient.id}/profile-picture`;
            }
            return recipient;
        });
        
        console.log('Recipients loaded successfully:', recipients.length, 'recipients');
        res.json(recipients);
    } catch (err) {
        console.error('Database error getting recipients:', err);
        return handleDbError(err, res, 'Błąd podczas pobierania osób');
    }
});

app.post('/api/recipients', requireAuth, async (req, res) => {
    const { name } = req.body;
    
    console.log('[POST /api/recipients] Incoming request:', { body: req.body, session: req.session });
    
    if (!name || name.trim() === '') {
        console.log('[POST /api/recipients] Validation failed: empty name');
        return badRequest(res, 'Nazwa jest wymagana');
    }
    
    try {
        const [result] = await pool.execute('INSERT INTO recipients (name) VALUES (?)', [name.trim()]);
        console.log('[POST /api/recipients] Recipient added successfully:', result.insertId, 'Request body:', req.body, 'Session:', req.session);
        // Return the expected structure for frontend
        res.json({ success: true, recipient: { id: result.insertId, name: name.trim() } });
    } catch (err) {
        console.error('[POST /api/recipients] Database error adding recipient:', err, 'Request body:', req.body, 'Session:', req.session);
        if (err.code === 'ER_DUP_ENTRY') {
            return conflict(res, 'Taka osoba już istnieje!');
        }
        return handleDbError(err, res, 'Błąd podczas dodawania osoby');
    }
});

// User identification API
app.post('/api/recipients/:id/identify', requireAuth, async (req, res) => {
    const { id } = req.params;
    const userId = req.session.userId;
    
    try {
        // Check if recipient is already identified
        const [rows] = await pool.execute('SELECT identified_by FROM recipients WHERE id = ?', [id]);
        const recipient = rows[0];
        
        if (!recipient) {
            return notFound(res, 'Osoba nie została znaleziona');
        }
        
        if (recipient.identified_by && recipient.identified_by !== userId) {
            return conflict(res, 'Ta osoba została już zidentyfikowana przez innego użytkownika');
        }
        
        // Update identification
        await pool.execute('UPDATE recipients SET identified_by = ? WHERE id = ?', [userId, id]);
        res.json({ success: true });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas identyfikacji');
    }
});

// Check if user is identified
app.get('/api/user/identification', requireAuth, async (req, res) => {
    const userId = req.session.userId;
    const username = req.session.username;
    
    try {
        const recipient = await getUserIdentification(userId);
        const isIdentified = !!recipient;
        res.json({
            isIdentified: isIdentified,
            identifiedRecipient: recipient,
            username: username,
            userId: userId,
            name: recipient ? recipient.name : null
        });
    } catch (err) {
        handleDbError(err, res, 'Błąd podczas sprawdzania statusu identyfikacji');
    }
});

// Cancel self-identification API
app.delete('/api/recipients/:id/identify', requireAuth, async (req, res) => {
    console.log('Cancel identification request:', { id: req.params.id, userId: req.session.userId });
    const { id } = req.params;
    const userId = req.session.userId;
    
    try {
        // Check if user is identified as this recipient
        const [rows] = await pool.execute('SELECT identified_by FROM recipients WHERE id = ?', [id]);
        const recipient = rows[0];
        
        if (!recipient) {
            console.log('Recipient not found:', id);
            return notFound(res, 'Osoba nie została znaleziona');
        }
        
        console.log('Recipient found:', { id, identified_by: recipient.identified_by, userId });
        
        if (recipient.identified_by !== userId) {
            console.log('User not authorized to cancel identification');
            return forbidden(res, 'Nie możesz anulować identyfikacji innej osoby');
        }
        
        // Remove identification
        await pool.execute('UPDATE recipients SET identified_by = ? WHERE id = ?', [null, id]);
        console.log('Identification canceled successfully for recipient:', id);
        res.json({ success: true });
    } catch (err) {
        console.error('Database error canceling identification:', err);
        return handleDbError(err, res, 'Błąd podczas anulowania identyfikacji');
    }
});

app.delete('/api/recipients/:id', requireAuth, async (req, res) => {
    console.log('Delete recipient request:', { id: req.params.id, userId: req.session.userId });
    const { id } = req.params;
    
    try {
        const [result] = await pool.execute('DELETE FROM recipients WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            console.log('Recipient not found for deletion:', id);
            return notFound(res, 'Osoba nie została znaleziona');
        }
        
        console.log('Recipient deleted successfully:', id);
        res.json({ success: true });
    } catch (err) {
        console.error('Database error deleting recipient:', err);
        return handleDbError(err, res, 'Błąd podczas usuwania osoby');
    }
});

app.post('/api/recipients/:id/profile-picture', requireAuth, upload.single('profile_picture'), async (req, res) => {
    const { id } = req.params;
    const userId = req.session.userId;
    
    // Check if file was uploaded
    if (!req.file) {
        return badRequest(res, 'Brak pliku zdjęcia');
    }
    
    try {
        // Allow editing if not identified or identified by this user
        const [rows] = await pool.execute('SELECT identified_by FROM recipients WHERE id = ?', [id]);
        const recipient = rows[0];
        
        if (!recipient) {
            return notFound(res, 'Osoba nie została znaleziona');
        }
        
        if (recipient.identified_by && recipient.identified_by !== userId) {
            return forbidden(res, 'Nie masz uprawnień do edycji tego profilu');
        }
        
        // Store image data and type in database
        await pool.execute('UPDATE recipients SET profile_picture = ?, profile_picture_type = ? WHERE id = ?', 
            [req.file.buffer, req.file.mimetype, id]);
        
        console.log('Profile picture updated successfully for recipient:', id);
        res.json({ success: true, profile_picture: `/api/recipients/${id}/profile-picture` });
    } catch (err) {
        console.error('Database error updating profile picture:', err);
        return handleDbError(err, res, 'Błąd podczas aktualizacji zdjęcia profilowego');
    }
});

// Serve profile picture from database
app.get('/api/recipients/:id/profile-picture', async (req, res) => {
    const { id } = req.params;
    
    try {
        const [rows] = await pool.execute('SELECT profile_picture, profile_picture_type FROM recipients WHERE id = ?', [id]);
        const recipient = rows[0];
        
        if (!recipient || !recipient.profile_picture) {
            return res.status(404).send('Profile picture not found');
        }
        
        res.set('Content-Type', recipient.profile_picture_type);
        res.send(recipient.profile_picture);
    } catch (err) {
        console.error('Error serving profile picture:', err);
        res.status(500).send('Error serving profile picture');
    }
});

// Get recipient with identification info
app.get('/api/recipients/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    
    try {
        const recipient = await getRecipientById(id);
        if (!recipient) {
            return notFound(res, 'Osoba nie została znaleziona');
        }
        
        // Add profile picture URL if exists
        if (recipient.profile_picture) {
            recipient.profile_picture = `/api/recipients/${id}/profile-picture`;
        }
        
        res.json(recipient);
    } catch (err) {
        handleDbError(err, res, 'Błąd podczas pobierania osoby');
    }
});

// Presents API
app.get('/api/presents', requireAuth, async (req, res) => {
    console.log('Getting presents for user:', req.session.userId);
    const userId = req.session.userId;
    
    try {
        // First check if user is identified
        const identifiedRecipient = await getUserIdentification(userId);
        
        if (identifiedRecipient) {
            // User is identified - only show progress (checked/unchecked count) for their presents
            const [rows] = await pool.execute(`
                SELECT 
                    COUNT(*) as total_presents,
                    SUM(CASE WHEN is_checked = 1 THEN 1 ELSE 0 END) as checked_presents,
                    SUM(CASE WHEN is_checked = 0 THEN 1 ELSE 0 END) as unchecked_presents
                FROM presents p 
                WHERE p.recipient_id = ?
            `, [identifiedRecipient.id]);
            
            const progress = rows[0] || { total_presents: 0, checked_presents: 0, unchecked_presents: 0 };
            console.log('Progress for identified user:', progress);
            
            res.json({
                identified: true,
                recipient: {
                    id: identifiedRecipient.id,
                    name: identifiedRecipient.name
                },
                progress: progress,
                presents: [] // Empty array since we don't show presents to identified users
            });
        } else {
            // User is not identified - show all presents normally
            const presents = await getAllPresents();
            console.log('Presents loaded successfully:', presents.length, 'presents');
            if (presents.length > 0) {
                console.log('Sample present data:', presents[0]);
            }
            res.json({
                identified: false,
                presents: presents
            });
        }
    } catch (err) {
        console.error('Database error:', err);
        handleDbError(err, res, 'Błąd podczas pobierania prezentów');
    }
});

// Get all presents without identification logic (for recipients view)
app.get('/api/presents/all', requireAuth, async (req, res) => {
    console.log('Getting all presents for recipients view');
    
    try {
        const presents = await getAllPresents();
        console.log('All presents loaded successfully:', presents.length, 'presents');
        if (presents.length > 0) {
            console.log('Sample present data:', presents[0]);
        }
        res.json(presents);
    } catch (err) {
        console.error('Database error getting all presents:', err);
        handleDbError(err, res, 'Błąd podczas pobierania prezentów');
    }
});

app.post('/api/presents', requireAuth, async (req, res) => {
    const { title, recipient_id, comments } = req.body;
    const userId = req.session.userId;
    
    if (!title || title.trim() === '') {
        return badRequest(res, 'Nazwa prezentu jest wymagana');
    }
    
    try {
        const [result] = await pool.execute(
            'INSERT INTO presents (title, recipient_id, comments, created_by) VALUES (?, ?, ?, ?)',
            [title.trim(), recipient_id || null, comments || null, userId]
        );
        res.json({ id: result.insertId, title: title.trim(), recipient_id, comments });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas dodawania prezentu');
    }
});

app.put('/api/presents/:id/check', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { is_checked } = req.body;
    
    console.log('Check present request:', { id, is_checked, userId: req.session.userId });
    
    try {
        // First check if the present exists and get its current status
        const [rows] = await pool.execute('SELECT id, is_checked FROM presents WHERE id = ?', [id]);
        const present = rows[0];
        
        if (!present) {
            console.log('No present found with id:', id);
            return notFound(res, 'Prezent nie został znaleziony');
        }
        
        console.log('Present found:', present);
        
        // Update the present
        const [result] = await pool.execute('UPDATE presents SET is_checked = ? WHERE id = ?', [is_checked ? 1 : 0, id]);
        
        console.log('Present check status updated successfully:', { 
            id, 
            oldStatus: present.is_checked, 
            newStatus: is_checked, 
            changes: result.affectedRows 
        });
        
        res.json({ success: true });
    } catch (err) {
        console.error('Database error updating present check status:', err);
        return handleDbError(err, res, 'Błąd podczas aktualizacji prezentu');
    }
});

app.put('/api/presents/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    const { title, recipient_id, comments } = req.body;
    
    if (!title || title.trim() === '') {
        return badRequest(res, 'Nazwa prezentu jest wymagana');
    }
    
    try {
        const [result] = await pool.execute(
            'UPDATE presents SET title = ?, recipient_id = ?, comments = ? WHERE id = ?',
            [title.trim(), recipient_id || null, comments || null, id]
        );
        
        if (result.affectedRows === 0) {
            return notFound(res, 'Prezent nie został znaleziony');
        }
        
        console.log('Present updated successfully:', id);
        res.json({ success: true });
    } catch (err) {
        console.error('Database error updating present:', err);
        return handleDbError(err, res, 'Błąd podczas aktualizacji prezentu');
    }
});

app.delete('/api/presents/:id', requireAuth, async (req, res) => {
    const { id } = req.params;
    
    try {
        const [result] = await pool.execute('DELETE FROM presents WHERE id = ?', [id]);
        
        if (result.affectedRows === 0) {
            return notFound(res, 'Prezent nie został znaleziony');
        }
        
        res.json({ success: true });
    } catch (err) {
        return handleDbError(err, res, 'Błąd podczas usuwania prezentu');
    }
});

// Reserve present
app.post('/api/presents/:id/reserve', requireAuth, async (req, res) => {
    const { id } = req.params;
    const userId = req.session.userId;
    
    console.log('Reserve present request:', { id, userId });
    
    try {
        // First check if the present exists and is not already reserved
        const [rows] = await pool.execute('SELECT id, reserved_by FROM presents WHERE id = ?', [id]);
        const present = rows[0];
        
        if (!present) {
            console.log('No present found with id:', id);
            return notFound(res, 'Prezent nie został znaleziony');
        }
        
        if (present.reserved_by) {
            console.log('Present already reserved by user:', present.reserved_by);
            return conflict(res, 'Prezent jest już zarezerwowany');
        }
        
        // Reserve the present
        const [result] = await pool.execute('UPDATE presents SET reserved_by = ? WHERE id = ?', [userId, id]);
        
        console.log('Present reserved successfully:', { id, userId, changes: result.affectedRows });
        res.json({ success: true });
    } catch (err) {
        console.error('Database error reserving present:', err);
        return handleDbError(err, res, 'Błąd podczas rezerwacji prezentu');
    }
});

// Cancel reservation
app.delete('/api/presents/:id/reserve', requireAuth, async (req, res) => {
    const { id } = req.params;
    const userId = req.session.userId;
    
    console.log('Cancel reservation request:', { id, userId });
    
    try {
        // First check if the present exists and is reserved by this user
        const [rows] = await pool.execute('SELECT id, reserved_by FROM presents WHERE id = ?', [id]);
        const present = rows[0];
        
        if (!present) {
            console.log('No present found with id:', id);
            return notFound(res, 'Prezent nie został znaleziony');
        }
        
        if (!present.reserved_by) {
            console.log('Present is not reserved');
            return conflict(res, 'Prezent nie jest zarezerwowany');
        }
        
        if (present.reserved_by !== userId) {
            console.log('Present reserved by different user:', present.reserved_by);
            return forbidden(res, 'Nie możesz anulować rezerwacji innej osoby');
        }
        
        // Cancel the reservation
        const [result] = await pool.execute('UPDATE presents SET reserved_by = ? WHERE id = ?', [null, id]);
        
        console.log('Reservation canceled successfully:', { id, userId, changes: result.affectedRows });
        res.json({ success: true });
    } catch (err) {
        console.error('Database error canceling reservation:', err);
        return handleDbError(err, res, 'Błąd podczas anulowania rezerwacji');
    }
});

// Registration API
app.post('/api/register', async (req, res) => {
    console.log('Registration request received:', { username: req.body.username, hasPassword: !!req.body.password });
    const { username, password } = req.body;
    
    if (!username || !password) {
        console.log('Registration failed: missing username or password');
        return badRequest(res, 'Wymagane jest podanie nazwy użytkownika i hasła');
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



// Add new recipient and identify user
app.post('/api/user/identify', requireAuth, async (req, res) => {
    const { name } = req.body;
    const userId = req.session.userId;
    
    console.log('[POST /api/user/identify] Incoming request:', { body: req.body, session: req.session });
    
    if (!name || name.trim() === '') {
        console.log('[POST /api/user/identify] Validation failed: empty name');
        return badRequest(res, 'Imię jest wymagane');
    }
    
    try {
        // Check if user is already identified
        const [existingRows] = await pool.execute('SELECT r.* FROM recipients r WHERE r.identified_by = ?', [userId]);
        const existingRecipient = existingRows[0];
        
        if (existingRecipient) {
            console.log('[POST /api/user/identify] User already identified as:', existingRecipient);
            return conflict(res, 'Jesteś już zidentyfikowany jako ' + existingRecipient.name);
        }
        
        // Check if recipient with this name already exists
        const [recipientRows] = await pool.execute('SELECT * FROM recipients WHERE name = ?', [name.trim()]);
        const recipient = recipientRows[0];
        
        if (recipient) {
            // Check if this recipient is already identified by someone else
            if (recipient.identified_by && recipient.identified_by !== userId) {
                console.log('[POST /api/user/identify] Recipient already identified by another user:', recipient);
                return conflict(res, 'Ta osoba została już zidentyfikowana przez innego użytkownika');
            }
            
            // Update existing recipient to identify this user
            await pool.execute('UPDATE recipients SET identified_by = ? WHERE id = ?', [userId, recipient.id]);
            console.log('[POST /api/user/identify] Recipient identification updated:', { recipientId: recipient.id, userId });
            res.json({ 
                success: true, 
                recipient: { 
                    id: recipient.id, 
                    name: recipient.name 
                } 
            });
        } else {
            // Create new recipient and identify user
            const [result] = await pool.execute('INSERT INTO recipients (name, identified_by) VALUES (?, ?)', [name.trim(), userId]);
            console.log('[POST /api/user/identify] New recipient created and identified:', { id: result.insertId, name: name.trim(), userId });
            res.json({ 
                success: true, 
                recipient: { 
                    id: result.insertId, 
                    name: name.trim() 
                } 
            });
        }
    } catch (err) {
        console.error('[POST /api/user/identify] Database error:', err, 'Session:', req.session);
        return handleDbError(err, res, 'Błąd podczas identyfikacji');
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return badRequest(res, 'Nieprawidłowy format danych JSON');
    }
    
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Plik jest zbyt duży. Maksymalny rozmiar to 10MB.' });
    }
    
    if (err.message === 'Tylko pliki obrazów są dozwolone') {
        return badRequest(res, err.message);
    }
    
    handleDbError(err, res, 'Błąd serwera');
});

// Test database connection
async function testDatabaseConnection() {
    try {
        console.log('Testing database connection...');
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();
        console.log('Database connection test successful!');
        return true;
    } catch (err) {
        console.error('Database connection test failed:', err);
        return false;
    }
}

// Initialize database and start server
async function startServer() {
    try {
        // Test database connection first
        const dbConnected = await testDatabaseConnection();
        if (!dbConnected) {
            console.error('Cannot start server: Database connection failed');
            console.error('Please check your database configuration and ensure the database is accessible');
            process.exit(1);
        }
        
        // Initialize database schema
        const { initializeDatabase } = require('./init-db.js');
        await initializeDatabase();
        
        // Start server
        app.listen(PORT, HOST, () => {
            console.log(`Serwer Prezenty działa na porcie ${PORT}`);
            console.log(`Dostępny pod adresem: http://${HOST}:${PORT}`);
            console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
            console.log(`Database: MySQL at ${dbConfig.host}:${dbConfig.port}/${dbConfig.database}`);
            console.log('Session store using MySQL');
        }).on('error', (err) => {
            console.error('Błąd uruchamiania serwera:', err);
            process.exit(1);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        if (err.code === 'ENOTFOUND') {
            console.error('Database host not found. Please check your DB_HOST configuration.');
        } else if (err.code === 'ECONNREFUSED') {
            console.error('Database connection refused. Please check if the database server is running.');
        } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('Database access denied. Please check your username and password.');
        }
        process.exit(1);
    }
}

startServer();
