#!/usr/bin/env node
/* Copies Daisey v1 (daisey/app/) into the publish dir at site/daisey/now/.
   Runs at deploy time from netlify.toml, after build-standalone.js. The output
   is gitignored — edit daisey/app/, never site/daisey/now/. */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(__dirname, "app");
const OUT = path.join(ROOT, "site", "daisey", "now");

function fail(msg){
  console.error("build-app: " + msg);
  process.exit(1);
}

if(!fs.existsSync(path.join(SRC, "index.html"))) fail("daisey/app/index.html is missing");

fs.rmSync(OUT, { recursive: true, force: true });
// package.json only exists so node tests can import the modules; don't serve it.
fs.cpSync(SRC, OUT, { recursive: true, filter: (src) => src !== path.join(SRC, "package.json") });

// Every local file index.html references must have been copied.
const html = fs.readFileSync(path.join(OUT, "index.html"), "utf8");
for(const [, ref] of html.matchAll(/(?:src|href)="([^":#?]+)"/g)){
  if(!fs.existsSync(path.join(OUT, ref))) fail(`index.html references ${ref}, which is not in the output`);
}

// A missing config doesn't fail the deploy (that would take the whole site
// down with it); the page shows its own "not configured" state instead.
if(fs.readFileSync(path.join(OUT, "js", "config.js"), "utf8").includes(': "PASTE_ME"')){
  console.warn("build-app: WARNING js/config.js still has PASTE_ME placeholders");
}

const files = fs.readdirSync(OUT, { recursive: true }).filter((f) => fs.statSync(path.join(OUT, f)).isFile());
console.log(`build-app: wrote ${path.relative(ROOT, OUT)} (${files.length} files)`);
