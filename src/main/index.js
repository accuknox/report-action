const core = require('@actions/core');
const exec = require('@actions/exec');
const https = require('https');
const fs = require('fs');
const { spawn } = require('child_process');

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

async function runKnoxctlScan() {
  const knoxctlOptions = [
    { name: 'all', flag: '--all', type: 'boolean' },
    { name: 'system', flag: '--system', type: 'boolean' },
    { name: 'output', flag: '--output', type: 'string' },
  ];

  let command = ['knoxctl', 'scan'];

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
        command.push(option.flag, value);
      }
    }
  });

  const commandString = command.join(' ');
  console.log(`Executing command: ${commandString}`);

  return new Promise((resolve, reject) => {
    const scanProcess = spawn(command[0], command.slice(1), { stdio: 'inherit' });

    console.log(`knoxctl scan started with PID: ${scanProcess.pid}`);

    // Run the scan for 60 seconds (adjust as needed)
    setTimeout(() => {
      console.log('Stopping knoxctl scan...');
      scanProcess.kill('SIGINT');  // Send interrupt signal
    }, 60000);  // 60 seconds

    scanProcess.on('close', (code) => {
      console.log(`knoxctl scan process exited with code ${code}`);
      resolve();
    });

    scanProcess.on('error', (err) => {
      console.error('Failed to start knoxctl scan process:', err);
      reject(err);
    });
  });
}

// runs
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
    console.log('knoxctl scan completed');

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
