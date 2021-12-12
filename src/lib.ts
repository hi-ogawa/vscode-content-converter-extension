import * as vscode from "vscode";
import { exec, ExecOptions } from "child_process";
import { Readable } from "stream";
import {
  EXT_COMMAND,
  EXT_SCHEME,
  encodeUri,
  decodeUri,
  EXEC_MAX_BUFFER,
  ConverterConfig,
  getMainConfig,
} from "./common";
import * as path from "path";

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

async function uriToBuffer(uri: vscode.Uri): Promise<Buffer> {
  // Read Uri as Buffer
  let buffer: Buffer;
  if (uri.scheme == "file") {
    const data = await vscode.workspace.fs.readFile(uri);
    buffer = Buffer.from(data);
  } else {
    // When URI is not backed by file system, read through TextDocument.getText
    const document = await vscode.workspace.openTextDocument(uri);
    buffer = Buffer.from(document.getText());
  }
  return buffer;
}

async function runConverter(
  sourceUri: vscode.Uri,
  converterConfig: ConverterConfig
): Promise<string | undefined> {
  // TODO: Show loading on status bar

  const { command } = converterConfig;
  const buffer = await uriToBuffer(sourceUri);

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

export class ContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(
    uri: vscode.Uri,
    _token: vscode.CancellationToken
  ): Promise<string | undefined> {
    const { sourceUri, converterConfig } = decodeUri(uri);
    return runConverter(sourceUri, converterConfig);
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

function formatPath(s: string): string {
  let { base, ...rest } = path.parse(s);
  if (base.includes(".")) {
    const [name, ...exts] = base.split(".");
    base = [`${name} (pipe untitled)`, ...exts].join(".");
  }
  return path.format({ base, ...rest });
}

// NOTE: It seems simply using "untitled" scheme is more convenient since it's editable and savable.
export async function showCommandContentAsUntitled(
  sourceUri: vscode.Uri,
  converterConfig: ConverterConfig
): Promise<vscode.TextEditor> {
  const content = await runConverter(sourceUri, converterConfig);

  const uri = vscode.Uri.from({
    scheme: "untitled",
    path: formatPath(sourceUri.path), // TODO: Is it bad to have path name conflicts of "untitled" documents?
    query: JSON.stringify({ converterConfig }), // Use query to differenciate different commands with path
  });

  const document = await vscode.workspace.openTextDocument(uri);

  // TODO: Is streaming possible with this approach?
  const editor = await vscode.window.showTextDocument(document);
  new vscode.Range(0, 0, editor.document.lineCount, 0);
  await editor.edit((builder) => {
    builder.replace(
      new vscode.Range(0, 0, document.lineCount, 0),
      content ?? ""
    );
  });
  return editor;
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
      const index = commandHistory.indexOf(command);
      if (index != -1) commandHistory.splice(index, 1);
      commandHistory.unshift(command);
      await context.globalState.update(
        STATE_CUSTOM_COMMAND_HISTORY,
        commandHistory.slice(0, STATE_CUSTOM_COMMAND_HISTORY_MAX_ENTRIES)
      );
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
  const mainConfig = getMainConfig();

  // Prompt to select converter via `QuickPick`
  let picked: ConverterPickItem | undefined;
  let interaction: ConverterPickInteraction = createQuickPickInteraction(
    mainConfig.commands,
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
  if (mainConfig.useUntitled) {
    await showCommandContentAsUntitled(sourceUri, converterConfig);
  } else {
    await showConverterUri(sourceUri, converterConfig);
  }
}

export function registerAll(
  context: vscode.ExtensionContext
): vscode.Disposable {
  const contentProvider = new ContentProvider();

  const contentProviderRegistration =
    vscode.workspace.registerTextDocumentContentProvider(
      EXT_SCHEME,
      contentProvider
    );

  const commandRegistration = vscode.commands.registerCommand(
    EXT_COMMAND,
    (...args: any[]) => converterCommandCallback(context, ...args)
  );

  return vscode.Disposable.from(
    contentProviderRegistration,
    commandRegistration
  );
}
