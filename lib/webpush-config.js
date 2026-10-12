// Moved verbatim from server.js (Phase 2 split)

// Configure web-push with environment variables (fallback to development keys)
// NOTE: the previous fallback pair was BROKEN - the public key (from an old
// Google tutorial) did not match the private key, so every push send failed
// authentication while the UI reported notifications as "enabled". This
// fallback pair is valid and verified at boot below. For production it's
// still better to set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env vars.
let webpush = null;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || 'BGmHv9fStZte3uoA_MoRNIiQGjiMYSIdf671YAsqNG7Y0ADxVlQVpuIvtIYsJWiassjdqBhrW_9eBTBj9X78y9o';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || 'Y2INXCZy4691LqPyIrv5q7huivDUuUVhCaqMsrRvAmA';
const VAPID_EMAIL = process.env.VAPID_EMAIL || 'mailto:prezenty@example.com';

// Verify the key pair actually matches - a mismatched pair fails silently
// at send time, which is exactly the bug this guards against
try {
    const _ecdh = require('crypto').createECDH('prime256v1');
    _ecdh.setPrivateKey(Buffer.from(VAPID_PRIVATE_KEY.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
    const _derived = _ecdh.getPublicKey().toString('base64url');
    const _declared = Buffer.from(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('base64url');
    if (_derived !== _declared) {
        console.error('❌ [VAPID] PUBLIC/PRIVATE KEY MISMATCH - push notifications WILL FAIL. Check your VAPID env vars.');
    } else {
        console.log('✅ [VAPID] Key pair verified (public matches private)');
    }
} catch (e) {
    console.error('⚠️ [VAPID] Could not verify key pair:', e.message);
}

// Log VAPID configuration source
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    console.log('🔑 [VAPID] Using VAPID keys from environment variables');
} else {
    console.log('🔑 [VAPID] Using fallback development VAPID keys (set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY env vars for production)');
}

try {
    webpush = require('web-push');
    webpush.setVapidDetails(
        VAPID_EMAIL,
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );
    console.log('✅ [VAPID] Web-push module loaded and configured successfully');
} catch (error) {
    console.log('⚠️ [VAPID] Web-push module not available:', error.message);
    console.log('📝 [VAPID] To enable notifications: npm install web-push');
    webpush = null;
}

module.exports = { webpush, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY };
