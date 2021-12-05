import * as vscode from "vscode";
import { EXTENSION_ID } from "../../common";

suite("extension.test", () => {
  test("activate", async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
  });
});
