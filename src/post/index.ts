import * as fs from "node:fs";
import * as path from "node:path";
import * as artifact from "@actions/artifact";
import * as core from "@actions/core";
import * as exec from "@actions/exec";
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

	try {
		await exec.exec("sudo", ["mkdir", "-p", tempDir]);

		// Convert content to Buffer
		const contentBuffer = Buffer.from(content, "utf-8");

		await exec.exec("sudo", ["tee", tempFile], { input: contentBuffer });

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
		try {
			await exec.exec("sudo", ["rm", "-f", tempFile]);
		} catch (error) {
			log(
				`Failed to remove temporary file: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
		}
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

async function stopKnoxctlScan(): Promise<void> {
	const pidFile = getPidFilePath();
	if ((await exec.exec("sudo", ["test", "-f", pidFile])) === 0) {
		const { stdout: pid } = await exec.getExecOutput("sudo", ["cat", pidFile]);
		log(`Attempting to stop knoxctl scan process with PID: ${pid.trim()}`);
		try {
			await exec.exec("sudo", ["kill", "-SIGINT", pid.trim()]);
			log("Sent SIGINT signal to knoxctl scan process");
			await new Promise((resolve) => setTimeout(resolve, 5000));
			try {
				await exec.exec("sudo", ["kill", "-0", pid.trim()]);
				log("Process is still running. Attempting to force kill...");
				await exec.exec("sudo", ["kill", "-SIGKILL", pid.trim()]);
			} catch (error) {
				log("knoxctl scan process has been terminated");
			}
			await exec.exec("sudo", ["rm", "-f", pidFile]);
			log("Removed PID file");

			const outputDir = getOutputDir();
			log(`Checking permissions of files in: ${outputDir}`);
			const { stdout } = await exec.getExecOutput("sudo", [
				"ls",
				"-l",
				outputDir,
			]);
			log("File permissions:");
			log(stdout);
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

async function getLatestFile(
	directory: string,
	prefix: string,
): Promise<string | null> {
	log(`Searching for files with prefix "${prefix}" in directory: ${directory}`);

	try {
		const { stdout: filesStr } = await exec.getExecOutput("sudo", [
			"ls",
			"-t",
			directory,
		]);
		const files = filesStr.split("\n").filter(Boolean);
		log(`Files in directory: ${files.join(", ")}`);

		const matchingFiles = await Promise.all(
			files
				.filter((file) => file.startsWith(prefix) && file.endsWith(".md"))
				.map(async (file) => {
					const { stdout: timeStr } = await exec.getExecOutput("sudo", [
						"stat",
						"-c",
						"%Y",
						path.join(directory, file),
					]);
					return {
						name: file,
						time: Number.parseInt(timeStr.trim(), 10),
					};
				}),
		);

		matchingFiles.sort((a, b) => b.time - a.time);

		log(`Matching files: ${matchingFiles.map((f) => f.name).join(", ")}`);
		return matchingFiles.length > 0 ? matchingFiles[0].name : null;
	} catch (error) {
		log(
			`Error listing directory: ${error instanceof Error ? error.message : String(error)}`,
			"error",
		);
		return null;
	}
}

async function processResultFile(
	outputDir: string,
	prefix: string,
	title: string,
	emoji: string,
): Promise<void> {
	const file = await getLatestFile(outputDir, prefix);
	if (file) {
		const filePath = path.join(outputDir, file);
		log(`Processing ${title} file: ${filePath}`);
		try {
			const { stdout: content } = await exec.getExecOutput("sudo", [
				"cat",
				filePath,
			]);
			await addToSummaryWithSizeCheck(`${emoji} ${title}\n\n${content}`, title);
		} catch (error) {
			log(
				`Error reading file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	} else {
		log(
			`No ${title.toLowerCase()} file found with prefix ${prefix} in ${outputDir}`,
		);
	}
}

async function processResults(): Promise<void> {
	const outputDir = path.resolve(getOutputDir());
	log(`Processing knoxctl results from directory: ${outputDir}`);

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
		await stopKnoxctlScan();
		await new Promise((resolve) => setTimeout(resolve, 10000));

		const outputDir = getOutputDir();
		log(`Output directory: ${outputDir}`);
		log("Contents of output directory:");
		const { stdout: filesStr } = await exec.getExecOutput("sudo", [
			"ls",
			outputDir,
		]);
		const files = filesStr.split("\n").filter(Boolean);
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
	const { stdout: filesStr } = await exec.getExecOutput("sudo", [
		"ls",
		outputDir,
	]);
	const files = filesStr
		.split("\n")
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
