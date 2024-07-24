const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getPidFilePath() {
  if (process.env.GITHUB_WORKSPACE) {
    return path.join(process.env.GITHUB_WORKSPACE, 'knoxctl_scan_pid');
  } else {
    return path.join(__dirname, '..', '..', 'knoxctl_scan_pid');
  }
}

function stopKnoxctlScan() {
  const pidFile = getPidFilePath();
  
  if (fs.existsSync(pidFile)) {
    const pid = fs.readFileSync(pidFile, 'utf8');
    console.log(`Stopping knoxctl scan process with PID: ${pid}`);
    
    try {
      process.kill(parseInt(pid), 'SIGINT');
      console.log('knoxctl scan process stopped successfully');
    } catch (error) {
      console.error('Failed to stop knoxctl scan process:', error);
    }

    fs.unlinkSync(pidFile);
  } else {
    console.log('No knoxctl scan PID file found');
  }

  console.log('Processing knoxctl results');
}

function run() {
  try {
    stopKnoxctlScan();
  } catch (error) {
    console.error('Error in post-job script:', error);
    process.exit(1);
  }
}

run();
