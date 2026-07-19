const fs = require('fs');
const D = String.fromCharCode(36); // dollar sign
let t = fs.readFileSync('public/home.html', 'utf8');
const anchor = ': `<div style="display: flex; width: 40px;';
console.log('anchor occurrences:', t.split(anchor).length - 1);
const marker = 'flex-shrink: 0;">';
let count = 0, idx = 0;
while ((idx = t.indexOf(anchor, idx)) !== -1) {
  const end = t.indexOf(marker, idx);
  if (end === -1) break;
  const before = t.slice(0, end);
  const onclick = 'flex-shrink: 0; cursor: pointer;" onclick="openProfilePicturePreview('
    + D + '{recipient.id}, \'' + D + '{escapeHtml(recipient.name).replace(/\'/g, String.fromCharCode(92,39))}\', null)">';
  t = before + onclick + t.slice(end + marker.length);
  idx = before.length + onclick.length;
  count++;
}
fs.writeFileSync('public/home.html', t);
console.log('patched blocks:', count);
