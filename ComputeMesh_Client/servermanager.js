// const { spawn } = require('child_process');
// const path = require('path');
// const isDev = process.env.NODE_ENV === 'development';

// function startNextServer() {
//   let projectRoot;
//   let standaloneServerPath;
  
//   if (isDev) {
//     projectRoot = __dirname;
//     standaloneServerPath = path.join(projectRoot, '.next', 'standalone', 'server.js');
//   } else {
//     projectRoot = path.join(process.resourcesPath, '.next');
//     standaloneServerPath = path.join(projectRoot, 'standalone', 'server.js');
//   }
  
//   console.log(`Starting Next.js server from: ${standaloneServerPath}`);
  
//   const nextServerProcess = spawn('node', [standaloneServerPath], {
//     cwd: projectRoot,
//     env: {
//       ...process.env,
//       NODE_ENV: process.env.NODE_ENV || 'production'
//     },
//     stdio: 'pipe',
//     shell: true
//   });
  
//   nextServerProcess.stdout.on('data', (data) => {
//     console.log(`Next.js server stdout: ${data}`);
//   });
  
//   nextServerProcess.stderr.on('data', (data) => {
//     console.error(`Next.js server stderr: ${data}`);
//   });
  
//   nextServerProcess.on('close', (code) => {
//     console.log(`Next.js server process exited with code ${code}`);
//   });
  
//   nextServerProcess.on('error', (err) => {
//     console.error('Failed to start Next.js server:', err);
//   });
  
//   return nextServerProcess;
// }

// module.exports = { startNextServer };