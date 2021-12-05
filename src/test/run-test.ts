import * as path from "path";
import * as process from "process";
import { runTests } from "@vscode/test-electron";

async function main() {
  await runTests({
    vscodeExecutablePath: process.env["TEST_VSCODE_EXE"],
    extensionDevelopmentPath: path.resolve(__dirname, "../.."),
    extensionTestsPath: path.resolve(__dirname, "./suite"),
  });
}

if (require.main === module) {
  main();
}
