# Deploying Davenport across an organisation

This guide is for network managers and technicians installing Davenport on many Windows computers with Intune, Configuration Manager (SCCM), Group Policy, PDQ or a script.

Download the installer, `Davenport-Setup-<version>.exe`, from the [latest release](https://github.com/LukeHarrison1990/davenport/releases/latest). The same file installs on 64-bit Intel/AMD and Arm computers.

## Silent install

Run from an elevated prompt (or as SYSTEM) to install for everyone who uses the computer:

```bat
Davenport-Setup-1.2.0.exe /S /allusers
```

| Switch | What it does |
| --- | --- |
| `/S` | Silent: no windows or questions. |
| `/allusers` | Install for everyone on the computer, into `C:\Program Files\Davenport`. Needs administrator rights. |
| `/currentuser` | Install for the signed-in user only, into `%LOCALAPPDATA%\Programs\Davenport`. No administrator rights needed. |
| `/D=<folder>` | Install somewhere else. Must be the **last** switch, with no quotes even if the path has spaces: `/D=D:\Apps\Davenport`. |
| `/DISABLEUPDATES` | Switch off Davenport's own update checks on this computer, so you control which version people run. Use with `/allusers`. |

The installer exits with code 0 when it succeeds. It adds Davenport to the Start menu and the desktop for every user.

**Upgrading:** run a newer installer with the same switches. It replaces the old version and keeps everyone's accounts and settings.

**Uninstalling:**

```bat
"C:\Program Files\Davenport\Uninstall Davenport.exe" /S /allusers
```

People's own data (`%APPDATA%\Davenport` in each profile) is left alone, so reinstalling picks up where they left off. Delete those folders as well for a clean removal.

### Intune (Win32 app)

1. Wrap the installer with the [Microsoft Win32 Content Prep Tool](https://learn.microsoft.com/mem/intune/apps/apps-win32-prepare).
2. **Install command:** `Davenport-Setup-1.2.0.exe /S /allusers` (add `/DISABLEUPDATES` if you'll push updates yourself)
3. **Uninstall command:** `"C:\Program Files\Davenport\Uninstall Davenport.exe" /S /allusers`
4. **Install behaviour:** System.
5. **Detection rule:** File `C:\Program Files\Davenport\Davenport.exe` exists, or for a specific version, *String (version)* equals `1.2.0`.

## Updates

Out of the box, Davenport checks GitHub for a new version shortly after it starts and every six hours. When there is one, it offers it to the user, who chooses whether to install it. Nothing installs without asking.

Updating a per-machine (`/allusers`) installation needs administrator rights, so on computers where people aren't administrators you'll usually want to switch the checks off and deploy new versions yourself. Do that with any of:

- the `/DISABLEUPDATES` install switch,
- Group Policy Preferences or an Intune configuration profile setting this registry value:

  ```
  HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Davenport
    DisableUpdates  (DWORD) = 1
  ```

  (The same value under `HKEY_CURRENT_USER` works for one person.)
- the environment variable `DAVENPORT_DISABLE_UPDATES=1`.

With updates switched off, Settings › About says "Updates on this computer are managed by your organisation."

## Signing in

Each person signs in once with their own Google account: **Add a Google account**, then Allow in the browser. There's nothing to configure for that.

In the **Google Admin console**, check that Davenport is allowed to reach your users' data:

1. Go to **Security › Access and data control › API controls › Manage third-party app access**.
2. Choose **Configure new app**, search for the client ID `120430526342-c10p88p8dtcnust9k7ju5oickrm96235.apps.googleusercontent.com`, and set it to **Trusted** for the organisational units that use Davenport.

### Using your organisation's own Google app instead

If you'd rather Davenport signed in as an *Internal* app in your own Google Cloud project (so Google's app review never applies, and you control it completely), create a Desktop app OAuth client as described in [GOOGLE-SETUP.md](GOOGLE-SETUP.md) and deploy its JSON file to every computer as:

```
C:\ProgramData\Davenport\oauth-client.json
```

Davenport uses it for everyone on that computer, and updates don't remove it. Accounts already signed in with Davenport's own app need to sign in once more afterwards.
