#!/bin/zsh
cd -- "${0:A:h}/packaging" || exit 1
electron="./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"
if [[ ! -x "$electron" || ! -x "./python/bin/python3" ]]; then
  printf '缺少开发运行环境，请查看 packaging/AI接入说明.md。\n按回车关闭。\n'
  read
  exit 1
fi
/usr/bin/env -u ELECTRON_RUN_AS_NODE "$electron" ./shell
if [[ $? -ne 0 ]]; then
  printf '\n启动失败，请查看上方提示。按回车关闭。\n'
  read
fi
