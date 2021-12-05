import * as vscode from "vscode";
import * as assert from "assert";
import { showConverterUri } from "../../lib";
import { CONVERTER_SCHEME, EXTENSION_ID } from "../../common";
import { DEMO_WORKSPACE_URI, CONVERTER_JQ, CONVERTER_GUNZIP } from "./misc";

suite("lib.test", () => {
  setup(async () => {
    await vscode.extensions.getExtension(EXTENSION_ID)!.activate();
  });

  suite("showConverterUri", () => {
    test("jq", async () => {
      // Demo json file
      const uri = vscode.Uri.joinPath(DEMO_WORKSPACE_URI, "ex00.json");

      // Prettify json
      const editor = await showConverterUri(uri, CONVERTER_JQ);
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
      assert.equal(editor.document.uri.scheme, CONVERTER_SCHEME);
      assert.equal(editor.document.uri.path, "ex00.json");
    });

    test("gunzip", async () => {
      // Demo gz file
      const uri = vscode.Uri.joinPath(DEMO_WORKSPACE_URI, "ex01.json.gz");

      // Decompress gzip
      const editor = await showConverterUri(uri, CONVERTER_GUNZIP);
      const expected = `\
{ "hey": 1,
  "hello"  : [  [false]] }
`;
      assert.equal(editor.document.getText(), expected);
      assert.equal(editor.document.uri.scheme, CONVERTER_SCHEME);
      assert.equal(editor.document.uri.path, "ex01.json.gz");
    });

    test("virtual-file-system", async () => {
      // Write json in "untitled" file system
      const uri = vscode.Uri.from({
        scheme: "untitled",
        path: "some.json",
      });
      const document = await vscode.workspace.openTextDocument(uri);
      const untitledEditor = await vscode.window.showTextDocument(document);
      await untitledEditor.edit((builder) => {
        builder.insert(
          new vscode.Position(0, 0),
          `\
{ "hey": 1,
  "hello"  : [  [false]] }
`
        );
      });

      // Prettify json
      const editor = await showConverterUri(uri, CONVERTER_JQ);
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
      assert.equal(editor.document.uri.scheme, CONVERTER_SCHEME);
      assert.equal(editor.document.uri.path, "some.json");
    });
  });
});
