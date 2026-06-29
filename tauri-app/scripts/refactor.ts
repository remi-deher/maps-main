import { Project, SyntaxKind } from "ts-morph";
import * as path from "path";

const project = new Project();
project.addSourceFilesAtPaths("src/components/**/*.tsx");
project.addSourceFilesAtPaths("src/components/**/*.ts");
project.addSourceFilesAtPaths("src/App.tsx");
project.addSourceFilesAtPaths("src/context/websocket.test.tsx");

const ENGINE_PROPS = new Set([
  "isConnected", "connectionStatus", "connectionUrl", "enginePort", "engineStatus",
  "setEnginePort", "mdnsInterface", "setMdnsInterface", "networkInterfaces", "lastError",
  "canSend", "status", "telemetry", "deviceDetails", "getDeviceInfo", "sendMessage",
  "setLocation", "clearLocation", "playRoute", "playSequence", "playCustomGpx",
  "stopRoute", "pauseRoute", "resumeRoute", "relance", "saveSettings", "addFavorite",
  "removeFavorite", "renameFavorite", "updatePatrolZone", "diagnostics", "getDiagnostics",
  "networkDevices", "getNetworkDevices"
]);

const LOGS_PROPS = new Set(["logs", "appendLog", "setLogs", "clearLogs"]);

const PAIRING_PROPS = new Set([
  "needsPairing", "setNeedsPairing", "pairCodeError", "setPairCodeError",
  "prefillCode", "setPrefillCode", "deviceToken", "setDeviceToken",
  "pairedDevices", "setPairedDevices", "submitCode", "forgetPairing",
  "pairResult", "setPairResult", "pairing", "setPairing", "pairDevice",
  "remotePairCode", "setRemotePairCode", "requestPairCode", "requestPairedDevices", "revokePairedDevice"
]);

const files = project.getSourceFiles();

for (const sourceFile of files) {
  const imports = sourceFile.getImportDeclarations();
  const wsImport = imports.find(i => i.getModuleSpecifierValue().includes("websocket"));
  if (!wsImport) continue;

  const namedImports = wsImport.getNamedImports();
  const hasUseWebSocket = namedImports.some(n => n.getName() === "useWebSocket");
  if (!hasUseWebSocket) continue;

  const useWebSocketCalls = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)
    .filter(c => c.getExpression().getText() === "useWebSocket");

  if (useWebSocketCalls.length === 0) continue;

  console.log(`Refactoring file: ${sourceFile.getFilePath()}`);

  let needsEngine = false;
  let needsLogs = false;
  let needsPairing = false;

  const engineVars: string[] = [];
  const logsVars: string[] = [];
  const pairingVars: string[] = [];

  for (const call of useWebSocketCalls) {
    const parent = call.getParentIfKind(SyntaxKind.VariableDeclaration);
    if (!parent) continue;

    const bindingPattern = parent.getNameNode();
    if (bindingPattern.getKind() === SyntaxKind.ObjectBindingPattern) {
      const elements = bindingPattern.getElements();
      for (const el of elements) {
        const text = el.getText();
        const name = el.getName();
        const propNameNode = el.getPropertyNameNode();
        const propName = propNameNode ? propNameNode.getText() : name;

        if (ENGINE_PROPS.has(propName)) {
          needsEngine = true;
          engineVars.push(text);
        } else if (LOGS_PROPS.has(propName)) {
          needsLogs = true;
          logsVars.push(text);
        } else if (PAIRING_PROPS.has(propName)) {
          needsPairing = true;
          pairingVars.push(text);
        } else {
          needsEngine = true;
          engineVars.push(text);
        }
      }

      const replacements: string[] = [];
      if (engineVars.length > 0) replacements.push(`const { ${engineVars.join(", ")} } = useEngine();`);
      if (logsVars.length > 0) replacements.push(`const { ${logsVars.join(", ")} } = useLogs();`);
      if (pairingVars.length > 0) replacements.push(`const { ${pairingVars.join(", ")} } = usePairing();`);

      const varStatement = parent.getFirstAncestorByKind(SyntaxKind.VariableStatement);
      if (varStatement) {
        varStatement.replaceWithText(replacements.join("\n  "));
      }
    }
  }

  // Update imports
  const useWsSpec = namedImports.find(n => n.getName() === "useWebSocket");
  if (useWsSpec) {
    useWsSpec.remove();
  }

  if (wsImport.getNamedImports().length === 0) {
    wsImport.remove();
  } else if (needsEngine) {
    wsImport.addNamedImport("useEngine");
  }

  const relativePathToContext = (moduleName: string) => {
    const fileDir = path.dirname(sourceFile.getFilePath());
    const contextDir = path.resolve("src/context");
    let relative = path.relative(fileDir, path.resolve(contextDir, moduleName));
    relative = relative.replace(/\\/g, "/");
    if (!relative.startsWith(".")) relative = "./" + relative;
    return relative;
  };

  if (needsEngine && !sourceFile.getImportDeclarations().some(i => i.getModuleSpecifierValue().includes("websocket") && i.getNamedImports().some(n => n.getName() === "useEngine"))) {
    sourceFile.addImportDeclaration({
      namedImports: ["useEngine"],
      moduleSpecifier: relativePathToContext("websocket")
    });
  }

  if (needsLogs) {
    sourceFile.addImportDeclaration({
      namedImports: ["useLogs"],
      moduleSpecifier: relativePathToContext("logsContext")
    });
  }

  if (needsPairing) {
    sourceFile.addImportDeclaration({
      namedImports: ["usePairing"],
      moduleSpecifier: relativePathToContext("pairingContext")
    });
  }

  sourceFile.saveSync();
}

console.log("Refactoring complete!");
