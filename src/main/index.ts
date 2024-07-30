import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as https from "node:https";
import * as path from "node:path";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
import {
	IS_GITHUB_ACTIONS,
	getOutputDir,
	getPidFilePath,
	log,
	mockCoreForLocalTesting,
} from "@common/common";

async function getLatestKubeArmorVersion(): Promise<string> {
	return new Promise((resolve, reject) => {
		https
			.get(
				"https://api.github.com/repos/kubearmor/KubeArmor/releases/latest",
				{
					headers: { "User-Agent": "GitHub-Action" },
				},
				(res) => {
					let data = "";
					res.on("data", (chunk) => {
						data += chunk;
					});
					res.on("end", () => {
						const version = JSON.parse(data).tag_name.replace("v", "");
						resolve(version);
					});
				},
			)
			.on("error", reject);
	});
}

async function downloadKubeArmor(version: string): Promise<string> {
	const url = `https://github.com/kubearmor/KubeArmor/releases/download/v${version}/kubearmor_${version}_linux-amd64.deb`;
	const filePath = `./kubearmor_${version}_linux-amd64.deb`;

	try {
		await exec.exec("curl", ["-L", "-o", filePath, url]);

		if (fs.existsSync(filePath)) {
			const stats = fs.statSync(filePath);
			log(`Downloaded KubeArmor (${stats.size} bytes) to: ${filePath}`);
			return filePath;
		}

		throw new Error(
			`Failed to download KubeArmor: File not found at ${filePath}`,
		);
	} catch (error) {
		throw new Error(
			`Failed to download KubeArmor: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

async function installKubeArmor(filePath: string): Promise<void> {
	await exec.exec("sudo apt update");

	try {
		await exec.exec(`sudo dpkg -i ${filePath}`);
	} catch (error) {
		log("dpkg installation failed, attempting to fix broken dependencies...");
		await exec.exec("sudo apt-get install -f");

		await exec.exec(`sudo dpkg -i ${filePath}`);
	}

	const result = await exec.exec("dpkg -s kubearmor", [], {
		ignoreReturnCode: true,
	});
	if (result !== 0) {
		throw new Error("KubeArmor installation verification failed");
	}
}

async function installKnoxctl(): Promise<void> {
	const installCmd =
		"curl -sfL https://knoxctl.accuknox.com/install.sh | sudo sh -s -- -b /usr/local/bin";
	await exec.exec(installCmd);
	await exec.exec("knoxctl version");
}

async function startKubeArmor(): Promise<void> {
	await exec.exec("sudo systemctl start kubearmor");
	await exec.exec("sudo systemctl status kubearmor");
}

async function runKnoxctlScan(): Promise<void> {
	const knoxctlOptions = [
		{ name: "all", flag: "--all", type: "boolean" },
		{ name: "system", flag: "--system", type: "boolean" },
		{ name: "output", flag: "--output", type: "string" },
	];

	const command: string[] = ["knoxctl", "scan"];
	let outputDir = getOutputDir();

	for (const option of knoxctlOptions) {
		let value: boolean | string;

		if (option.type === "boolean") {
			value = core.getBooleanInput(option.name);
			if (value) {
				command.push(option.flag);
			}
		} else if (option.type === "string") {
			value = core.getInput(option.name);
			if (value) {
				if (option.name === "output") {
					outputDir = value;
				}
				command.push(option.flag, value);
			}
		}
	}

	if (!fs.existsSync(outputDir)) {
		log(`Creating output directory: ${outputDir}`);
		fs.mkdirSync(outputDir, { recursive: true });
	}

	const commandString = command.join(" ");
	log(`Executing command: ${commandString}`);

	const scanProcess: ChildProcess = spawn(command[0], command.slice(1), {
		stdio: "inherit",
		detached: true,
	});

	log(`knoxctl scan started with PID: ${scanProcess.pid}`);

	const pidFile = getPidFilePath();
	fs.writeFileSync(pidFile, scanProcess.pid?.toString() ?? "");

	scanProcess.unref();

	log(`knoxctl scan PID written to ${pidFile}`);
	log(
		"knoxctl scan is running in the background. Use the post script to stop it.",
	);
}

async function run(): Promise<void> {
	try {
		mockCoreForLocalTesting();

		if (!IS_GITHUB_ACTIONS) {
			log(
				"Running in local test mode. Skipping KubeArmor and knoxctl installation.",
			);
		} else {
			const version = await getLatestKubeArmorVersion();
			log(`Latest KubeArmor version: ${version}`);

			const filePath = await downloadKubeArmor(version);
			log(`Downloaded KubeArmor to: ${filePath}`);

			await installKubeArmor(filePath);
			log("KubeArmor installed successfully");

			await startKubeArmor();
			log("KubeArmor started successfully");

			await installKnoxctl();
			log("Installed knoxctl binary");
		}

		await runKnoxctlScan();
	} catch (error) {
		if (error instanceof Error) {
			core.setFailed(`Error: ${error.message}\nStack: ${error.stack}`);
		} else {
			core.setFailed(`An unknown error occurred: ${error}`);
		}
	}
}

run();
