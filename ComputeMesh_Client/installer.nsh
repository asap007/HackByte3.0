!macro customInit
  SetRegView 64
  
  ; Remove the silent flag to show the NSIS progress dialog
  ; SetSilent silent   ; Comment out or remove this line
  
  ; Close the application if it's running
  !define APP_NAME "dllmchat.exe"
  !define KILL_APP "taskkill /F /IM ${APP_NAME}"
  
  nsExec::Exec "${KILL_APP}"
!macroend

!macro customInstall
  ; Additional installation steps can be added here
!macroend

!macro customUnInstall
  ; Additional uninstallation steps can be added here
!macroend