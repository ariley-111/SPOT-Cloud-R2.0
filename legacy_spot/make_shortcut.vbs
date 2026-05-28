' ============================================================
' make_shortcut.vbs — SPOT desktop shortcut creator
'
' Called from install.bat:
'   cscript //nologo make_shortcut.vbs "<install_dir>"
'
' Uses WScript.Shell.CreateShortcut + SpecialFolders("Desktop"),
' which correctly resolves OneDrive-redirected Desktop folders.
'
' Target:        OPEN_SPOT.bat in install_dir
' Icon:          spot.ico in install_dir (falls back to default if absent)
' Window style:  7 (minimized) — keeps the launcher cmd window out of the way
' Shortcut name: "SPOT" on user Desktop
' ============================================================

Option Explicit

Dim WshShell, FSO, installDir, targetBat, iconFile, desktopPath, shortcutPath, shortcut

If WScript.Arguments.Count < 1 Then
    WScript.Echo "ERROR: install_dir argument required."
    WScript.Echo "Usage: cscript //nologo make_shortcut.vbs ""<install_dir>"""
    WScript.Quit 1
End If

installDir   = WScript.Arguments(0)
Set WshShell = CreateObject("WScript.Shell")
Set FSO      = CreateObject("Scripting.FileSystemObject")

' --- Validate install_dir + target ---
If Not FSO.FolderExists(installDir) Then
    WScript.Echo "ERROR: install_dir does not exist: " & installDir
    WScript.Quit 2
End If

targetBat = installDir & "\OPEN_SPOT.bat"
If Not FSO.FileExists(targetBat) Then
    WScript.Echo "ERROR: OPEN_SPOT.bat not found in install_dir."
    WScript.Quit 3
End If

' --- Desktop path (handles OneDrive redirection automatically) ---
desktopPath  = WshShell.SpecialFolders("Desktop")
shortcutPath = desktopPath & "\SPOT.lnk"

WScript.Echo "Desktop folder: " & desktopPath
WScript.Echo "Shortcut path : " & shortcutPath
WScript.Echo "Target        : " & targetBat

' --- Create shortcut ---
Set shortcut = WshShell.CreateShortcut(shortcutPath)
shortcut.TargetPath       = targetBat
shortcut.WorkingDirectory = installDir
shortcut.WindowStyle      = 7   ' minimized
shortcut.Description      = "SPOT — Standard Printing Optimization Tool"

iconFile = installDir & "\spot.ico"
If FSO.FileExists(iconFile) Then
    shortcut.IconLocation = iconFile & ",0"
    WScript.Echo "Icon          : " & iconFile
Else
    WScript.Echo "Icon          : (default — spot.ico not found)"
End If

shortcut.Save

WScript.Echo "OK: desktop shortcut created."
WScript.Quit 0
