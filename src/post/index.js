const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/*
    * Post is supposed to run as post job. 
    * After all the CI events/steps are over. 
*/

function getPidFilePath() {
  if (process.env.GITHUB_WORKSPACE) {
    return path.join(process.env.GITHUB_WORKSPACE, 'knoxctl_scan_pid');
  } else {
    return path.join(__dirname, '..', '..', 'knoxctl_scan_pid');
  }
}

// stopKnoxctlScan sends a SIGINT to running scan job 
// it does this by looking for a PID of currently running scan job
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
}

// getLatestFile gets the file that needs to be displayed 
function getLatestFile(directory, prefix) {
  const files = fs.readdirSync(directory)
    .filter(file => file.startsWith(prefix) && file.endsWith('.md'))
    .map(file => ({name: file, time: fs.statSync(path.join(directory, file)).mtime.getTime()}))
    .sort((a, b) => b.time - a.time);

  return files.length > 0 ? files[0].name : null;
}

function addToGitHubSummary(content) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) {
    fs.appendFileSync(summaryFile, content + '\n');
  } else {
    console.log(content);
  }
}

// processResults will process markdown and show it in 
// Actions' runtime summary 
function processResults() {
  const isGitHubActions = !!process.env.GITHUB_ACTIONS;
  const outputDir = isGitHubActions ? process.env.GITHUB_WORKSPACE : path.join(__dirname, '..', '..', 'test-output');

  console.log('Processing knoxctl results');

  if (!isGitHubActions) {
    console.log('Running in local environment. Results will be displayed in the console.');
  }

  // Process Network Events
  const networkEventsFile = getLatestFile(outputDir, 'knoxctl_scan_network_events_md_');
  if (networkEventsFile) {
    const networkEventsContent = fs.readFileSync(path.join(outputDir, networkEventsFile), 'utf8');
    addToGitHubSummary('## Network Events\n\n' + networkEventsContent);
  } else {
    console.log('No network events file found');
  }

  // Process Process Tree
  const processTreeFile = getLatestFile(outputDir, 'knoxctl_scan_process_tree_');
  if (processTreeFile) {
    const processTreeContent = fs.readFileSync(path.join(outputDir, processTreeFile), 'utf8');
    addToGitHubSummary('## Process Tree\n\n' + processTreeContent);
  } else {
    console.log('No process tree file found');
  }

  if (!isGitHubActions) {
    console.log('\nResults processing complete. In a GitHub Actions environment, these results would be added to the job summary.');
  }
}

function run() {
  try {
    stopKnoxctlScan();
    processResults();
  } catch (error) {
    console.error('Error in post-job script:', error);
    process.exit(1);
  }
}

run();
