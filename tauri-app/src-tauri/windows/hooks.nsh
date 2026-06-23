!include "LogicLib.nsh"

; Silently kill a process by name using taskkill /F /T (whole process tree).
; Used for background workers (ios.exe, python.exe) that have no UI to close.
!macro SilentKillProcess PROCESS_NAME
    nsExec::Exec 'taskkill /F /T /IM "${PROCESS_NAME}"'
    Sleep 500
!macroend

!macro CheckAndKillProcess PROCESS_NAME
    nsExec::ExecToStack 'cmd.exe /c "tasklist /NH /FI `"IMAGENAME eq ${PROCESS_NAME}`" | find /I `"${PROCESS_NAME}`""'
    Pop $0
    Pop $1
    ${If} $0 == 0
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
            "${PROCESS_NAME} est en cours d'exécution. Veuillez fermer le programme pour continuer l'installation, ou Annuler pour abandonner." \
            /SD IDCANCEL IDRETRY retry_${PROCESS_NAME} IDCANCEL abort_${PROCESS_NAME}

        retry_${PROCESS_NAME}:
            nsExec::ExecToStack 'cmd.exe /c "tasklist /NH /FI `"IMAGENAME eq ${PROCESS_NAME}`" | find /I `"${PROCESS_NAME}`""'
            Pop $0
            Pop $1
            ${If} $0 == 0
                # Try to kill it automatically to help the user.
                nsExec::Exec 'taskkill /F /T /IM "${PROCESS_NAME}"'
                Sleep 1000
                nsExec::ExecToStack 'cmd.exe /c "tasklist /NH /FI `"IMAGENAME eq ${PROCESS_NAME}`" | find /I `"${PROCESS_NAME}`""'
                Pop $0
                Pop $1
                ${If} $0 == 0
                    MessageBox MB_OK|MB_ICONSTOP "Impossible d'arrêter ${PROCESS_NAME}. Veuillez le fermer manuellement et relancer l'installateur."
                    Abort
                ${EndIf}
            ${EndIf}
            Goto end_${PROCESS_NAME}

        abort_${PROCESS_NAME}:
            Abort

        end_${PROCESS_NAME}:
    ${EndIf}
!macroend

!macro NSIS_HOOK_PREINSTALL
    ; Kill the Tauri UI (user-facing app — show a retry dialog if running).
    !insertmacro CheckAndKillProcess "tauri-app.exe"

    ; Silently kill background workers spawned by the engine — no user dialog
    ; needed since these are headless daemons that should not be left running.
    !insertmacro SilentKillProcess "gpsmock-engine-x86_64-pc-windows-msvc.exe"
    !insertmacro SilentKillProcess "gpsmock-engine.exe"
    ; go-ios tunnel daemon
    !insertmacro SilentKillProcess "ios.exe"
    ; Python workers (pymobiledevice3 remote tunneld + location_worker.py)
    ; Kill both the embedded python-embed interpreter and any system Python.
    !insertmacro SilentKillProcess "python.exe"
    !insertmacro SilentKillProcess "python3.exe"
!macroend
