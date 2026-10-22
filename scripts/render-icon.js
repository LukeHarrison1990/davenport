// Regenerates the app icon from build/icon.svg: xvfb-run electron --no-sandbox scripts/render-icon.js build/icon.svg build/icon 1024
// Renders SVG files to transparent PNGs with Electron's Chromium. Usage: electron render.js <svg> <outPrefix> <size...>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
app.commandLine.appendSwitch('no-sandbox');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const [svgPath, outPrefix, ...sizes] = process.argv.slice(1).filter((a) => !a.startsWith('--') && !a.endsWith('render.js'));
  const svg = fs.readFileSync(svgPath, 'utf8');
  for (const s of sizes.map(Number)) {
    const w = new BrowserWindow({ width: s, height: s, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
    const html = `<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${s}" height="${s}" `)}</body></html>`;
    await w.loadURL('data:text/html;base64,' + Buffer.from(html).toString('base64'));
    await new Promise((r) => setTimeout(r, 150));
    const img = await w.webContents.capturePage({ x: 0, y: 0, width: s, height: s });
    fs.writeFileSync(`${outPrefix}-${s}.png`, img.resize({ width: s, height: s, quality: 'best' }).toPNG());
    w.destroy();
  }
  app.quit();
});
