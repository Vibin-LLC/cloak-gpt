const fs = require('fs');
const path = require('path');

// Define source and destination directories
const sourceDir = path.join(__dirname, '../src/renderer');
const destDir = path.join(__dirname, '../dist/renderer');

// Create destination directory if it doesn't exist
if (!fs.existsSync(destDir)) {
  fs.mkdirSync(destDir, { recursive: true });
  console.log(`Created directory: ${destDir}`);
}

// Function to copy a file
function copyFile(source, destination) {
  try {
    fs.copyFileSync(source, destination);
    console.log(`Copied: ${source} -> ${destination}`);
  } catch (err) {
    console.error(`Error copying ${source}:`, err);
  }
}

// Copy HTML files
const htmlFiles = fs.readdirSync(sourceDir).filter(file => file.endsWith('.html'));
for (const htmlFile of htmlFiles) {
  const htmlSource = path.join(sourceDir, htmlFile);
  const htmlDest = path.join(destDir, htmlFile);
  copyFile(htmlSource, htmlDest);
}

// Copy CSS files
const cssFiles = fs.readdirSync(sourceDir).filter(file => file.endsWith('.css'));
for (const cssFile of cssFiles) {
  const cssSource = path.join(sourceDir, cssFile);
  const cssDest = path.join(destDir, cssFile);
  copyFile(cssSource, cssDest);
}

console.log('File copying complete');