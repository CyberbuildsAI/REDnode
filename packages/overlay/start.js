// Starts the overlay host with Electron. Clears ELECTRON_RUN_AS_NODE first:
// VS Code and tools running inside it set it, and it turns Electron into plain Node.
'use strict';

const { spawn } = require('node:child_process');
const electron = require('electron'); // the path to electron.exe, when run from Node

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, [__dirname, ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
