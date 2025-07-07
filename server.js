const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const multer = require('multer');

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
    store: new SQLiteStore({
        db: 'sessions.db',
        dir: './',
        table: 'sessions'
    }),
    secret: process.env.SESSION_SECRET || 'prezenty-secret-key-2024',
    resave: true,
    saveUninitialized: true,
    cookie: { 
        secure: false, // Changed to false for compatibility
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        sameSite: 'lax'
    }
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

// Database setup
const dbPath = process.env.DATABASE_PATH || './prezenty.db';
console.log('Attempting to connect to database:', path.resolve(dbPath));

const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Błąd połączenia z bazą danych:', err);
        console.error('Database path:', dbPath);
        console.error('Resolved path:', path.resolve(dbPath));
        console.error('Directory exists:', require('fs').existsSync(path.dirname(dbPath)));
        console.error('File exists:', require('fs').existsSync(dbPath));
        console.error('Error code:', err.code);
        console.error('Error message:', err.message);
        process.exit(1);
    }
    console.log('Połączono z bazą danych SQLite:', dbPath);
    console.log('Database path resolved:', path.resolve(dbPath));
    console.log('Database file exists:', require('fs').existsSync(dbPath));
});

// Create tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`, (err) => {
        if (err) {
            console.error('Błąd tworzenia tabeli users:', err);
            process.exit(1);
        }
    });

    // Recipients table with identification fields
    db.run(`CREATE TABLE IF NOT EXISTS recipients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        profile_picture TEXT,
        identified_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (identified_by) REFERENCES users (id)
    )`, (err) => {
        if (err) {
            console.error('Błąd tworzenia tabeli recipients:', err);
            process.exit(1);
        }
        console.log('Tabela recipients została utworzona/sprawdzona');
    });

    // Presents table
    db.run(`CREATE TABLE IF NOT EXISTS presents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        recipient_id INTEGER,
        comments TEXT,
        is_checked BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (recipient_id) REFERENCES recipients (id)
    )`, (err) => {
        if (err) {
            console.error('Błąd tworzenia tabeli presents:', err);
            process.exit(1);
        }
    });

    // Add new columns to existing recipients table if they don't exist
    db.all("PRAGMA table_info(recipients)", (err, rows) => {
        if (err) {
            console.error('Error checking table schema:', err);
            return;
        }
        
        const columnNames = rows.map(row => row.name);
        console.log('Current columns in recipients table:', columnNames);
        
        if (!columnNames.includes('profile_picture')) {
            console.log('Adding profile_picture column...');
            db.run("ALTER TABLE recipients ADD COLUMN profile_picture TEXT", (err) => {
                if (err) {
                    console.error('Error adding profile_picture column:', err);
                } else {
                    console.log('profile_picture column added successfully');
                }
            });
        }
        
        if (!columnNames.includes('identified_by')) {
            console.log('Adding identified_by column...');
            db.run("ALTER TABLE recipients ADD COLUMN identified_by INTEGER REFERENCES users(id)", (err) => {
                if (err) {
                    console.error('Error adding identified_by column:', err);
                } else {
                    console.log('identified_by column added successfully');
                }
            });
        }
    });

    // Add new columns to existing presents table if they don't exist
    db.all("PRAGMA table_info(presents)", (err, rows) => {
        if (err) {
            console.error('Error checking presents table schema:', err);
            return;
        }
        
        const columnNames = rows.map(row => row.name);
        console.log('Current columns in presents table:', columnNames);
        
        if (!columnNames.includes('reserved_by')) {
            console.log('Adding reserved_by column...');
            db.run("ALTER TABLE presents ADD COLUMN reserved_by INTEGER REFERENCES users(id)", (err) => {
                if (err) {
                    console.error('Error adding reserved_by column:', err);
                } else {
                    console.log('reserved_by column added successfully');
                }
            });
        }
    });

    // Insert default admin user if not exists
    db.get("SELECT id FROM users WHERE username = 'admin'", (err, row) => {
        if (!row) {
            const hashedPassword = bcrypt.hashSync('admin123', 10);
            db.run("INSERT INTO users (username, password) VALUES (?, ?)", ['admin', hashedPassword]);
        }
    });
    
    // Check existing recipients for debugging
    db.all("SELECT * FROM recipients", (err, rows) => {
        if (err) {
            console.error('Error checking recipients:', err);
        } else {
            console.log('Existing recipients in database:', rows.length, 'recipients');
            if (rows.length > 0) {
                console.log('Recipients:', rows.map(r => ({ id: r.id, name: r.name })));
            }
        }
    });
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
    
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) {
            console.error('Database error during login:', err);
            return res.status(500).json({ error: 'Błąd serwera' });
        }
        
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
    
    // First check if database is accessible
    db.get("SELECT COUNT(*) as count FROM recipients", (err, result) => {
        if (err) {
            console.error('Database error checking recipients table:', err);
            return res.status(500).json({ error: 'Błąd dostępu do bazy danych' });
        }
        
        console.log('Recipients table accessible, count:', result.count);
        
        // Now get all recipients with user info
    db.all(`
        SELECT r.*, u.username as identified_by_username 
        FROM recipients r 
        LEFT JOIN users u ON r.identified_by = u.id 
        ORDER BY r.name
    `, (err, rows) => {
        if (err) {
                console.error('Database error getting recipients:', err);
            return res.status(500).json({ error: 'Błąd podczas pobierania osób' });
        }
            console.log('Recipients loaded successfully:', rows.length, 'recipients');
        res.json(rows);
        });
    });
});

app.post('/api/recipients', requireAuth, (req, res) => {
    const { name } = req.body;
    
    console.log('Adding recipient:', { name, userId: req.session.userId, body: req.body });
    
    if (!name || name.trim() === '') {
        console.log('Validation failed: empty name');
        return res.status(400).json({ error: 'Nazwa jest wymagana' });
    }
    
    db.run("INSERT INTO recipients (name) VALUES (?)", [name.trim()], function(err) {
        if (err) {
            if (err.code === 'SQLITE_CONSTRAINT') {
                return res.status(409).json({ error: 'Taka osoba już istnieje!' });
            }
            console.error('Database error adding recipient:', err);
            return res.status(500).json({ error: 'Błąd podczas dodawania osoby' });
        }
        console.log('Recipient added successfully:', { id: this.lastID, name: name.trim() });
        res.json({ id: this.lastID, name: name.trim() });
    });
});

// User identification API
app.post('/api/recipients/:id/identify', requireAuth, (req, res) => {
    const { id } = req.params;
    const userId = req.session.userId;
    
    // Check if recipient is already identified
    db.get("SELECT identified_by FROM recipients WHERE id = ?", [id], (err, recipient) => {
        if (err) {
            return res.status(500).json({ error: 'Błąd podczas sprawdzania identyfikacji' });
        }
        
        if (!recipient) {
            return res.status(404).json({ error: 'Osoba nie została znaleziona' });
        }
        
        if (recipient.identified_by && recipient.identified_by !== userId) {
            return res.status(409).json({ error: 'Ta osoba została już zidentyfikowana przez innego użytkownika' });
        }
        
        // Update identification
        db.run("UPDATE recipients SET identified_by = ? WHERE id = ?", [userId, id], function(err) {
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
    
    db.get("SELECT id, name FROM recipients WHERE identified_by = ?", [userId], (err, recipient) => {
        if (err) {
            console.error('Database error checking identification status:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania statusu identyfikacji' });
        }
        
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
    db.get("SELECT identified_by FROM recipients WHERE id = ?", [id], (err, recipient) => {
        if (err) {
            console.error('Database error checking identification:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania identyfikacji' });
        }
        
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
        db.run("UPDATE recipients SET identified_by = NULL WHERE id = ?", [id], function(err) {
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
    
    db.run("DELETE FROM recipients WHERE id = ?", [id], function(err) {
        if (err) {
            console.error('Database error deleting recipient:', err);
            return res.status(500).json({ error: 'Błąd podczas usuwania osoby' });
        }
        if (this.changes === 0) {
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
    
    // Check if user is identified as this recipient
    db.get("SELECT identified_by FROM recipients WHERE id = ?", [id], (err, recipient) => {
        if (err) {
            console.error('Database error checking recipient:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania uprawnień' });
        }
        
        if (!recipient) {
            return res.status(404).json({ error: 'Osoba nie została znaleziona' });
        }
        
        if (recipient.identified_by !== userId) {
            return res.status(403).json({ error: 'Nie masz uprawnień do edycji tego profilu' });
        }
        
        // Update profile picture with the uploaded file path
        const profilePicturePath = '/uploads/' + req.file.filename;
        db.run("UPDATE recipients SET profile_picture = ? WHERE id = ?", [profilePicturePath, id], function(err) {
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
    
    db.get(`
        SELECT r.*, u.username as identified_by_username 
        FROM recipients r 
        LEFT JOIN users u ON r.identified_by = u.id 
        WHERE r.id = ?
    `, [id], (err, recipient) => {
        if (err) {
            return res.status(500).json({ error: 'Błąd podczas pobierania osoby' });
        }
        
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
    db.get("SELECT r.* FROM recipients r WHERE r.identified_by = ?", [userId], (err, identifiedRecipient) => {
        if (err) {
            console.error('Database error checking user identification:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania identyfikacji' });
        }
        
        if (identifiedRecipient) {
            // User is identified - only show progress (checked/unchecked count) for their presents
            db.all(`
                SELECT 
                    COUNT(*) as total_presents,
                    SUM(CASE WHEN is_checked = 1 THEN 1 ELSE 0 END) as checked_presents,
                    SUM(CASE WHEN is_checked = 0 THEN 1 ELSE 0 END) as unchecked_presents
                FROM presents p 
                WHERE p.recipient_id = ?
            `, [identifiedRecipient.id], (err, progressRows) => {
                if (err) {
                    console.error('Database error getting progress:', err);
                    return res.status(500).json({ error: 'Błąd podczas pobierania postępu' });
                }
                
                const progress = progressRows[0] || { total_presents: 0, checked_presents: 0, unchecked_presents: 0 };
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
    db.all(`
        SELECT p.*, r.name as recipient_name, u.username as reserved_by_username 
        FROM presents p 
        LEFT JOIN recipients r ON p.recipient_id = r.id 
        LEFT JOIN users u ON p.reserved_by = u.id
        ORDER BY p.created_at DESC
    `, (err, rows) => {
        if (err) {
                    console.error('Database error getting presents:', err);
            return res.status(500).json({ error: 'Błąd podczas pobierania prezentów' });
                }
                console.log('Presents loaded successfully:', rows.length, 'presents');
                if (rows.length > 0) {
                    console.log('Sample present data:', rows[0]);
                }
                res.json({
                    identified: false,
                    presents: rows
                });
            });
        }
    });
});

// Get all presents without identification logic (for recipients view)
app.get('/api/presents/all', requireAuth, (req, res) => {
    console.log('Getting all presents for recipients view');
    
    db.all(`
        SELECT p.*, r.name as recipient_name, u.username as reserved_by_username 
        FROM presents p 
        LEFT JOIN recipients r ON p.recipient_id = r.id 
        LEFT JOIN users u ON p.reserved_by = u.id
        ORDER BY p.created_at DESC
    `, (err, rows) => {
        if (err) {
            console.error('Database error getting all presents:', err);
            return res.status(500).json({ error: 'Błąd podczas pobierania prezentów' });
        }
        console.log('All presents loaded successfully:', rows.length, 'presents');
        if (rows.length > 0) {
            console.log('Sample present data:', rows[0]);
        }
        res.json(rows);
    });
});

app.post('/api/presents', requireAuth, (req, res) => {
    const { title, recipient_id, comments } = req.body;
    
    if (!title || title.trim() === '') {
        return res.status(400).json({ error: 'Nazwa prezentu jest wymagana' });
    }
    
    db.run(
        "INSERT INTO presents (title, recipient_id, comments) VALUES (?, ?, ?)",
        [title.trim(), recipient_id || null, comments || null],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Błąd podczas dodawania prezentu' });
            }
            res.json({ id: this.lastID, title: title.trim(), recipient_id, comments });
        }
    );
});

app.put('/api/presents/:id/check', requireAuth, (req, res) => {
    const { id } = req.params;
    const { is_checked } = req.body;
    
    console.log('Check present request:', { id, is_checked, userId: req.session.userId });
    
    // First check if the present exists and get its current status
    db.get("SELECT id, is_checked FROM presents WHERE id = ?", [id], (err, present) => {
        if (err) {
            console.error('Database error checking present:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania prezentu' });
        }
        
        if (!present) {
            console.log('No present found with id:', id);
            return res.status(404).json({ error: 'Prezent nie został znaleziony' });
        }
        
        console.log('Present found:', present);
        
        // Update the present
        db.run("UPDATE presents SET is_checked = ? WHERE id = ?", [is_checked ? 1 : 0, id], function(err) {
            if (err) {
                console.error('Database error updating present check status:', err);
                return res.status(500).json({ error: 'Błąd podczas aktualizacji prezentu' });
            }
            
            console.log('Present check status updated successfully:', { 
                id, 
                oldStatus: present.is_checked, 
                newStatus: is_checked, 
                changes: this.changes 
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
    
    db.run(
        "UPDATE presents SET title = ?, recipient_id = ?, comments = ? WHERE id = ?",
        [title.trim(), recipient_id || null, comments || null, id],
        function(err) {
            if (err) {
                console.error('Database error updating present:', err);
                return res.status(500).json({ error: 'Błąd podczas aktualizacji prezentu' });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Prezent nie został znaleziony' });
            }
            console.log('Present updated successfully:', id);
            res.json({ success: true });
        }
    );
});

app.delete('/api/presents/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    
    db.run("DELETE FROM presents WHERE id = ?", [id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Błąd podczas usuwania prezentu' });
        }
        if (this.changes === 0) {
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
    db.get("SELECT id, reserved_by FROM presents WHERE id = ?", [id], (err, present) => {
        if (err) {
            console.error('Database error checking present:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania prezentu' });
        }
        
        if (!present) {
            console.log('No present found with id:', id);
            return res.status(404).json({ error: 'Prezent nie został znaleziony' });
        }
        
        if (present.reserved_by) {
            console.log('Present already reserved by user:', present.reserved_by);
            return res.status(409).json({ error: 'Prezent jest już zarezerwowany' });
        }
        
        // Reserve the present
        db.run("UPDATE presents SET reserved_by = ? WHERE id = ?", [userId, id], function(err) {
            if (err) {
                console.error('Database error reserving present:', err);
                return res.status(500).json({ error: 'Błąd podczas rezerwacji prezentu' });
            }
            
            console.log('Present reserved successfully:', { id, userId, changes: this.changes });
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
    db.get("SELECT id, reserved_by FROM presents WHERE id = ?", [id], (err, present) => {
        if (err) {
            console.error('Database error checking present:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania prezentu' });
        }
        
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
        db.run("UPDATE presents SET reserved_by = NULL WHERE id = ?", [id], function(err) {
            if (err) {
                console.error('Database error canceling reservation:', err);
                return res.status(500).json({ error: 'Błąd podczas anulowania rezerwacji' });
            }
            
            console.log('Reservation canceled successfully:', { id, userId, changes: this.changes });
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
    db.get("SELECT id FROM users WHERE username = ?", [username], (err, row) => {
        if (err) {
            console.error('Database error checking username:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania nazwy użytkownika' });
        }
        
        if (row) {
            console.log('Registration failed: username already exists:', username);
            return res.status(409).json({ error: 'Nazwa użytkownika jest już zajęta' });
        }
        
        console.log('Creating new user:', username);
        const hashedPassword = bcrypt.hashSync(password, 10);
        db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hashedPassword], function(err) {
            if (err) {
                console.error('Database error creating user:', err);
                return res.status(500).json({ error: 'Błąd podczas rejestracji' });
            }
            
            console.log('User created successfully:', { id: this.lastID, username: username });
            
            // Automatycznie loguj użytkownika po rejestracji
            req.session.userId = this.lastID;
            req.session.username = username;
            
            console.log('Session created:', { userId: req.session.userId, username: req.session.username });
            
            res.json({ success: true, user: { id: this.lastID, username: username } });
        });
    });
});

// Check if user is identified
app.get('/api/user/identification', requireAuth, (req, res) => {
    const userId = req.session.userId;
    
    db.get("SELECT r.* FROM recipients r WHERE r.identified_by = ?", [userId], (err, recipient) => {
        if (err) {
            console.error('Database error checking user identification:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania identyfikacji' });
        }
        
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
    
    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Imię jest wymagane' });
    }
    
    // Check if user is already identified
    db.get("SELECT r.* FROM recipients r WHERE r.identified_by = ?", [userId], (err, existingRecipient) => {
        if (err) {
            console.error('Database error checking existing identification:', err);
            return res.status(500).json({ error: 'Błąd podczas sprawdzania identyfikacji' });
        }
        
        if (existingRecipient) {
            return res.status(409).json({ error: 'Jesteś już zidentyfikowany jako ' + existingRecipient.name });
        }
        
        // Check if recipient with this name already exists
        db.get("SELECT * FROM recipients WHERE name = ?", [name.trim()], (err, existingRecipient) => {
            if (err) {
                console.error('Database error checking existing recipient:', err);
                return res.status(500).json({ error: 'Błąd podczas sprawdzania osoby' });
            }
            
            if (existingRecipient) {
                // Check if this recipient is already identified by someone else
                if (existingRecipient.identified_by && existingRecipient.identified_by !== userId) {
                    return res.status(409).json({ error: 'Ta osoba została już zidentyfikowana przez innego użytkownika' });
                }
                
                // Update existing recipient to identify this user
                db.run("UPDATE recipients SET identified_by = ? WHERE id = ?", [userId, existingRecipient.id], function(err) {
                    if (err) {
                        console.error('Database error updating recipient identification:', err);
                        return res.status(500).json({ error: 'Błąd podczas identyfikacji' });
                    }
                    res.json({ 
                        success: true, 
                        recipient: { 
                            id: existingRecipient.id, 
                            name: existingRecipient.name 
                        } 
                    });
                });
            } else {
                // Create new recipient and identify user
                db.run("INSERT INTO recipients (name, identified_by) VALUES (?, ?)", [name.trim(), userId], function(err) {
                    if (err) {
                        console.error('Database error creating recipient:', err);
                        return res.status(500).json({ error: 'Błąd podczas tworzenia osoby' });
                    }
                    res.json({ 
                        success: true, 
                        recipient: { 
                            id: this.lastID, 
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
    console.log(`Database path: ${path.resolve('./prezenty.db')}`);
}).on('error', (err) => {
    console.error('Błąd uruchamiania serwera:', err);
    process.exit(1);
}); 