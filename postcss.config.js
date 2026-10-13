/**
 * PostCSS config for public/styles.deduped.min.css (see public/CSS-README.md).
 * Run it with `npm run build:css` (scripts/build-css.js), not with the postcss CLI,
 * so CRLF input is normalised to LF first.
 *
 * PurgeCSS only sees class/id names that appear as plain text in the content files.
 * Names assembled at runtime ('alert-' + type) are invisible to it and are kept by the
 * safelist below. Each pattern names the file:line that justifies it (found by scanning the
 * sources for template/concatenation fragments; re-check them when that JS changes).
 */
module.exports = {
  plugins: [
    require('@fullhuman/postcss-purgecss')({
      // GLOBS only. public/**/*.js already covers every *-page.js and the split recipients files.
      content: [
        './public/**/*.html',
        './public/**/*.js',
        './public/**/*-page*.css',
        './routes/**/*.js',   // server-built HTML/class strings
        './lib/**/*.js',
        './server.js'
      ],
      defaultExtractor: content => content.match(/[A-Za-z0-9-_:/.]+/g) || [],
      safelist: {
        // Classes toggled by Bootstrap's own JS (bootstrap.bundle.min.js 5.3.0: classList.add/remove/toggle
        // of these names); they never appear in our files. Exact names, anchored.
        standard: [
          /^(active|show|showing|hiding|fade|collapse|collapsing|collapsed|collapse-horizontal|disabled|modal-open|modal-backdrop|modal-static|offcanvas-backdrop|dropdown-menu|slide|carousel-item-(next|prev|start|end)|is-valid|is-invalid|was-validated)$/
        ],
        // Prefix/suffix/infix PATTERNS for names built at runtime (greedy = keep the selector if any part matches).
        greedy: [
          /^alert-/,            // `alert alert-${type}`: public/formularz.js:168,964,991,1120,1342; public/recipients.js:3101
          /^accordion-bought-/, // `accordion-bought-${random}`: public/recipients.js:1874
          /^accordion-own-/,    // `accordion-own-${id}`: public/recipients.js:1092
          /-collapse$/,         // `#${accordionId}-collapse`: public/recipients.js:1099,1109,1879,1883
          /^editTitle-/,        // id="editTitle-${presentId}": public/osoby-page.js:221,234
          /^editComments-/,     // id="editComments-${presentId}": public/osoby-page.js:222,235
          /^lp-/,               // id="lp-${m.id}": public/wiadomosci-page.js:362,376
          /^recipient-/,        // id="recipient-${id}": public/recipients.js:404,1171
          /^notif-/,            // 'notif-' + notif.id: public/tab-bar-functions.js:143
          /^thread-/,           // 'thread-' + data.threadId: public/tab-bar-functions.js:143
          /^demo-image-/,       // `demo-image-${n}`: routes/recipients.js:309,427
          /col-/,               // [class*="col-"] attribute selector: public/aws-design.css:1058
          /fa-users/            // [class*="fa-users"] attribute selector: public/aws-design.css:2506
        ]
      }
    }),
    require('cssnano')({ preset: 'default' })
  ]
};
