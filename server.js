const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'prezenty-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Database setup
const db = new sqlite3.Database('./prezenty.db', (err) => {
    if (err) {
        console.error('Błąd połączenia z bazą danych:', err);
        process.exit(1);
    }
    console.log('Połączono z bazą danych SQLite');
});

// Create tables
db.serialize(() => {
    // Users table
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Recipients table with identification fields
    db.run(`CREATE TABLE IF NOT EXISTS recipients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        profile_picture TEXT,
        identified_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (identified_by) REFERENCES users (id)
    )`);

    // Presents table
    db.run(`CREATE TABLE IF NOT EXISTS presents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        recipient_id INTEGER,
        comments TEXT,
        is_checked BOOLEAN DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (recipient_id) REFERENCES recipients (id)
    )`);

    // Add new columns to existing recipients table if they don't exist
    db.run("PRAGMA table_info(recipients)", (err, rows) => {
        if (!err && rows) {
            const hasProfilePicture = rows.some(row => row.name === 'profile_picture');
            const hasIdentifiedBy = rows.some(row => row.name === 'identified_by');
            
            if (!hasProfilePicture) {
                db.run("ALTER TABLE recipients ADD COLUMN profile_picture TEXT");
            }
            if (!hasIdentifiedBy) {
                db.run("ALTER TABLE recipients ADD COLUMN identified_by INTEGER REFERENCES users(id)");
            }
        }
    });

    // Insert default admin user if not exists
    db.get("SELECT id FROM users WHERE username = 'admin'", (err, row) => {
        if (!row) {
            const hashedPassword = bcrypt.hashSync('admin123', 10);
            db.run("INSERT INTO users (username, password) VALUES (?, ?)", ['admin', hashedPassword]);
        }
    });
});

// Authentication middleware
function requireAuth(req, res, next) {
    if (req.session.userId) {
        next();
    } else {
        res.status(401).json({ error: 'Wymagana autoryzacja' });
    }
}

// Routes
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/presents', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'presents.html'));
});

app.get('/recipients', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'recipients.html'));
});

app.get('/register', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// API Routes

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
        if (err) {
            return res.status(500).json({ error: 'Błąd serwera' });
        }
        
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({ error: 'Nieprawidłowa nazwa użytkownika lub hasło' });
        }
        
        req.session.userId = user.id;
        req.session.username = user.username;
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
    if (req.session.userId) {
        res.json({ authenticated: true, user: { id: req.session.userId, username: req.session.username } });
    } else {
        res.json({ authenticated: false });
    }
});

// Recipients API
app.get('/api/recipients', requireAuth, (req, res) => {
    db.all(`
        SELECT r.*, u.username as identified_by_username 
        FROM recipients r 
        LEFT JOIN users u ON r.identified_by = u.id 
        ORDER BY r.name
    `, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Błąd podczas pobierania osób' });
        }
        res.json(rows);
    });
});

app.post('/api/recipients', requireAuth, (req, res) => {
    const { name } = req.body;
    
    if (!name || name.trim() === '') {
        return res.status(400).json({ error: 'Nazwa jest wymagana' });
    }
    
    db.run("INSERT INTO recipients (name) VALUES (?)", [name.trim()], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Błąd podczas dodawania osoby' });
        }
        res.json({ id: this.lastID, name: name.trim() });
    });
});

app.delete('/api/recipients/:id', requireAuth, (req, res) => {
    const { id } = req.params;
    
    db.run("DELETE FROM recipients WHERE id = ?", [id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Błąd podczas usuwania osoby' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Osoba nie została znaleziona' });
        }
        res.json({ success: true });
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

app.post('/api/recipients/:id/profile-picture', requireAuth, (req, res) => {
    const { id } = req.params;
    const { profile_picture } = req.body;
    const userId = req.session.userId;
    
    // Check if user is identified as this recipient
    db.get("SELECT identified_by FROM recipients WHERE id = ?", [id], (err, recipient) => {
        if (err) {
            return res.status(500).json({ error: 'Błąd podczas sprawdzania uprawnień' });
        }
        
        if (!recipient) {
            return res.status(404).json({ error: 'Osoba nie została znaleziona' });
        }
        
        if (recipient.identified_by !== userId) {
            return res.status(403).json({ error: 'Nie masz uprawnień do edycji tego profilu' });
        }
        
        // Update profile picture
        db.run("UPDATE recipients SET profile_picture = ? WHERE id = ?", [profile_picture, id], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Błąd podczas aktualizacji zdjęcia profilowego' });
            }
            res.json({ success: true });
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
    db.all(`
        SELECT p.*, r.name as recipient_name 
        FROM presents p 
        LEFT JOIN recipients r ON p.recipient_id = r.id 
        ORDER BY p.created_at DESC
    `, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Błąd podczas pobierania prezentów' });
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
    
    db.run("UPDATE presents SET is_checked = ? WHERE id = ?", [is_checked ? 1 : 0, id], function(err) {
        if (err) {
            return res.status(500).json({ error: 'Błąd podczas aktualizacji prezentu' });
        }
        if (this.changes === 0) {
            return res.status(404).json({ error: 'Prezent nie został znaleziony' });
        }
        res.json({ success: true });
    });
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

// Registration API
app.post('/api/register', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Wymagane jest podanie nazwy użytkownika i hasła' });
    }
    db.get("SELECT id FROM users WHERE username = ?", [username], (err, row) => {
        if (row) {
            return res.status(409).json({ error: 'Nazwa użytkownika jest już zajęta' });
        }
        const hashedPassword = bcrypt.hashSync(password, 10);
        db.run("INSERT INTO users (username, password) VALUES (?, ?)", [username, hashedPassword], function(err) {
            if (err) {
                return res.status(500).json({ error: 'Błąd podczas rejestracji' });
            }
            // Automatycznie loguj użytkownika po rejestracji
            req.session.userId = this.lastID;
            req.session.username = username;
            res.json({ success: true, user: { id: this.lastID, username: username } });
        });
    });
});

// Start server
app.listen(PORT, () => {
    console.log(`Serwer Prezenty działa na porcie ${PORT}`);
    console.log(`Dostępny pod adresem: http://localhost:${PORT}`);
    console.log(`NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(`Database path: ${path.resolve('./prezenty.db')}`);
}).on('error', (err) => {
    console.error('Błąd uruchamiania serwera:', err);
    process.exit(1);
}); 