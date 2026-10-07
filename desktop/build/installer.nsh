; Electron's sandboxed helper processes must be able to read the install folder. A per-user install lands in
; %LOCALAPPDATA%\Programs, which can inherit ACL entries (left there by other sandboxing tools) that list
; specific AppContainer packages but not ALL APPLICATION PACKAGES; Electron then refuses to start.
; Grant ALL APPLICATION PACKAGES read access to Cleaner's own folder, as Program Files has by default.
!macro customInstall
  nsExec::ExecToLog 'icacls "$INSTDIR" /grant *S-1-15-2-1:(OI)(CI)(RX) /C /Q'
  Pop $0
!macroend
