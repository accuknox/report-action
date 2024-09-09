import * as fs from "node:fs";
import * as path from "node:path";
import * as artifact from "@actions/artifact";
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
const ALERTS_PREFIX = "knoxctl_scan_processed_alerts_";

const MAX_SUMMARY_SIZE = 1024 * 1024;
const TRUNCATION_MESSAGE =
	"\n\n... (content truncated due to size limits, please download artifacts) ...";

function truncateContent(content: string, maxSize: number): string {
	if (Buffer.byteLength(content, "utf8") <= maxSize) {
		return content;
	}

	let truncated = content;
	while (Buffer.byteLength(truncated + TRUNCATION_MESSAGE, "utf8") > maxSize) {
		truncated = truncated.slice(0, -100);
	}

	return truncated + TRUNCATION_MESSAGE;
}

async function uploadContentAsArtifact(
	content: string,
	fileName: string,
): Promise<string> {
	const artifactClient = artifact.create();
	const artifactName = `full-content-${fileName}`;
	const tempDir = path.join(getOutputDir(), "temp-artifacts");
	const tempFile = path.join(tempDir, fileName);

	if (!fs.existsSync(tempDir)) {
		fs.mkdirSync(tempDir, { recursive: true });
	}

	fs.writeFileSync(tempFile, content, ENCODING);

	try {
		const uploadResult = await artifactClient.uploadArtifact(
			artifactName,
			[tempFile],
			tempDir,
			{ continueOnError: false },
		);

		log(`Uploaded full content as artifact: ${uploadResult.artifactName}`);
		return artifactName;
	} catch (error) {
		log(
			`Failed to upload content as artifact: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
		return "";
	} finally {
		fs.unlinkSync(tempFile);
	}
}

async function addToSummaryWithSizeCheck(
	content: string,
	title: string,
): Promise<void> {
	let summaryContent = `## ${title}\n\n${content}`;
	const contentSize = Buffer.byteLength(summaryContent, "utf8");

	if (contentSize > MAX_SUMMARY_SIZE) {
		log(
			`Content for ${title} exceeds maximum size. Truncating and uploading full content as artifact.`,
		);
		const artifactName = await uploadContentAsArtifact(
			content,
			`${title.toLowerCase().replace(/\s+/g, "-")}.md`,
		);

		summaryContent = truncateContent(summaryContent, MAX_SUMMARY_SIZE - 200);
		summaryContent += `\n\n[View full content](${artifactName})`;
	}

	if (IS_GITHUB_ACTIONS) {
		core.summary.addRaw(summaryContent).addEOL();
	} else {
		console.log(summaryContent);
	}
}

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

async function processResultFile(
	outputDir: string,
	prefix: string,
	title: string,
	emoji: string,
): Promise<void> {
	const file = getLatestFile(outputDir, prefix);
	if (file) {
		const filePath = path.join(outputDir, file);
		log(`Processing ${title} file: ${filePath}`);
		const content = fs.readFileSync(filePath, ENCODING);
		await addToSummaryWithSizeCheck(`${emoji} ${title}\n\n${content}`, title);
	} else {
		log(
			`No ${title.toLowerCase()} file found with prefix ${prefix} in ${outputDir}`,
		);
	}
}

async function processResults(): Promise<void> {
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

	await addToSummaryWithSizeCheck(
		"📊 Runtime Security Report Generated by AccuKnox",
		"Report Overview",
	);

	await processResultFile(outputDir, ALERTS_PREFIX, "Alerts Summary", "🚨");
	await processResultFile(outputDir, PROCESS_TREE_PREFIX, "Process Tree", "🖥️");
	await processResultFile(
		outputDir,
		NETWORK_EVENTS_PREFIX,
		"Network Events",
		"🌐",
	);

	if (!IS_GITHUB_ACTIONS) {
		log(
			"\nResults processing complete. In a GitHub Actions environment, these results would be added to the job summary.",
		);
	}
}

async function run(): Promise<void> {
	try {
		stopKnoxctlScan();

		// Increase wait time and add file system sync
		await new Promise((resolve) => setTimeout(resolve, 15000));

		const outputDir = getOutputDir();
		log(`Output directory: ${outputDir}`);
		log("Contents of output directory:");
		const files = fs.readdirSync(outputDir);
		for (const file of files) {
			if (file.startsWith("knoxctl_scan_")) {
				log(`- ${file}`);
			}
		}

		await processResults();

		await uploadArtifacts(outputDir);

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

async function uploadArtifacts(outputDir: string): Promise<void> {
	if (!IS_GITHUB_ACTIONS) {
		log("Running in local environment. Artifact upload is skipped.", "warning");
		return;
	}

	const artifactClient = artifact.create();
	const artifactName = "knoxctl-scan-results";
	const files = fs
		.readdirSync(outputDir)
		.filter((file) => file.startsWith("knoxctl_scan_"))
		.map((file) => path.join(outputDir, file));

	log(`Uploading ${files.length} files as artifacts`);

	try {
		const uploadResult = await artifactClient.uploadArtifact(
			artifactName,
			files,
			outputDir,
			{
				continueOnError: false,
			},
		);

		log(
			`Artifact upload result: ${uploadResult.artifactName} (${uploadResult.size} bytes)`,
		);
	} catch (error) {
		log(
			`Failed to upload artifacts: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
	}
}

run();
