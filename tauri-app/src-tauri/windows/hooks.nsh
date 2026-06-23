!include "LogicLib.nsh"

!macro CheckAndKillProcess PROCESS_NAME
    nsExec::ExecToStack 'cmd.exe /c "tasklist /NH /FI `"IMAGENAME eq ${PROCESS_NAME}`" | find /I `"${PROCESS_NAME}`""'
    Pop $0
    Pop $1
    ${If} $0 == 0
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \
            "${PROCESS_NAME} est en cours d’exécution. Veuillez fermer le programme pour continuer l’installation, ou Annuler pour abandonner." \
            /SD IDCANCEL IDRETRY retry_${PROCESS_NAME} IDCANCEL abort_${PROCESS_NAME}

        retry_${PROCESS_NAME}:
            nsExec::ExecToStack 'cmd.exe /c "tasklist /NH /FI `"IMAGENAME eq ${PROCESS_NAME}`" | find /I `"${PROCESS_NAME}`""'
            Pop $0
            Pop $1
            ${If} $0 == 0
                # Try to kill it automatically to help the user.
                nsExec::Exec 'taskkill /F /IM "${PROCESS_NAME}"'
                Sleep 1000
                nsExec::ExecToStack 'cmd.exe /c "tasklist /NH /FI `"IMAGENAME eq ${PROCESS_NAME}`" | find /I `"${PROCESS_NAME}`""'
                Pop $0
                Pop $1
                ${If} $0 == 0
                    MessageBox MB_OK|MB_ICONSTOP "Impossible d’arrêter ${PROCESS_NAME}. Veuillez le fermer manuellement et relancer l’installateur."
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
    !insertmacro CheckAndKillProcess "tauri-app.exe"
    !insertmacro CheckAndKillProcess "ios.exe"
    !insertmacro CheckAndKillProcess "gpsmock-engine-x86_64-pc-windows-msvc.exe"
    !insertmacro CheckAndKillProcess "gpsmock-engine.exe"
!macroend
