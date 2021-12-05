import * as vscode from "vscode";
import { registerAll } from "./lib";

export function activate(context: vscode.ExtensionContext): void {
  const disposable = registerAll();
  context.subscriptions.push(disposable);
}
