import * as vscode from "vscode";
import { exec, ExecOptions } from "child_process";
import { Readable } from "stream";
import {
  CONTRIB_CONVERTER_COMMAND,
  CONTRIB_CONVERTER_CONFIGURATION,
  CONVERTER_SCHEME,
  DEFAULT_MAIN_CONFIG,
  MainConfig,
  encodeUri,
  decodeUri,
  EXEC_MAX_BUFFER,
  ConverterConfig,
} from "./common";

async function runCommand(
  command: string,
  stdin: Buffer
): Promise<{ stdout: string; stderr: string }> {
  const execOption: ExecOptions = {
    maxBuffer: EXEC_MAX_BUFFER,
  };
  return new Promise((resolve, reject) => {
    const proc = exec(command, execOption, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
    if (!proc.stdin) {
      reject(new Error("Unavailable stdin on spawned process"));
      return;
    }
    Readable.from(stdin).pipe(proc.stdin);
  });
}

export class ContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(
    uri: vscode.Uri,
    _token: vscode.CancellationToken
  ): Promise<string | undefined> {
    const { sourceUri, converterConfig } = decodeUri(uri);
    const { command } = converterConfig;

    // Read Uri as Uint8Array
    let buffer: Buffer;
    if (sourceUri.scheme == "file") {
      const data = await vscode.workspace.fs.readFile(sourceUri);
      buffer = Buffer.from(data);
    } else {
      // When URI is not backed by file system, read through TextDocument.getText
      const document = await vscode.workspace.openTextDocument(sourceUri);
      buffer = Buffer.from(document.getText());
    }

    // Execute command
    try {
      const { stdout, stderr } = await runCommand(command, buffer);
      if (stderr.length > 0) {
        let message = ["Converter stderr:", stderr].join("\n");
        vscode.window.showWarningMessage(message);
      }
      return stdout;
    } catch (e) {
      let message = "Converter command failed";
      if (e instanceof Error) {
        message += ": " + e.toString();
      }
      vscode.window.showErrorMessage(message);
    }
    return;
  }
}

export async function showConverterUri(
  sourceUri: vscode.Uri,
  converterConfig: ConverterConfig
): Promise<vscode.TextEditor> {
  const uri = encodeUri({
    sourceUri,
    converterConfig,
  });
  const document = await vscode.workspace.openTextDocument(uri);
  return vscode.window.showTextDocument(document);
}

type ConverterPickInteraction = () => Thenable<ConverterPickItem | undefined>;

interface ConverterPickItem {
  label: string;
  converterConfig: ConverterConfig;
  continueInteraction?: ConverterPickInteraction;
}

function createQuickPickInteraction(
  converterConfigs: ConverterConfig[]
): ConverterPickInteraction {
  return function () {
    // Items directory from configuration
    const items: ConverterPickItem[] = converterConfigs.map((c) => ({
      label: c.name,
      converterConfig: c,
    }));

    // Item to accept custom command via `showInputBox`
    items.push({
      label: "(custom command)",
      converterConfig: { name: "", command: "" },
      continueInteraction: async (): Promise<ConverterPickItem | undefined> => {
        const result = await vscode.window.showInputBox({
          placeHolder: "e.g. grep hello -",
        });
        if (!result) return;
        return {
          label: "",
          converterConfig: {
            name: "custom command",
            command: result,
          },
        };
      },
    });

    return vscode.window.showQuickPick(items);
  };
}

export async function converterCommandCallback(
  sourceUri?: vscode.Uri
): Promise<void> {
  // The first argument `sourceUri` is only available when the command is invoked via "editor/title" or "explorer/context" menu.
  // Otherwise look for an active uri from the editor
  sourceUri ??= vscode.window.activeTextEditor?.document.uri;
  if (!sourceUri) {
    vscode.window.showWarningMessage("Active document URI not found");
    return;
  }

  // Load configuration
  const mainConfig: MainConfig = vscode.workspace
    .getConfiguration()
    .get(CONTRIB_CONVERTER_CONFIGURATION, DEFAULT_MAIN_CONFIG);

  // Prompt to select converter via `QuickPick`
  let picked: ConverterPickItem | undefined;
  let interaction: ConverterPickInteraction = createQuickPickInteraction(
    mainConfig.converters
  );
  while (true) {
    picked = await interaction();
    if (!picked) {
      vscode.window.showInformationMessage("Content converter cancelled");
      return;
    }
    if (picked.continueInteraction) {
      interaction = picked.continueInteraction;
      continue;
    }
    break;
  }

  // Open document with custom uri
  await showConverterUri(sourceUri, picked.converterConfig);
}

export function registerAll(): vscode.Disposable {
  const contentProvider = new ContentProvider();

  const contentProviderRegistration =
    vscode.workspace.registerTextDocumentContentProvider(
      CONVERTER_SCHEME,
      contentProvider
    );

  const commandRegistration = vscode.commands.registerCommand(
    CONTRIB_CONVERTER_COMMAND,
    converterCommandCallback
  );

  return vscode.Disposable.from(
    contentProviderRegistration,
    commandRegistration
  );
}
