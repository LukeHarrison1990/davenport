// Keeping email attachments from running code by accident.
import fs from 'node:fs';
import path from 'node:path';

// Types Windows runs (or that run something) when opened, modelled on Outlook's blocked-attachment list.
const BLOCKED = new Set(
  (
    'ade adp app application appref-ms appx appxbundle asp aspx asx bas bat bgi cab cer chm cmd cnt com cpl crt csh der diagcab ' +
    'exe fxp gadget grp hlp hpj hta htc img inf ins iso isp its jar jnlp js jse ksh library-ms lnk mad maf mag mam maq mar mas mat mau mav maw ' +
    'mcf mda mdb mde mdt mdw mdz msc msh msh1 msh2 mshxml msh1xml msh2xml msi msix msixbundle msp mst msu ops osd pcd pif pl plg prf prg ' +
    'printerexport ps1 ps1xml ps2 ps2xml psc1 psc2 psd1 psdm1 psm1 pst py pyc pyo pyw pyz pyzw reg scf scr sct search-ms settingcontent-ms shb shs ' +
    'theme tmp url vb vbe vbp vbs vhd vhdx vsmacros vsw webpnp website ws wsc wsf wsh xbap xll xnk'
  ).split(' ')
);

/** True for program files, scripts, shortcuts and disk images that would run code if opened straight from an email. */
export function isBlockedType(filename: string): boolean {
  // Windows ignores trailing dots and spaces, so "invoice.exe." is still an .exe.
  const name = filename.trim().replace(/[.\s]+$/, '').toLowerCase();
  const ext = path.extname(name).slice(1);
  return BLOCKED.has(ext);
}

/**
 * Marks a file as downloaded from the internet (the "Mark of the Web"), as browsers and Outlook do, so
 * Windows SmartScreen warns before running it and Office opens it in Protected View.
 */
export function markFromInternet(file: string): void {
  if (process.platform !== 'win32') return;
  try {
    fs.writeFileSync(file + ':Zone.Identifier', '[ZoneTransfer]\r\nZoneId=3\r\n');
  } catch {
    /* not NTFS (e.g. a USB stick); nothing more we can do */
  }
}
