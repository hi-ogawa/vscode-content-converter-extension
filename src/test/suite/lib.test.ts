import * as vscode from "vscode";
import * as assert from "assert";
import { showConverterUri, showCommandContentAsUntitled } from "../../lib";
import { ConverterConfig, EXT_ID } from "../../common";
import { DEMO_WORKSPACE_URI, CONVERTER_JQ, CONVERTER_GUNZIP } from "./misc";

suite("lib.test", () => {
  setup(async () => {
    await vscode.extensions.getExtension(EXT_ID)!.activate();
  });

  // Test two variants
  for (const show of [showConverterUri, showCommandContentAsUntitled]) {
    testShow(show);
  }
});

type Show = (
  sourceUri: vscode.Uri,
  converterConfig: ConverterConfig
) => Promise<vscode.TextEditor>;

function testShow(show: Show): void {
  suite(show.name, () => {
    test("jq", async () => {
      // Demo json file
      const uri = vscode.Uri.joinPath(DEMO_WORKSPACE_URI, "ex00.json");

      // Prettify json
      const editor = await show(uri, CONVERTER_JQ);
      const expected = `\
{
  "hey": 1,
  "hello": [
    [
      false
    ]
  ]
}
`;
      assert.equal(editor.document.getText(), expected);
    });

    test("gunzip", async () => {
      // Demo gz file
      const uri = vscode.Uri.joinPath(DEMO_WORKSPACE_URI, "ex01.json.gz");

      // Decompress gzip
      const editor = await show(uri, CONVERTER_GUNZIP);
      const expected = `\
{ "hey": 1,
  "hello"  : [  [false]] }
`;
      assert.equal(editor.document.getText(), expected);
    });

    test("virtual-file-system", async () => {
      // Write json in "untitled" file system
      const content = `\
{ "hey": 1,
  "hello"  : [  [false]] }
`;
      const document = await vscode.workspace.openTextDocument({ content });

      // Prettify json
      const editor = await show(document.uri, CONVERTER_JQ);
      const expected = `\
{
  "hey": 1,
  "hello": [
    [
      false
    ]
  ]
}
`;
      assert.equal(editor.document.getText(), expected);
    });
  });
}
