' 창 없이 띄운다. 시작프로그램에 두면 부팅 때 같이 올라온다.
Dim here
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
CreateObject("WScript.Shell").Run "cmd /c """ & here & "server-loop.bat""", 0, False