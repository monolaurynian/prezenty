// Moved verbatim from server.js (Phase 2 split)
const express = require('express');
const router = express.Router();
const path = require('path');
const ROOT_DIR = path.join(__dirname, '..');

router.get('/', (req, res) => {
    console.log('========================================');
    console.log('ROOT ROUTE HIT!');
    console.log('Root route accessed - Session:', {
        userId: req.session.userId,
        username: req.session.username
    });
    console.log('========================================');
    
    // If user is authenticated, show home (homepage/dashboard)
    if (req.session.userId) {
        console.log('User authenticated, serving home.html');
        res.sendFile(path.join(ROOT_DIR, 'public', 'home.html'));
    } else {
        console.log('User not authenticated, serving index.html (login)');
        res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
    }
});

router.get('/home', (req, res) => {
    // Redirect to root (home is the homepage)
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(ROOT_DIR, 'public', 'home.html'));
    }
});

router.get('/statystyki', (req, res) => {
    // Legacy route - redirect to home
    res.redirect('/');
});

router.get('/recipients', (req, res) => {
    // If user is not authenticated, redirect to login page
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(ROOT_DIR, 'public', 'recipients.html'));
    }
});

router.get('/register', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'public', 'register.html'));
});

router.get('/formularz', (req, res) => {
    res.sendFile(path.join(ROOT_DIR, 'public', 'formularz.html'));
});

router.get('/activity', (req, res) => {
    // If user is not authenticated, redirect to login page
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(ROOT_DIR, 'public', 'activity.html'));
    }
});

router.get('/osoby', (req, res) => {
    // If user is not authenticated, redirect to login page
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(ROOT_DIR, 'public', 'osoby.html'));
    }
});

router.get('/ustawienia', (req, res) => {
    // If user is not authenticated, redirect to login page
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(ROOT_DIR, 'public', 'ustawienia.html'));
    }
});

router.get('/rezerwacje', (req, res) => {
    // If user is not authenticated, redirect to login page
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(ROOT_DIR, 'public', 'rezerwacje.html'));
    }
});

router.get('/archiwum', (req, res) => {
    // If user is not authenticated, redirect to login page
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(ROOT_DIR, 'public', 'archiwum.html'));
    }
});

router.get('/wiadomosci', (req, res) => {
    // If user is not authenticated, redirect to login page
    if (!req.session.userId) {
        res.redirect('/');
    } else {
        res.sendFile(path.join(ROOT_DIR, 'public', 'wiadomosci.html'));
    }
});

module.exports = router;
