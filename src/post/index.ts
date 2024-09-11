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

async function sudoExec(command: string, args: string[] = []): Promise<string> {
	let output = "";
	const options: exec.ExecOptions = {
		listeners: {
			stdout: (data: Buffer) => {
				output += data.toString();
			},
		},
	};
	await exec.exec("sudo", [command, ...args], options);
	return output.trim();
}

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

async function stopKnoxctlScan(): Promise<void> {
	const pidFile = getPidFilePath();
	if (fs.existsSync(pidFile)) {
		const pid = fs.readFileSync(pidFile, ENCODING).trim();
		log(`Attempting to stop knoxctl scan process with PID: ${pid}`);
		try {
			await sudoExec("kill", ["-SIGINT", pid]);
			log("Sent SIGINT signal to knoxctl scan process");
			await new Promise((resolve) => setTimeout(resolve, 5000));
			try {
				await sudoExec("kill", ["-0", pid]);
				log("Process is still running. Attempting to force kill...");
				await sudoExec("kill", ["-SIGKILL", pid]);
			} catch (error) {
				log("knoxctl scan process has been terminated");
			}
			await sudoExec("rm", [pidFile]);
			log("Removed PID file");

			// Change permissions only for knoxctl_scan_ files
			const workspaceDir = process.env.GITHUB_WORKSPACE || getOutputDir();
			log(`Changing permissions of knoxctl_scan_ files in: ${workspaceDir}`);
			await sudoExec("find", [
				workspaceDir,
				"-maxdepth",
				"1",
				"-type",
				"f",
				"-name",
				"knoxctl_scan_*",
				"-exec",
				"chmod",
				"644",
				"{}",
				"+",
			]);
			await sudoExec("find", [
				workspaceDir,
				"-maxdepth",
				"1",
				"-type",
				"f",
				"-name",
				"knoxctl_scan_*",
				"-exec",
				"chown",
				`${process.env.USER}:${process.env.USER}`,
				"{}",
				"+",
			]);
			log("Changed permissions and ownership of knoxctl_scan_ files");
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
	try {
		const files = fs
			.readdirSync(directory)
			.filter((file) => file.startsWith(prefix) && file.endsWith(".md"))
			.sort(
				(a, b) =>
					fs.statSync(path.join(directory, b)).mtime.getTime() -
					fs.statSync(path.join(directory, a)).mtime.getTime(),
			);
		return files.length > 0 ? files[0] : null;
	} catch (error) {
		log(
			`Error listing directory contents: ${error instanceof Error ? error.message : String(error)}`,
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
			const content = fs.readFileSync(filePath, ENCODING);
			await addToSummaryWithSizeCheck(`${emoji} ${title}\n\n${content}`, title);
		} catch (error) {
			log(
				`Failed to read content from ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
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
	const outputDir =
		process.env.GITHUB_WORKSPACE || path.resolve(getOutputDir());
	log(`Processing knoxctl results from directory: ${outputDir}`);

	if (!fs.existsSync(outputDir)) {
		log(`Output directory does not exist: ${outputDir}`, "error");
		return;
	}

	await addToSummaryWithSizeCheck(
		"📊 Runtime Security Report Generated by AccuKnox",
		"Report Overview",
	);

	// Process alerts first as they are most important
	await processResultFile(
		outputDir,
		"knoxctl_scan_processed_alerts_",
		"Alerts Summary",
		"🚨",
	);
	await processResultFile(
		outputDir,
		"knoxctl_scan_process_tree_",
		"Process Tree",
		"🖥️",
	);
	await processResultFile(
		outputDir,
		"knoxctl_scan_network_events_md_",
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
		await new Promise<void>((resolve) => {
			stopKnoxctlScan();
			setTimeout(resolve, 10000);
		});

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

	try {
		const files = fs
			.readdirSync(outputDir)
			.filter((file) => file.startsWith("knoxctl_scan_"))
			.map((file) => path.join(outputDir, file));

		log(`Uploading ${files.length} files as artifacts`);

		const uploadResult = await artifactClient.uploadArtifact(
			artifactName,
			files,
			outputDir,
			{ continueOnError: false },
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
