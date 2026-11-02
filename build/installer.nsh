; Extra settings for Davenport's Windows installer (electron-builder includes this file automatically).

!ifndef BUILD_UNINSTALLER
  ; Davenport is released under the MIT License. It grants permissions and asks nothing of people who
  ; simply use the app, so the installer shows the licence for information with an ordinary Next button
  ; rather than making people click "I Agree". The page is skipped when updating an existing install.
  !define MUI_PAGE_HEADER_TEXT "Licence"
  !define MUI_PAGE_HEADER_SUBTEXT "Davenport is free, open-source software."
  !define MUI_LICENSEPAGE_TEXT_TOP "Davenport is released under the MIT License:"
  !define MUI_LICENSEPAGE_TEXT_BOTTOM "You don't need to accept anything to use Davenport. The licence explains what you may do if you copy, change or share it. Click Next to continue."
  !define MUI_LICENSEPAGE_BUTTON "$(^NextBtn)"
!endif
