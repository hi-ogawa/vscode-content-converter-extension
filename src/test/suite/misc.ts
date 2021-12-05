import * as vscode from "vscode";
import * as path from "path";
import { ConverterConfig } from "../../common";

export const DEV_ROOT = path.resolve(__dirname, "../../..");
export const DEMO_WORKSPACE = path.resolve(
  DEV_ROOT,
  "./src/test/demo-workspace"
);
export const DEMO_WORKSPACE_URI = vscode.Uri.file(DEMO_WORKSPACE);

export const CONVERTER_JQ: ConverterConfig = {
  name: "jq",
  command: "jq -M",
};

export const CONVERTER_GUNZIP: ConverterConfig = {
  name: "gunzip",
  command: "gunzip -c -",
};
