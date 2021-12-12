import * as vscode from "vscode";
import * as path from "path";
import { URLSearchParams } from "url";

export const EXTENSION_ID = "hi-ogawa.vscode-content-converter-extension";
export const CONTRIB_CONVERTER_CONFIGURATION = "hi-ogawa.content-converter";
export const CONTRIB_CONVERTER_COMMAND = "extension.content-converter.run";
export const CONVERTER_SCHEME = "content-converter";

// TODO: Accept `exec` options via `ConverterConfig`
export const EXEC_MAX_BUFFER = 1 << 29; // 512MB

export interface ConverterConfig {
  name: string;
  command: string;
}

export interface MainConfig {
  useUntitled: boolean;
  converters: ConverterConfig[];
}

export const DEFAULT_MAIN_CONFIG: MainConfig = {
  useUntitled: true,
  converters: [],
};

export function getMainConfig(): MainConfig {
  const mainConfig = { ...DEFAULT_MAIN_CONFIG };
  for (const key_ in mainConfig) {
    const key = key_ as keyof MainConfig;
    mainConfig[key] = vscode.workspace
      .getConfiguration()
      .get(`${CONTRIB_CONVERTER_CONFIGURATION}.${key}`, mainConfig[key]) as any;
  }
  return mainConfig;
}

export interface ProviderOptions {
  sourceUri: vscode.Uri;
  converterConfig: ConverterConfig;
}

function toQuery(object: any): string {
  return new URLSearchParams(object).toString();
}

function fromQuery(query: string): any {
  return Object.fromEntries(new URLSearchParams(query).entries());
}

export function encodeUri(options: ProviderOptions): vscode.Uri {
  const plainOptions = {
    sourceUri: JSON.stringify(options.sourceUri.toJSON()),
    converterConfig: JSON.stringify(options.converterConfig),
  };
  return vscode.Uri.from({
    scheme: CONVERTER_SCHEME,
    query: toQuery(plainOptions),
    path: path.basename(options.sourceUri.path),
  });
}

export function decodeUri(uri: vscode.Uri): ProviderOptions {
  const plainOptions = fromQuery(uri.query);
  return {
    sourceUri: vscode.Uri.from(JSON.parse(plainOptions.sourceUri)),
    converterConfig: JSON.parse(plainOptions.converterConfig),
  };
}
