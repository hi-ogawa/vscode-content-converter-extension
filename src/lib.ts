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

const QUICK_PICK_ITEM_INTERNAL = "__HIROSHI_INTERNAL__"; // Symbol doesn't seem to work
const STATE_CUSTOM_COMMAND_HISTORY = "custom-command-history-v1";
const STATE_CUSTOM_COMMAND_HISTORY_MAX_ENTRIES = 20;

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

// cf. https://github.com/microsoft/vscode/issues/89601#issuecomment-580133277
async function showQuickPickInput<T extends vscode.QuickPickItem>(
  items: T[],
  options: { placeholder: string; valueToItem: (value: string) => T }
): Promise<T | undefined> {
  return new Promise((resolve) => {
    const ui = vscode.window.createQuickPick<T>();
    ui.placeholder = options.placeholder;
    ui.items = items;
    // TODO: Debounce input change
    ui.onDidChangeValue((value) => {
      let newItems = Array.from(items);
      if (value) {
        newItems.unshift({
          alwaysShow: true, // This helps reducing flickering of picker dropdown
          ...options.valueToItem(value),
        });
      }
      ui.items = newItems;
    });
    ui.onDidAccept(() => {
      resolve(ui.selectedItems[0]);
    });
    ui.onDidHide(() => {
      resolve(undefined);
      ui.dispose();
    });
    ui.show();
    return;
  });
}

type ConverterPickInteraction = () => Thenable<ConverterPickItem | undefined>;

interface ConverterPickItem extends vscode.QuickPickItem {
  label: string;
  [QUICK_PICK_ITEM_INTERNAL]: {
    converterConfig: ConverterConfig;
    continueInteraction?: ConverterPickInteraction;
  };
}

function createCustomCommandInteraction(
  context: vscode.ExtensionContext
): ConverterPickInteraction {
  // TODO:
  //   We cannot have an option to remove item from history since `IQuickPickItem.buttons` https://github.com/microsoft/vscode/blob/ff8f37a79626ede0265788192c406c95131dd7c5/src/vs/base/parts/quickinput/common/quickInput.ts#L39
  //   used in `workbench.action.openRecent` is not available for extension.
  //   For now, we only keep fixed number of most recently used commands.

  // Get custom command history
  const commandHistory = context.globalState.get<string[]>(
    STATE_CUSTOM_COMMAND_HISTORY,
    []
  );

  return async function (): Promise<ConverterPickItem | undefined> {
    const items: ConverterPickItem[] = commandHistory.map((command) => ({
      label: command,
      [QUICK_PICK_ITEM_INTERNAL]: {
        converterConfig: {
          name: "",
          command,
        },
      },
    }));
    const result = await showQuickPickInput(items, {
      placeholder: "Input command (e.g. grep hello -)",
      valueToItem: (value: string) => ({
        label: value,
        [QUICK_PICK_ITEM_INTERNAL]: {
          converterConfig: {
            name: "",
            command: value,
          },
        },
      }),
    });
    if (result) {
      // Update custom command history
      const { command } = result[QUICK_PICK_ITEM_INTERNAL].converterConfig;
      if (!commandHistory.includes(command)) {
        commandHistory.unshift(command);
        await context.globalState.update(
          STATE_CUSTOM_COMMAND_HISTORY,
          commandHistory.slice(0, STATE_CUSTOM_COMMAND_HISTORY_MAX_ENTRIES)
        );
      }
    }
    return result;
  };
}

function createQuickPickInteraction(
  converterConfigs: ConverterConfig[],
  context: vscode.ExtensionContext
): ConverterPickInteraction {
  return function () {
    const customCommandInteraction = createCustomCommandInteraction(context);
    // When no configuration, show directly custom command input
    if (converterConfigs.length == 0) {
      return customCommandInteraction();
    }

    // Items directory from configuration
    const items: ConverterPickItem[] = converterConfigs.map((c) => ({
      label: c.name,
      [QUICK_PICK_ITEM_INTERNAL]: {
        converterConfig: c,
      },
    }));

    // Add entry for custom command input
    items.push({
      label: "(custom command)",
      [QUICK_PICK_ITEM_INTERNAL]: {
        converterConfig: { name: "", command: "" },
        continueInteraction: customCommandInteraction,
      },
    });

    return vscode.window.showQuickPick(items);
  };
}

export async function converterCommandCallback(
  context: vscode.ExtensionContext,
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
    mainConfig.converters,
    context
  );
  while (true) {
    picked = await interaction();
    if (!picked) {
      vscode.window.showInformationMessage("Content converter cancelled");
      return;
    }
    const { continueInteraction } = picked[QUICK_PICK_ITEM_INTERNAL];
    if (continueInteraction) {
      interaction = continueInteraction;
      continue;
    }
    break;
  }

  // Open document with custom uri
  const { converterConfig } = picked[QUICK_PICK_ITEM_INTERNAL];
  await showConverterUri(sourceUri, converterConfig);
}

export function registerAll(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const contentProvider = new ContentProvider();

  const contentProviderRegistration =
    vscode.workspace.registerTextDocumentContentProvider(
      CONVERTER_SCHEME,
      contentProvider
    );

  const commandRegistration = vscode.commands.registerCommand(
    CONTRIB_CONVERTER_COMMAND,
    (...args: any[]) => converterCommandCallback(context, ...args)
  );

  return vscode.Disposable.from(
    contentProviderRegistration,
    commandRegistration
  );
}
