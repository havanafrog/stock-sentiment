' 창 없이 띄운다. 인자를 주면 그대로 넘긴다.
'   wscript claude-loop.vbs "해야 할 일" 900
Dim here, args, i
here = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\"))
args = ""
For i = 0 To WScript.Arguments.Count - 1
  args = args & " """ & WScript.Arguments(i) & """"
Next
CreateObject("WScript.Shell").Run "cmd /c """ & here & "claude-loop.bat""" & args, 0, False
