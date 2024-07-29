import * as fs from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";

export const PID_FILE_NAME = "knoxctl_scan_pid";
export const RESULTS_DIR_NAME = "knoxctl-results";
export const ENCODING = "utf8";

export const IS_GITHUB_ACTIONS = !!process.env.GITHUB_ACTIONS;
export const WORKSPACE = process.env.GITHUB_WORKSPACE;

export function log(
	message: string,
	type: "info" | "warning" | "error" = "info",
): void {
	if (IS_GITHUB_ACTIONS) {
		switch (type) {
			case "warning":
				core.warning(message);
				break;
			case "error":
				core.error(message);
				break;
			default:
				core.info(message);
		}
	} else {
		console.log(message);
	}
}

export function getPidFilePath(): string {
	return WORKSPACE
		? path.join(WORKSPACE, PID_FILE_NAME)
		: path.join(__dirname, "..", "..", PID_FILE_NAME);
}

export function getOutputDir(): string {
	return WORKSPACE
		? WORKSPACE
		: path.join(__dirname, "..", "..", RESULTS_DIR_NAME);
}

export function mockCoreForLocalTesting(): void {
	if (!IS_GITHUB_ACTIONS) {
		(core as CoreMock).getInput = (name: string): string => {
			const inputs: { [key: string]: string } = {
				all: "true",
				system: "false",
				output: "./knoxctl-results",
			};
			return inputs[name] || "";
		};

		(core as CoreMock).getBooleanInput = (name: string): boolean => {
			return (core as CoreMock).getInput(name) === "true";
		};

		(core as CoreMock).setFailed = console.error;
	}
}

interface CoreMock {
	getInput: (name: string) => string;
	getBooleanInput: (name: string) => boolean;
	setFailed: (message: string) => void;
}
