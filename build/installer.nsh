; Extra pages for Davenport's Windows installer (electron-builder includes this file automatically).
;
; The installer runs: Welcome -> Licence -> Who to install for -> Folder -> Installing -> Finish.
; Choosing "Anyone who uses this computer" restarts the installer with administrator rights (the UAC
; prompt). The restarted copy skips the Welcome and Licence pages so they aren't shown twice, and both
; are skipped when Davenport updates itself.

!macro customWelcomePage
  Function davenportSkipIntroPages
    ${if} ${isUpdated}
      Abort
    ${endif}
    ${if} ${UAC_IsInnerInstance}
      Abort
    ${endif}
  FunctionEnd

  ; Welcome
  !define MUI_PAGE_CUSTOMFUNCTION_PRE davenportSkipIntroPages
  !define MUI_WELCOMEPAGE_TEXT "Setup will install Davenport on your computer.$\r$\n$\r$\nDavenport brings Gmail, Google Calendar, Contacts and Google Chat together in one desktop app.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME

  ; Licence: the MIT License asks nothing of people who just use the app, so it's shown with a Next button.
  !define MUI_PAGE_CUSTOMFUNCTION_PRE davenportSkipIntroPages
  !define MUI_PAGE_HEADER_TEXT "Licence"
  !define MUI_PAGE_HEADER_SUBTEXT "Davenport is free, open-source software."
  !define MUI_LICENSEPAGE_TEXT_TOP "Davenport is free software, licensed under the MIT License below."
  !define MUI_LICENSEPAGE_TEXT_BOTTOM " "
  !define MUI_LICENSEPAGE_BUTTON "$(^NextBtn)"
  !insertmacro MUI_PAGE_LICENSE "${BUILD_RESOURCES_DIR}\mit-licence.txt"
!macroend

; Deployment switches for network managers (see docs/DEPLOYMENT.md), alongside electron-builder's own
; /S (silent), /allusers, /currentuser and /D=<folder>:
;   /DISABLEUPDATES   switch off Davenport's own update checks on this computer (needs /allusers)
!include "FileFunc.nsh"
!macro customInstall
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/DISABLEUPDATES" $R1
  ${IfNot} ${Errors}
    WriteRegDWORD HKLM "SOFTWARE\Policies\Davenport" "DisableUpdates" 1
  ${EndIf}
!macroend
