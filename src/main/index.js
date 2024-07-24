const core = require('@actions/core');
const exec = require('@actions/exec');
const https = require('https');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');

// get the latest KubeArmor version to download
async function getLatestKubeArmorVersion() {
  return new Promise((resolve, reject) => {
    https.get('https://api.github.com/repos/kubearmor/KubeArmor/releases/latest', {
      headers: { 'User-Agent': 'GitHub-Action' }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const version = JSON.parse(data).tag_name.replace('v', '');
        resolve(version);
      });
    }).on('error', reject);
  });
}

// download KubeArmor for debian (ubuntu), github runner runs on ubuntu
async function downloadKubeArmor(version) {
  const url = `https://github.com/kubearmor/KubeArmor/releases/download/v${version}/kubearmor_${version}_linux-amd64.deb`;
  const filePath = `./kubearmor_${version}_linux-amd64.deb`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      const writeStream = fs.createWriteStream(filePath);
      res.pipe(writeStream);
      writeStream.on('finish', () => {
        writeStream.close();
        resolve(filePath);
      });
    }).on('error', reject);
  });
}

// install KubeArmor 
async function installKubeArmor(filePath) {
  await exec.exec(`sudo apt --no-install-recommends install -y ${filePath}`);
}

// install knoxctl binary
async function installKnoxctl() {
    const installCmd = 'curl -sfL https://knoxctl.accuknox.com/install.sh | sudo -s -- -b /usr/local/bin';
    await exec.exec(installCmd)

    await exec.exec('knoxctl version')
}

function getPidFilePath() {
  if (process.env.GITHUB_WORKSPACE) {
    return path.join(process.env.GITHUB_WORKSPACE, 'knoxctl_scan_pid');
  } else {
    return path.join(__dirname, '..', '..', 'knoxctl_scan_pid');
  }
}

// start KubeArmor sysd service 
async function startKubeArmor() {
  await exec.exec('sudo systemctl start kubearmor');
  await exec.exec('sudo systemctl status kubearmor');
}

// Mock core.getInput and core.getBooleanInput for local testing
if (!process.env.GITHUB_ACTIONS) {
  core.getInput = (name) => {
    const inputs = {
      'all': 'true',
      'system': 'false',
      'output': './test-output'
    };
    return inputs[name] || '';
  };

  core.getBooleanInput = (name) => {
    return core.getInput(name) === 'true';
  };

  core.setFailed = console.error;
}

// runKnoxctlScan runs knoxctl scan as a background process
// and is killed when post job is triggered from CI
async function runKnoxctlScan() {
  const knoxctlOptions = [
    { name: 'all', flag: '--all', type: 'boolean' },
    { name: 'system', flag: '--system', type: 'boolean' },
    { name: 'output', flag: '--output', type: 'string' },
  ];

  let command = ['knoxctl', 'scan'];

  let outputDir = './knoxctl-results';  

  knoxctlOptions.forEach(option => {
    let value;

    if (option.type === 'boolean') {
      value = core.getBooleanInput(option.name);
      if (value) {
        command.push(option.flag);
      }
    } else if (option.type === 'string') {
      value = core.getInput(option.name);
      if (value) {
        if (option.name === 'output') {
          outputDir = value;  
        }
        command.push(option.flag, value);
      }
    }
  });

  if (!fs.existsSync(outputDir)) {
    console.log(`Creating output directory: ${outputDir}`);
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const commandString = command.join(' ');
  console.log(`Executing command: ${commandString}`);

  const scanProcess = spawn(command[0], command.slice(1), { 
    stdio: 'inherit',
    detached: true
  });

  console.log(`knoxctl scan started with PID: ${scanProcess.pid}`);

  const pidFile = getPidFilePath();
  fs.writeFileSync(pidFile, scanProcess.pid.toString()); 

  // letting the parent exit and keep running scan job in the background
  scanProcess.unref();

  console.log(`knoxctl scan PID written to ${pidFile}`);
  console.log('knoxctl scan is running in the background. Use the post script to stop it.');
}

async function run() {
  try {
    if (!process.env.GITHUB_ACTIONS) {
      console.log('Running in local test mode. Skipping KubeArmor and knoxctl installation.');
    } else {
      const version = await getLatestKubeArmorVersion();
      console.log(`Latest KubeArmor version: ${version}`);

      const filePath = await downloadKubeArmor(version);
      console.log(`Downloaded KubeArmor to: ${filePath}`);

      await installKubeArmor(filePath);
      console.log('KubeArmor installed successfully');

      await startKubeArmor();
      console.log('KubeArmor started successfully');

      await installKnoxctl();
      console.log('Installed knoxctl binary');
    }

    await runKnoxctlScan();

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
