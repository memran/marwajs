const { src, dest, series } = require('gulp');
const terser = require('gulp-terser');
const cleanCSS = require('gulp-clean-css');

function minifyJs() {
  return src('src/**/*.js') // Path to your JS files
    .pipe(terser())
    .pipe(dest('dist/js')); // Output directory
}

function minifyCss() {
  return src('src/**/*.css') // Path to your CSS files
    .pipe(cleanCSS())
    .pipe(dest('dist/css')); // Output directory
}

exports.build = series(minifyJs, minifyCss);