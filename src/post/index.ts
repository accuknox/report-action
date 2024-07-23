import * as core from "@actions/core";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	log,
	getPidFilePath,
	getOutputDir,
	IS_GITHUB_ACTIONS,
	ENCODING,
} from "@common/common";

const NETWORK_EVENTS_PREFIX = "knoxctl_scan_network_events_md_";
const PROCESS_TREE_PREFIX = "knoxctl_scan_process_tree_";

function stopKnoxctlScan(): void {
	const pidFile = getPidFilePath();

	if (fs.existsSync(pidFile)) {
		const pid = fs.readFileSync(pidFile, ENCODING).toString();
		log(`Stopping knoxctl scan process with PID: ${pid}`);

		try {
			process.kill(Number.parseInt(pid), "SIGINT");
			log("knoxctl scan process stopped successfully");
		} catch (error) {
			log("Failed to stop knoxctl scan process:", "error");
			log(error instanceof Error ? error.message : String(error), "error");
		}

		fs.unlinkSync(pidFile);
	} else {
		log("No knoxctl scan PID file found");
	}
}

function getLatestFile(directory: string, prefix: string): string | null {
	const files = fs
		.readdirSync(directory)
		.filter((file) => file.startsWith(prefix) && file.endsWith(".md"))
		.map((file) => ({
			name: file,
			time: fs.statSync(path.join(directory, file)).mtime.getTime(),
		}))
		.sort((a, b) => b.time - a.time);

	return files.length > 0 ? files[0].name : null;
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
		const content = fs.readFileSync(path.join(outputDir, file), ENCODING);
		addToSummary(`## ${title}\n\n${content}`);
	} else {
		log(`No ${title.toLowerCase()} file found`);
	}
}

function processResults(): void {
	const outputDir = getOutputDir();

	if (!outputDir) {
		throw new Error("Output directory is not defined");
	}

	log("Processing knoxctl results");

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
