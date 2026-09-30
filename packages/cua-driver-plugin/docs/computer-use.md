# Computer Use with Cua Driver

MyCode hosts Cua Driver 0.30.4 as a native child of Electron Main. The window Host injects the driver's private MCP configuration only for local workspaces with the Computer Use plugin enabled. Driver connections are ephemeral and are not written to user configuration.

On macOS, grant Accessibility and Screen Recording to MyCode. The settings flow queries Main's permissions and opens the corresponding System Settings panels. The driver starts only after both grants are present. Restart through the settings flow when permissions change; an active turn prevents a restart.

The agent uses the driver's MCP tools and bundled skill resources. The old `createComputerUseRuntime` and `node_repl` CUA API are not the engine for this integration. The built-in browser uses its existing browser MCP and Main CDP implementation.

Supported MyCode surfaces are local macOS and Windows Desktop. Remote and standalone-server workspaces do not get access to the local physical desktop. Linux is not enabled by this MyCode integration.
