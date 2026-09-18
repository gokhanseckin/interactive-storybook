const { withXcodeProject } = require("expo/config-plugins");
// Expo's generated invocation needs quoting when the repository path contains spaces.
module.exports = (config) =>
  withXcodeProject(config, (config) => {
    const phases =
      config.modResults.hash.project.objects.PBXShellScriptBuildPhase;
    for (const phase of Object.values(phases)) {
      if (!phase || typeof phase !== "object" || !phase.shellScript) continue;
      if (!phase.shellScript.includes("react-native-xcode.sh")) continue;
      let script = JSON.parse(
        phase.shellScript
          .replace(/\n/g, "\\n")
          .replace(/\r/g, "\\r")
          .replace(/\t/g, "\\t"),
      );
      script = script.replace(
        /^`("\$NODE_BINARY" --print .*react-native-xcode\.sh'.*)`$/m,
        '"$($1)"',
      );
      phase.shellScript = JSON.stringify(script);
    }
    return config;
  });
