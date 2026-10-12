module.exports = {
  plugins: [
    require('@fullhuman/postcss-purgecss')({
      content: [
        './public/**/*.html',
        './public/**/*.js',
        './public/**/*-page*.css'
      ],
      defaultExtractor: content => content.match(/[A-Za-z0-9-_:/.]+/g) || [],
    }),
    require('cssnano')({ preset: 'default' })
  ]
}; 