#!/bin/zsh
cd -- "${0:A:h}/project" || exit 1
python3 app.py
if [[ $? -ne 0 ]]; then
  printf '\n启动失败，请查看上方提示。按回车关闭。\n'
  read
fi
