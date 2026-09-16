' 터널을 창 없이 띄운다. 시작프로그램에 이 파일의 바로가기를 두면 부팅 때 붙는다.
' 창을 띄우면 검은 콘솔이 하나 남고, 실수로 닫으면 사이트가 죽는다.
CreateObject("WScript.Shell").Run _
  "cmd /c """ & Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\")) & "tunnel-oracle.bat""", 0, False
