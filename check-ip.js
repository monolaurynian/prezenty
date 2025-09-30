// Simple script to check current IP address
const https = require('https');

console.log('Checking current IP address...');

// Check IP using multiple services
const services = [
    'https://api.ipify.org',
    'https://ipinfo.io/ip',
    'https://icanhazip.com'
];

async function checkIP(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => resolve(data.trim()));
        }).on('error', reject);
    });
}

async function checkAllIPs() {
    console.log('\n=== IP Address Check ===');
    
    for (const service of services) {
        try {
            const ip = await checkIP(service);
            console.log(`${service}: ${ip}`);
        } catch (err) {
            console.log(`${service}: Error - ${err.message}`);
        }
    }
    
    console.log('\n=== Database Access Requirements ===');
    console.log('Your database needs to allow connections from:');
    console.log('1. Your local development IP (shown above)');
    console.log('2. Render deployment IP: 44.226.122.3');
    console.log('3. Or allow all IPs (% or 0.0.0.0/0) for easier deployment');
    
    console.log('\n=== Next Steps ===');
    console.log('1. Contact your database hosting provider');
    console.log('2. Request to whitelist the IPs shown above');
    console.log('3. Or enable "Allow connections from anywhere" if available');
}

checkAllIPs().catch(console.error);