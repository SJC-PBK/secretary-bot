' 비서봇 PC 중계기를 창 없이 실행한다(로그인 시 자동 실행용). 로그: relay\relay.log
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\jobcnt\projects\secretary-bot\relay"
sh.Run """C:\Program Files\nodejs\node.exe"" relay.js", 0, False
