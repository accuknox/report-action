import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import {
	ENCODING,
	IS_GITHUB_ACTIONS,
	getOutputDir,
	getPidFilePath,
	log,
} from "@common/common";

const NETWORK_EVENTS_PREFIX = "knoxctl_scan_network_events_md_";
const PROCESS_TREE_PREFIX = "knoxctl_scan_process_tree_";

function stopKnoxctlScan(): void {
	const pidFile = getPidFilePath();
	if (fs.existsSync(pidFile)) {
		const pid = fs.readFileSync(pidFile, ENCODING).trim();
		log(`Attempting to stop knoxctl scan process with PID: ${pid}`);
		try {
			process.kill(Number(pid), "SIGINT");
			log("Sent SIGINT signal to knoxctl scan process");
			setTimeout(() => {
				try {
					process.kill(Number(pid), 0);
					log("Process is still running. Attempting to force kill...");
					process.kill(Number(pid), "SIGKILL");
				} catch (error) {
					log("knoxctl scan process has been terminated");
				}
				fs.unlinkSync(pidFile);
				log("Removed PID file");
			}, 5000);
		} catch (error) {
			log(
				`Failed to stop knoxctl scan process: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	} else {
		log(
			"No knoxctl scan PID file found. The process may have already completed.",
		);
	}
}

function getLatestFile(directory: string, prefix: string): string | null {
	log(`Searching for files with prefix "${prefix}" in directory: ${directory}`);

	if (!fs.existsSync(directory)) {
		log(`Directory does not exist: ${directory}`, "error");
		return null;
	}

	const files = fs.readdirSync(directory);
	log(`Files in directory: ${files.join(", ")}`);

	const matchingFiles = files
		.filter((file) => file.startsWith(prefix) && file.endsWith(".md"))
		.map((file) => ({
			name: file,
			time: fs.statSync(path.join(directory, file)).mtime.getTime(),
		}))
		.sort((a, b) => b.time - a.time);

	log(`Matching files: ${matchingFiles.map((f) => f.name).join(", ")}`);
	return matchingFiles.length > 0 ? matchingFiles[0].name : null;
}

function addToSummary(content: string): void {
	if (IS_GITHUB_ACTIONS) {
		core.summary.addRaw(content).addEOL();
	} else {
		console.log(content);
	}
}

function processResultFile(
	outputDir: string,
	prefix: string,
	title: string,
): void {
	const file = getLatestFile(outputDir, prefix);
	if (file) {
		const filePath = path.join(outputDir, file);
		log(`Processing ${title} file: ${filePath}`);
		const content = fs.readFileSync(filePath, ENCODING);
		addToSummary(`## ${title}\n\n${content}`);
	} else {
		log(
			`No ${title.toLowerCase()} file found with prefix ${prefix} in ${outputDir}`,
		);
	}
}

function processResults(): void {
	const outputDir = path.resolve(getOutputDir());
	log(`Processing knoxctl results from directory: ${outputDir}`);

	if (!fs.existsSync(outputDir)) {
		log(`Output directory does not exist: ${outputDir}`, "error");
		return;
	}

	if (!IS_GITHUB_ACTIONS) {
		log(
			"Running in local environment. Results will be displayed in the console.",
			"warning",
		);
	}

	processResultFile(outputDir, NETWORK_EVENTS_PREFIX, "Network Events");
	processResultFile(outputDir, PROCESS_TREE_PREFIX, "Process Tree");

	if (!IS_GITHUB_ACTIONS) {
		log(
			"\nResults processing complete. In a GitHub Actions environment, these results would be added to the job summary.",
		);
	}
}

async function run(): Promise<void> {
	try {
		stopKnoxctlScan();
		await new Promise((resolve) => setTimeout(resolve, 6000));
		processResults();
		if (IS_GITHUB_ACTIONS) {
			await core.summary.write();
		}
	} catch (error) {
		if (IS_GITHUB_ACTIONS) {
			core.setFailed(error instanceof Error ? error.message : String(error));
		} else {
			console.error("Error in post-job script:", error);
			process.exit(1);
		}
	}
}

run();
