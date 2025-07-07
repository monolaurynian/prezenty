const express = require('express');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');
const { Pool } = require('pg');
const pgSession = require('connect-pg-simple')(session);

// Load .env file in development, but not in production
if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config();
}

// Ensure DATABASE_URL is set
if (!process.env.DATABASE_URL) {
    console.error('Error: DATABASE_URL environment variable is not set.');
    process.exit(1);
}

const pool = new Pool({
    connectionString: process.env.DATABASE_URL
});

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Middleware
app.use(cors({
    origin: process.env.NODE_ENV === 'production' ? false : true,
    credentials: true
}));
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static('public'));

app.use(session({
    store: new pgSession({
        pool: pool,
        tableName: 'session'
    }),
    secret: process.env.SESSION_SECRET || 'prezenty_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30 days
}));

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = path.join(__dirname, 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
    }
});

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
app.post('/api/login', (req, res) => {
    console.log('Login request received:', { username: req.body.username, hasPassword: !!req.body.password });
    const { username, password } = req.body;
    
    pool.query('SELECT * FROM users WHERE username = $1', [username], (err, result) => {
        if (err) {
            console.error('Database error during login:', err);
            return res.status(500).json({ error: 'Błąd serwera' });
        }
        
        const user = result.rows[0];
        if (!user || !bcrypt.compareSync(password, user.password)) {
            console.log('Login failed: invalid credentials for user:', username);
            return res.status(401).json({ error: 'Nieprawidłowa nazwa użytkownika lub hasło' });
        }
        
        console.log('Login successful for user:', username);
        req.session.userId = user.id;
        req.session.username = user.username;
        
        console.log('Session created:', { userId: req.session.userId, username: req.session.username });
        
        res.json({ success: true, user: { id: user.id, username: user.username } });
    });
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
app.get('/api/recipients', requireAuth, (req, res) => {
    console.log('Getting recipients for user:', req.session.userId);
    
    pool.query('SELECT COUNT(*) as count FROM recipients', [], (err, result) => {
        if (err) {
            console.error('Database error checking recipients table:', err);
            return res.status(500).json({ error: 'Błąd dostępu do bazy danych' });
        }
        
        console.log('Recipients table accessible, count:', result.rows[0].count);
        
        pool.query(`
            SELECT r.*, u.username as identified_by_username 
            FROM recipients r 
            LEFT JOIN users u ON r.identified_by = u.id 
            ORDER BY r.name
        `, [], (err, result) => {
            if (err) {
                console.error('Database error getting recipients:', err);
                return res.status(500).json({ error: 'Błąd podczas pobierania osób' });
            }
            console.log('Recipients loaded successfully:', result.rows.length, 'recipients');
            res.json(result.rows);
        });
    });
});

app.post('/api/recipients', requireAuth, (req, res) => {
    const { name } = req.body;
    
    console.log('[POST /api/recipients] Incoming request:', { body: req.body, session: req.session });
    
    if (!name || name.trim() === '') {
        console.log('[POST /api/recipients] Validation failed: empty name');
        return res.status(400).json({ error: 'Nazwa jest wymagana' });
    }
    
    pool.query('INSERT INTO recipients (name) VALUES ($1) RETURNING id', [name.trim()], (err, result) => {
        if (err) {
            console.error('[POST /api/recipients] Database error adding recipient:', err, 'Request body:', req.body, 'Session:', req.session);
            if (err.code === '23505') {
                return res.status(409).json({ error: 'Taka osoba już istnieje!' });
            }
            return res.status(500).json({ error: 'Błąd podczas dodawania osoby' });
        }
        console.log('[POST /api/recipients] Recipient added successfully:', result.rows[0], 'Request body:', req.body, 'Session:', req.session);
        // Return the expected structure for frontend
        res.json({ success: true, recipient: { id: result.rows[0].id, name: name.trim() } });
    });
});

// User identification API
app.post('/api/recipients/:id/identify', requireAuth, (req, res) => {
    const { id } = req.params;
    const userId = req.session.userId;
    
    // Check if recipient is already identified
    pool.query('SELECT identified_by FROM recipients WHERE id = $1', [id], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Błąd podczas sprawdzania identyfikacji' });
        }
        
        const recipient = result.rows[0];
        if (!recipient) {
            return res.status(404).json({ error: 'Osoba nie została znaleziona' });
        }
        
        if (recipient.identified_by && recipient.identified_by !== userId) {
            return res.status(409).json({ error: 'Ta osoba została już zidentyfikowana przez innego użytkownika' });
        }
        
        // Update identification
        pool.query('UPDATE recipients SET identified_by = $1 WHERE id = $2', [userId, id], (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Błąd podczas identyfikacji' });
            }
            res.json({ success: true });
        });
    });
});

// Check if user is identified
app.get('/api/user/identification-status', requireAuth, (req, res) => {
    const userId = req.session.userId;
    const username = req.session.username;
    
    console.log('Identification status check for user:', { userId, username });
    
    pool.query('SELECT id, name FROM recipients WHERE identified_by = $1', [userId], (err, result) => {
        if (err) {
            console.error('Database error checking identification status:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania statusu identyfikacji' });
        }
        
        const recipient = result.rows[0];
        const isIdentified = !!recipient;
        console.log('Identification status result:', { userId, username, isIdentified, recipient });
        
        res.json({
            isIdentified: isIdentified,
            identifiedRecipient: recipient,
            username: username
        });
    });
});

// Cancel self-identification API
app.delete('/api/recipients/:id/identify', requireAuth, (req, res) => {
    console.log('Cancel identification request:', { id: req.params.id, userId: req.session.userId });
    const { id } = req.params;
    const userId = req.session.userId;
    
    // Check if user is identified as this recipient
    pool.query('SELECT identified_by FROM recipients WHERE id = $1', [id], (err, result) => {
        if (err) {
            console.error('Database error checking identification:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania identyfikacji' });
        }
        
        const recipient = result.rows[0];
        if (!recipient) {
            console.log('Recipient not found:', id);
            return res.status(404).json({ error: 'Osoba nie została znaleziona' });
        }
        
        console.log('Recipient found:', { id, identified_by: recipient.identified_by, userId });
        
        if (recipient.identified_by !== userId) {
            console.log('User not authorized to cancel identification');
            return res.status(403).json({ error: 'Nie możesz anulować identyfikacji innej osoby' });
        }
        
        // Remove identification
        pool.query('UPDATE recipients SET identified_by = $1 WHERE id = $2', [null, id], (err, result) => {
            if (err) {
                console.error('Database error canceling identification:', err);
                return res.status(500).json({ error: 'Błąd podczas anulowania identyfikacji' });
            }
            console.log('Identification canceled successfully for recipient:', id);
            res.json({ success: true });
        });
    });
});

app.delete('/api/recipients/:id', requireAuth, (req, res) => {
    console.log('Delete recipient request:', { id: req.params.id, userId: req.session.userId });
    const { id } = req.params;
    
    pool.query('DELETE FROM recipients WHERE id = $1', [id], (err, result) => {
        if (err) {
            console.error('Database error deleting recipient:', err);
            return res.status(500).json({ error: 'Błąd podczas usuwania osoby' });
        }
        if (result.rowCount === 0) {
            console.log('Recipient not found for deletion:', id);
            return res.status(404).json({ error: 'Osoba nie została znaleziona' });
        }
        console.log('Recipient deleted successfully:', id);
        res.json({ success: true });
    });
});

app.post('/api/recipients/:id/profile-picture', requireAuth, upload.single('profile_picture'), (req, res) => {
    const { id } = req.params;
    const userId = req.session.userId;
    
    // Check if file was uploaded
    if (!req.file) {
        return res.status(400).json({ error: 'Brak pliku zdjęcia' });
    }
    
    // Allow editing if not identified or identified by this user
    pool.query('SELECT identified_by FROM recipients WHERE id = $1', [id], (err, result) => {
        if (err) {
            console.error('Database error checking recipient:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania uprawnień' });
        }
        
        const recipient = result.rows[0];
        if (!recipient) {
            return res.status(404).json({ error: 'Osoba nie została znaleziona' });
        }
        
        if (recipient.identified_by && recipient.identified_by !== userId) {
            return res.status(403).json({ error: 'Nie masz uprawnień do edycji tego profilu' });
        }
        // If not identified or identified by this user, allow
        const profilePicturePath = '/uploads/' + req.file.filename;
        pool.query('UPDATE recipients SET profile_picture = $1 WHERE id = $2', [profilePicturePath, id], (err, result) => {
            if (err) {
                console.error('Database error updating profile picture:', err);
                return res.status(500).json({ error: 'Błąd podczas aktualizacji zdjęcia profilowego' });
            }
            console.log('Profile picture updated successfully for recipient:', id);
            res.json({ success: true, profile_picture: profilePicturePath });
        });
    });
});

// Get recipient with identification info
app.get('/api/recipients/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    
    pool.query(`
        SELECT r.*, u.username as identified_by_username 
        FROM recipients r 
        LEFT JOIN users u ON r.identified_by = u.id 
        WHERE r.id = $1
    `, [id], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Błąd podczas pobierania osoby' });
        }
        
        const recipient = result.rows[0];
        if (!recipient) {
            return res.status(404).json({ error: 'Osoba nie została znaleziona' });
        }
        
        res.json(recipient);
    });
});

// Presents API
app.get('/api/presents', requireAuth, (req, res) => {
    console.log('Getting presents for user:', req.session.userId);
    const userId = req.session.userId;
    
    // First check if user is identified
    pool.query('SELECT r.* FROM recipients r WHERE r.identified_by = $1', [userId], (err, result) => {
        if (err) {
            console.error('Database error checking user identification:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania identyfikacji' });
        }
        
        const identifiedRecipient = result.rows[0];
        if (identifiedRecipient) {
            // User is identified - only show progress (checked/unchecked count) for their presents
            pool.query(`
                SELECT 
                    COUNT(*) as total_presents,
                    SUM(CASE WHEN is_checked = 1 THEN 1 ELSE 0 END) as checked_presents,
                    SUM(CASE WHEN is_checked = 0 THEN 1 ELSE 0 END) as unchecked_presents
                FROM presents p 
                WHERE p.recipient_id = $1
            `, [identifiedRecipient.id], (err, result) => {
                if (err) {
                    console.error('Database error getting progress:', err);
                    return res.status(500).json({ error: 'Błąd podczas pobierania postępu' });
                }
                
                const progress = result.rows[0] || { total_presents: 0, checked_presents: 0, unchecked_presents: 0 };
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
            });
        } else {
            // User is not identified - show all presents normally
            pool.query(`
                SELECT p.*, r.name as recipient_name, u.username as reserved_by_username, p.created_by
                FROM presents p 
                LEFT JOIN recipients r ON p.recipient_id = r.id 
                LEFT JOIN users u ON p.reserved_by = u.id
                ORDER BY p.created_at DESC
            `, [], (err, result) => {
                if (err) {
                    console.error('Database error getting presents:', err);
                    return res.status(500).json({ error: 'Błąd podczas pobierania prezentów' });
                }
                console.log('Presents loaded successfully:', result.rows.length, 'presents');
                if (result.rows.length > 0) {
                    console.log('Sample present data:', result.rows[0]);
                }
                res.json({
                    identified: false,
                    presents: result.rows
                });
            });
        }
    });
});

// Get all presents without identification logic (for recipients view)
app.get('/api/presents/all', requireAuth, (req, res) => {
    console.log('Getting all presents for recipients view');
    
    pool.query(`
        SELECT p.*, r.name as recipient_name, u.username as reserved_by_username, p.created_by
        FROM presents p 
        LEFT JOIN recipients r ON p.recipient_id = r.id 
        LEFT JOIN users u ON p.reserved_by = u.id
        ORDER BY p.created_at DESC
    `, [], (err, result) => {
        if (err) {
            console.error('Database error getting all presents:', err);
            return res.status(500).json({ error: 'Błąd podczas pobierania prezentów' });
        }
        console.log('All presents loaded successfully:', result.rows.length, 'presents');
        if (result.rows.length > 0) {
            console.log('Sample present data:', result.rows[0]);
        }
        res.json(result.rows);
    });
});

app.post('/api/presents', requireAuth, (req, res) => {
    const { title, recipient_id, comments } = req.body;
    const userId = req.session.userId;
    
    if (!title || title.trim() === '') {
        return res.status(400).json({ error: 'Nazwa prezentu jest wymagana' });
    }
    
    pool.query(
        'INSERT INTO presents (title, recipient_id, comments, created_by) VALUES ($1, $2, $3, $4) RETURNING id',
        [title.trim(), recipient_id || null, comments || null, userId],
        (err, result) => {
            if (err) {
                return res.status(500).json({ error: 'Błąd podczas dodawania prezentu' });
            }
            res.json({ id: result.rows[0].id, title: title.trim(), recipient_id, comments });
        }
    );
});

app.put('/api/presents/:id/check', requireAuth, (req, res) => {
    const { id } = req.params;
    const { is_checked } = req.body;
    
    console.log('Check present request:', { id, is_checked, userId: req.session.userId });
    
    // First check if the present exists and get its current status
    pool.query('SELECT id, is_checked FROM presents WHERE id = $1', [id], (err, result) => {
        if (err) {
            console.error('Database error checking present:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania prezentu' });
        }
        
        const present = result.rows[0];
        if (!present) {
            console.log('No present found with id:', id);
            return res.status(404).json({ error: 'Prezent nie został znaleziony' });
        }
        
        console.log('Present found:', present);
        
        // Update the present
        pool.query('UPDATE presents SET is_checked = $1 WHERE id = $2', [is_checked ? 1 : 0, id], (err, result) => {
            if (err) {
                console.error('Database error updating present check status:', err);
                return res.status(500).json({ error: 'Błąd podczas aktualizacji prezentu' });
            }
            
            console.log('Present check status updated successfully:', { 
                id, 
                oldStatus: present.is_checked, 
                newStatus: is_checked, 
                changes: result.rowCount 
            });
            
            res.json({ success: true });
        });
    });
});

app.put('/api/presents/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    const { title, recipient_id, comments } = req.body;
    
    if (!title || title.trim() === '') {
        return res.status(400).json({ error: 'Nazwa prezentu jest wymagana' });
    }
    
    pool.query(
        'UPDATE presents SET title = $1, recipient_id = $2, comments = $3 WHERE id = $4',
        [title.trim(), recipient_id || null, comments || null, id],
        (err, result) => {
            if (err) {
                console.error('Database error updating present:', err);
                return res.status(500).json({ error: 'Błąd podczas aktualizacji prezentu' });
            }
            if (result.rowCount === 0) {
                return res.status(404).json({ error: 'Prezent nie został znaleziony' });
            }
            console.log('Present updated successfully:', id);
            res.json({ success: true });
        }
    );
});

app.delete('/api/presents/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    
    pool.query('DELETE FROM presents WHERE id = $1', [id], (err, result) => {
        if (err) {
            return res.status(500).json({ error: 'Błąd podczas usuwania prezentu' });
        }
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Prezent nie został znaleziony' });
        }
        res.json({ success: true });
    });
});

// Reserve present
app.post('/api/presents/:id/reserve', requireAuth, (req, res) => {
    const { id } = req.params;
    const userId = req.session.userId;
    
    console.log('Reserve present request:', { id, userId });
    
    // First check if the present exists and is not already reserved
    pool.query('SELECT id, reserved_by FROM presents WHERE id = $1', [id], (err, result) => {
        if (err) {
            console.error('Database error checking present:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania prezentu' });
        }
        
        const present = result.rows[0];
        if (!present) {
            console.log('No present found with id:', id);
            return res.status(404).json({ error: 'Prezent nie został znaleziony' });
        }
        
        if (present.reserved_by) {
            console.log('Present already reserved by user:', present.reserved_by);
            return res.status(409).json({ error: 'Prezent jest już zarezerwowany' });
        }
        
        // Reserve the present
        pool.query('UPDATE presents SET reserved_by = $1 WHERE id = $2', [userId, id], (err, result) => {
            if (err) {
                console.error('Database error reserving present:', err);
                return res.status(500).json({ error: 'Błąd podczas rezerwacji prezentu' });
            }
            
            console.log('Present reserved successfully:', { id, userId, changes: result.rowCount });
            res.json({ success: true });
        });
    });
});

// Cancel reservation
app.delete('/api/presents/:id/reserve', requireAuth, (req, res) => {
    const { id } = req.params;
    const userId = req.session.userId;
    
    console.log('Cancel reservation request:', { id, userId });
    
    // First check if the present exists and is reserved by this user
    pool.query('SELECT id, reserved_by FROM presents WHERE id = $1', [id], (err, result) => {
        if (err) {
            console.error('Database error checking present:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania prezentu' });
        }
        
        const present = result.rows[0];
        if (!present) {
            console.log('No present found with id:', id);
            return res.status(404).json({ error: 'Prezent nie został znaleziony' });
        }
        
        if (!present.reserved_by) {
            console.log('Present is not reserved');
            return res.status(409).json({ error: 'Prezent nie jest zarezerwowany' });
        }
        
        if (present.reserved_by !== userId) {
            console.log('Present reserved by different user:', present.reserved_by);
            return res.status(403).json({ error: 'Nie możesz anulować rezerwacji innej osoby' });
        }
        
        // Cancel the reservation
        pool.query('UPDATE presents SET reserved_by = $1 WHERE id = $2', [null, id], (err, result) => {
            if (err) {
                console.error('Database error canceling reservation:', err);
                return res.status(500).json({ error: 'Błąd podczas anulowania rezerwacji' });
            }
            
            console.log('Reservation canceled successfully:', { id, userId, changes: result.rowCount });
            res.json({ success: true });
        });
    });
});

// Registration API
app.post('/api/register', (req, res) => {
    console.log('Registration request received:', { username: req.body.username, hasPassword: !!req.body.password });
    const { username, password } = req.body;
    
    if (!username || !password) {
        console.log('Registration failed: missing username or password');
        return res.status(400).json({ error: 'Wymagane jest podanie nazwy użytkownika i hasła' });
    }
    
    console.log('Checking if username exists:', username);
    pool.query('SELECT id FROM users WHERE username = $1', [username], (err, result) => {
        if (err) {
            console.error('Database error checking username:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania nazwy użytkownika' });
        }
        
        if (result.rows.length > 0) {
            console.log('Registration failed: username already exists:', username);
            return res.status(409).json({ error: 'Nazwa użytkownika jest już zajęta' });
        }
        
        console.log('Creating new user:', username);
        const hashedPassword = bcrypt.hashSync(password, 10);
        pool.query('INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id', [username, hashedPassword], (err, result) => {
            if (err) {
                console.error('Database error creating user:', err);
                return res.status(500).json({ error: 'Błąd podczas rejestracji' });
            }
            
            console.log('User created successfully:', { id: result.rows[0].id, username: username });
            
            // Automatycznie loguj użytkownika po rejestracji
            req.session.userId = result.rows[0].id;
            req.session.username = username;
            
            console.log('Session created:', { userId: req.session.userId, username: req.session.username });
            
            res.json({ success: true, user: { id: result.rows[0].id, username: username } });
        });
    });
});

// Check if user is identified
app.get('/api/user/identification', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    pool.query('SELECT r.* FROM recipients r WHERE r.identified_by = $1', [userId], (err, result) => {
        if (err) {
            console.error('Database error checking user identification:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania identyfikacji' });
        }
        
        const recipient = result.rows[0];
        if (recipient) {
            res.json({ 
                identified: true, 
                recipient: { 
                    id: recipient.id, 
                    name: recipient.name 
                } 
            });
        } else {
            res.json({ identified: false });
        }
    });
});

// Add new recipient and identify user
app.post('/api/user/identify', requireAuth, (req, res) => {
    const { name } = req.body;
    const userId = req.session.userId;
    
    console.log('[POST /api/user/identify] Incoming request:', { body: req.body, session: req.session });
    
    if (!name || name.trim() === '') {
        console.log('[POST /api/user/identify] Validation failed: empty name');
        return res.status(400).json({ error: 'Imię jest wymagane' });
    }
    
    // Check if user is already identified
    pool.query('SELECT r.* FROM recipients r WHERE r.identified_by = $1', [userId], (err, result) => {
        if (err) {
            console.error('[POST /api/user/identify] Database error checking existing identification:', err, 'Session:', req.session);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania identyfikacji' });
        }
        
        const existingRecipient = result.rows[0];
        if (existingRecipient) {
            console.log('[POST /api/user/identify] User already identified as:', existingRecipient);
            return res.status(409).json({ error: 'Jesteś już zidentyfikowany jako ' + existingRecipient.name });
        }
        
        // Check if recipient with this name already exists
        pool.query('SELECT * FROM recipients WHERE name = $1', [name.trim()], (err, result) => {
            if (err) {
                console.error('[POST /api/user/identify] Database error checking existing recipient:', err, 'Session:', req.session);
                return res.status(500).json({ error: 'Błąd podczas sprawdzania osoby' });
            }
            
            const recipient = result.rows[0];
            if (recipient) {
                // Check if this recipient is already identified by someone else
                if (recipient.identified_by && recipient.identified_by !== userId) {
                    console.log('[POST /api/user/identify] Recipient already identified by another user:', recipient);
                    return res.status(409).json({ error: 'Ta osoba została już zidentyfikowana przez innego użytkownika' });
                }
                
                // Update existing recipient to identify this user
                pool.query('UPDATE recipients SET identified_by = $1 WHERE id = $2', [userId, recipient.id], (err, result) => {
                    if (err) {
                        console.error('[POST /api/user/identify] Database error updating recipient identification:', err, 'Session:', req.session);
                        return res.status(500).json({ error: 'Błąd podczas identyfikacji' });
                    }
                    console.log('[POST /api/user/identify] Recipient identification updated:', { recipientId: recipient.id, userId });
                    res.json({ 
                        success: true, 
                        recipient: { 
                            id: recipient.id, 
                            name: recipient.name 
                        } 
                    });
                });
            } else {
                // Create new recipient and identify user
                pool.query('INSERT INTO recipients (name, identified_by) VALUES ($1, $2) RETURNING id', [name.trim(), userId], (err, result) => {
                    if (err) {
                        console.error('[POST /api/user/identify] Database error creating recipient:', err, 'Session:', req.session);
                        return res.status(500).json({ error: 'Błąd podczas tworzenia osoby' });
                    }
                    console.log('[POST /api/user/identify] New recipient created and identified:', { id: result.rows[0].id, name: name.trim(), userId });
                    res.json({ 
                        success: true, 
                        recipient: { 
                            id: result.rows[0].id, 
                            name: name.trim() 
                        } 
                    });
                });
            }
        });
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Server error:', err);
    
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: 'Nieprawidłowy format danych JSON' });
    }
    
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Plik jest zbyt duży. Maksymalny rozmiar to 10MB.' });
    }
    
    res.status(500).json({ error: 'Błąd serwera' });
});

// Start server
app.listen(PORT, HOST, () => {
    console.log(`Serwer Prezenty działa na porcie ${PORT}`);
    console.log(`Dostępny pod adresem: http://${HOST}:${PORT}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`Database path: ${process.env.DATABASE_URL}`);
    console.log('Connected to PostgreSQL database:', pool.options.connectionString);
    console.log('Session store using PostgreSQL');
}).on('error', (err) => {
    console.error('Błąd uruchamiania serwera:', err);
    process.exit(1);
}); 