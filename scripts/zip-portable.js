// Zip the electron-packager output directory into a portable .zip archive.
// Run after `npm run pack:dir`. Produces dist/SageBeschleuniger-<version>-portable.zip.

const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const pkg = require('../package.json');

const distDir = path.resolve(__dirname, '..', 'dist');
const srcDir = path.join(distDir, 'SageBeschleuniger-win32-x64');
const outFile = path.join(
  distDir,
  `SageBeschleuniger-${pkg.version}-portable.zip`
);

if (!fs.existsSync(srcDir)) {
  console.error(
    '[zip-portable] missing packaged dir, run "npm run pack:dir" first:',
    srcDir
  );
  process.exit(1);
}

const zip = new AdmZip();
zip.addLocalFolder(srcDir, 'SageBeschleuniger');
zip.writeZip(outFile);

console.log('[zip-portable] wrote', outFile);
