/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 81:
/***/ ((module) => {

"use strict";
module.exports = require("child_process");

/***/ }),

/***/ 147:
/***/ ((module) => {

"use strict";
module.exports = require("fs");

/***/ }),

/***/ 17:
/***/ ((module) => {

"use strict";
module.exports = require("path");

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __nccwpck_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		var cachedModule = __webpack_module_cache__[moduleId];
/******/ 		if (cachedModule !== undefined) {
/******/ 			return cachedModule.exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __nccwpck_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	if (typeof __nccwpck_require__ !== 'undefined') __nccwpck_require__.ab = __dirname + "/";
/******/ 	
/************************************************************************/
var __webpack_exports__ = {};
// This entry need to be wrapped in an IIFE because it need to be isolated against other modules in the chunk.
(() => {
const fs = __nccwpck_require__(147);
const path = __nccwpck_require__(17);
const { execSync } = __nccwpck_require__(81);

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
}

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

})();

module.exports = __webpack_exports__;
/******/ })()
;