import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'steg.js', 'favicon.svg']) await copyFile(file, 'dist/' + file);
console.log('Built static app in dist/');
